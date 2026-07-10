import jpeg from "jpeg-js";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";

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
 * And HelloFresh's photos are DeviceCMYK with an Adobe APP14 marker, meaning
 * inverted CMYK. Handed to a browser untouched they render as purple and cyan.
 * Those must be decoded, inverted and re-encoded — about 110ms of CPU each.
 * Three-channel JPEGs are already RGB and pass through free.
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

export async function extractStepPhotos(pdf: Uint8Array): Promise<PdfImage[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const found: PdfImage[] = [];

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

      const isPhoto =
        Math.min(width, height) >= MIN_PHOTO_EDGE &&
        (width * height) / 1e6 < HERO_MEGAPIXELS;
      if (!isPhoto) continue;

      found.push({
        index: found.length,
        page: pageIndex + 1,
        width,
        height,
        jpeg: toDisplayableJpeg(stream.contents),
      });
    }
  });

  return found;
}

/**
 * A four-component JPEG is CMYK. Every one seen on these cards carries Adobe's
 * APP14 marker, which means the samples are stored inverted; jpeg-js converts
 * to RGB but does not undo that, so the result comes out as its own negative.
 * Inverting the decoded pixels puts it right.
 */
function toDisplayableJpeg(raw: Uint8Array): Uint8Array {
  if (componentCount(raw) !== 4) return raw;

  const decoded = jpeg.decode(raw, { formatAsRGBA: true, tolerantDecoding: true });
  const pixels = decoded.data;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255 - pixels[i];
    pixels[i + 1] = 255 - pixels[i + 1];
    pixels[i + 2] = 255 - pixels[i + 2];
    pixels[i + 3] = 255;
  }
  return jpeg.encode({ data: pixels, width: decoded.width, height: decoded.height }, 82).data;
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
