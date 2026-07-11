import jpeg from "jpeg-js";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";

import { JpegImage } from "./vendor/jpeg-decoder.js";

/**
 * Pull the photographs out of a recipe-card PDF.
 *
 * A Worker has no rasteriser, so nothing here renders a page. Cards embed their
 * images as DCTDecode streams, which are JPEG files already, and are lifted out
 * whole.
 *
 * Three traps this navigates:
 *
 * The XObject resource dictionary is ordered alphabetically, so it yields Im1,
 * Im10, Im2 — not reading order. Real order lives in the page's content stream,
 * as the sequence of `/ImN Do` paint operators.
 *
 * A card holds several kinds of image: one big hero shot, a row of tiny
 * ingredient icons, a logo, and the step photographs. Only the last are wanted,
 * so they are separated by shape rather than by position.
 *
 * And HelloFresh's photos are DeviceCMYK, which no browser renders. Those are
 * decoded and re-encoded as RGB — about 110ms of CPU each. Three-channel JPEGs
 * are already RGB and pass through free. See toDisplayableJpeg.
 */

export type PdfImage = {
  /** Reading order across the whole document. */
  index: number;
  page: number;
  width: number;
  height: number;
  jpeg: Uint8Array;
};

/** Below this, an image is an icon or a bullet, not a photograph. */
const MIN_PHOTO_EDGE = 400;
/** The hero shot dwarfs the step photos; it is the card's cover, not a step. */
const HERO_MEGAPIXELS = 4;
/** Longest edge of a stored hero. Big enough for a banner, small enough to thumbnail. */
const HERO_MAX_EDGE = 900;

type RawImage = { page: number; width: number; height: number; bytes: Uint8Array };

/** Every embedded JPEG on the card, in reading order, with its dimensions. */
async function rawImages(pdf: Uint8Array): Promise<RawImage[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const images: RawImage[] = [];

  doc.getPages().forEach((page, pageIndex) => {
    const resources = page.node.Resources();
    const xObjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xObjects) return;

    for (const name of paintOrder(doc, page)) {
      const ref = xObjects.get(PDFName.of(name));
      if (!ref) continue;
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;

      const dict = stream.dict;
      if (dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
      // Anything but DCTDecode would need decoding we cannot afford here.
      if (dict.get(PDFName.of("Filter"))?.toString() !== "/DCTDecode") continue;

      const width = Number(dict.get(PDFName.of("Width"))?.toString());
      const height = Number(dict.get(PDFName.of("Height"))?.toString());
      if (!width || !height) continue;

      images.push({ page: pageIndex + 1, width, height, bytes: stream.contents });
    }
  });

  return images;
}

export async function extractStepPhotos(pdf: Uint8Array): Promise<PdfImage[]> {
  const photos: PdfImage[] = [];

  for (const image of await rawImages(pdf)) {
    const isPhoto =
      Math.min(image.width, image.height) >= MIN_PHOTO_EDGE &&
      (image.width * image.height) / 1e6 < HERO_MEGAPIXELS;
    if (!isPhoto) continue;

    photos.push({
      index: photos.length,
      page: image.page,
      width: image.width,
      height: image.height,
      jpeg: toDisplayableJpeg(image.bytes),
    });
  }

  return photos;
}

/**
 * The card's cover photograph, downscaled — the plated dish, shot large.
 *
 * It is the biggest image on the card and the one extractStepPhotos throws
 * away for being too big; here that size is the whole point. Downscaled on the
 * way out: the original is ~10 megapixels, far more than a thumbnail or a
 * banner needs, and storing that per recipe is wasteful.
 *
 * Returns null when no image is large enough to be a cover — a plain photo of
 * a printed page has no hero.
 */
export async function extractHeroImage(pdf: Uint8Array): Promise<Uint8Array | null> {
  const images = await rawImages(pdf);

  let hero: RawImage | undefined;
  for (const image of images) {
    if ((image.width * image.height) / 1e6 < HERO_MEGAPIXELS) continue;
    if (!hero || image.width * image.height > hero.width * hero.height) hero = image;
  }
  if (!hero) return null;

  // Best-effort: a hero shot is a nicety, and a Worker has only 128MB. Rather
  // than let a large decode crash the whole import, skip it.
  try {
    return heroJpeg(hero.bytes);
  } catch {
    return null;
  }
}

/**
 * Normalise a hero image fetched from the web to a stored thumbnail: decode,
 * downscale, re-encode as JPEG. Only JPEGs are handled here — jpeg-js cannot
 * read PNG or WebP — so those are returned unchanged and stored at full size,
 * which the browser can display and size down itself.
 */
export function prepareHeroJpeg(bytes: Uint8Array, mimeType: string): { bytes: Uint8Array; mimeType: string } {
  if (mimeType !== "image/jpeg") return { bytes, mimeType };
  try {
    return { bytes: heroJpeg(bytes), mimeType: "image/jpeg" };
  } catch {
    // Too large to decode in the Worker's memory — store the original; the
    // browser can size it down.
    return { bytes, mimeType };
  }
}

/**
 * Decode a JPEG and downscale it to a thumbnail in a single low-memory pass.
 *
 * A card's cover shot is ~10 megapixels. Decoding it to RGBA and then
 * separately allocating a full-size buffer to convert and downscale held three
 * ~40MB copies at once and overran the Worker's 128MB. This averages straight
 * from the decoder's output into the small target, so the largest thing live at
 * once is the decode's own `channels` array.
 */
function heroJpeg(bytes: Uint8Array): Uint8Array {
  // Decode in its own scope so the JpegImage — and the ~40MB of internal
  // component buffers it holds — can be collected before the downscale loop,
  // which then only touches the single `channels` array.
  const { channels, width, height, perPixel } = decodeChannels(bytes);
  const cmyk = perPixel === 4;

  const scale = Math.min(1, HERO_MAX_EDGE / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(outW * outH * 4);

  for (let oy = 0; oy < outH; oy++) {
    const y0 = Math.floor((oy * height) / outH);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / outH));
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor((ox * width) / outW);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / outW));

      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          const i = (row + x) * perPixel;
          if (cmyk) {
            const k = channels[i + 3];
            r += (channels[i] * k) / 255;
            g += (channels[i + 1] * k) / 255;
            b += (channels[i + 2] * k) / 255;
          } else {
            r += channels[i];
            g += channels[i + 1];
            b += channels[i + 2];
          }
          n++;
        }
      }
      const o = (oy * outW + ox) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }

  return jpeg.encode({ data: out, width: outW, height: outH }, 82).data;
}

/**
 * A four-component JPEG is CMYK, which no browser will render. These carry
 * Adobe's APP14 marker with transform 2 (YCCK).
 *
 * jpeg-js's public `decode()` does convert them to RGB, but with a transform
 * that is wrong for this encoding — the result is its own negative. Inverting
 * that output looks right on dark photographs and washes out bright ones,
 * because inversion is not the inverse of the transform it applied.
 *
 * `getData()` on the vendored decoder returns the four channels, where each of
 * the first three already holds `255 - ink`. The correct conversion is then the
 * ordinary subtractive one: each channel scaled by the black channel.
 */
function toDisplayableJpeg(raw: Uint8Array): Uint8Array {
  if (componentCount(raw) !== 4) return raw;
  const { rgba, width, height } = decodeToRgba(raw);
  return jpeg.encode({ data: rgba, width, height }, 82).data;
}

/**
 * Decode a card JPEG to RGBA pixels.
 *
 * The four-component case is the interesting one: these are DeviceCMYK with an
 * Adobe marker, and jpeg-js's public decode() gets the transform wrong. The
 * vendored decoder's getData() hands back the raw channels, each of the first
 * three already `255 - ink`, so the subtractive conversion (channel scaled by
 * black) is correct. A three-component image is ordinary RGB.
 */
function decodeToRgba(raw: Uint8Array): { rgba: Uint8Array; width: number; height: number } {
  const { channels, width, height, perPixel } = decodeChannels(raw);
  const rgba = new Uint8Array(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel++) {
    if (perPixel === 4) {
      const c = channels[pixel * 4];
      const m = channels[pixel * 4 + 1];
      const y = channels[pixel * 4 + 2];
      const k = channels[pixel * 4 + 3];
      rgba[pixel * 4] = (c * k) / 255;
      rgba[pixel * 4 + 1] = (m * k) / 255;
      rgba[pixel * 4 + 2] = (y * k) / 255;
    } else {
      rgba[pixel * 4] = channels[pixel * perPixel];
      rgba[pixel * 4 + 1] = channels[pixel * perPixel + 1];
      rgba[pixel * 4 + 2] = channels[pixel * perPixel + 2];
    }
    rgba[pixel * 4 + 3] = 255;
  }

  return { rgba, width, height };
}

/**
 * Decode a JPEG to its raw channels (3 for RGB, 4 for CMYK) and dimensions.
 *
 * Kept in its own function so the JpegImage — which also holds the decoder's
 * large internal component buffers — is out of scope the moment this returns,
 * leaving only the `channels` array live for the caller's pixel work. On a
 * 128MB Worker that headroom is the difference between a hero thumbnail and an
 * out-of-memory crash.
 *
 * The memory guard is a deliberate circuit breaker: an image too large to
 * decode within the isolate throws here rather than tripping the runtime's own
 * limit, so a caller can catch it and carry on without the picture.
 */
function decodeChannels(raw: Uint8Array): {
  channels: Uint8Array;
  width: number;
  height: number;
  perPixel: number;
} {
  const image = new JpegImage();
  image.opts = { useTArray: true, tolerantDecoding: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 96 };
  // The guard is module-scoped and starts at zero, so it must be armed per image.
  JpegImage.resetMaxMemoryUsage(96 * 1024 * 1024);
  image.parse(raw);

  const { width, height } = image;
  const channels = image.getData(width, height);
  return { channels, width, height, perPixel: channels.length / (width * height) };
}

/** Read the component count out of the JPEG's start-of-frame marker. */
function componentCount(jpegBytes: Uint8Array): number {
  for (let i = 2; i < jpegBytes.length - 9; i++) {
    if (jpegBytes[i] !== 0xff) continue;
    const marker = jpegBytes[i + 1];
    // SOF0 baseline, SOF1 extended, SOF2 progressive.
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return jpegBytes[i + 9];
  }
  return -1;
}

/** The `/ImN Do` operators, in the order the page paints them. */
function paintOrder(doc: PDFDocument, page: { node: { Contents: () => unknown } }): string[] {
  const contents = page.node.Contents();
  if (!contents) return [];

  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];

  let text = "";
  for (const stream of streams) {
    if (stream instanceof PDFRawStream) {
      // latin1 keeps every byte a single code unit, so binary payloads in the
      // stream cannot swallow an operator by decoding into one character.
      text += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    }
  }

  const seen = new Set<string>();
  const order: string[] = [];
  for (const match of text.matchAll(/\/(Im\d+)\s+Do/g)) {
    // A page may paint the same XObject twice; we want one copy.
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    order.push(match[1]);
  }
  return order;
}
