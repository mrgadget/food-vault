import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Resizing hero images with Cloudflare's Images binding.
 *
 * A meal-kit card's cover is ~10 megapixels of Adobe CMYK. Decoding that in the
 * Worker needs ~170MB of buffers — more than the 128MB isolate has — so it
 * cannot be resized in JavaScript at all. The Images binding runs the decode
 * and downscale in Cloudflare's own image pipeline, outside the isolate's
 * memory, and its decoder handles inverted-CMYK JPEGs correctly (the reason the
 * in-house path needed a vendored decoder in the first place).
 *
 * The binding is only present on a deployed Worker with Images enabled; in a
 * plain local build there is nothing to fall back to for a CMYK cover, so a
 * missing binding simply yields no hero rather than a crash.
 */

/** Longest edge of a stored hero. Big enough for a banner, small enough to thumbnail. */
const HERO_MAX_EDGE = 900;

/** The slice of the Images binding we use. Structural, to avoid a global type dependency. */
interface ImagesBinding {
  info(stream: ReadableStream<Uint8Array>): Promise<{ width?: number; height?: number; format?: string }>;
  input(stream: ReadableStream<Uint8Array>): ImageTransformer;
}
interface ImageTransformer {
  transform(options: { width?: number; height?: number }): ImageTransformer;
  output(options: { format: string; quality?: number }): Promise<{ response(): Response }>;
}

function imagesBinding(): ImagesBinding | undefined {
  try {
    const binding = (getCloudflareContext().env as Record<string, unknown>).IMAGES;
    return binding as ImagesBinding | undefined;
  } catch {
    // Not running under the Cloudflare adapter — a bare build, a test, a script.
    return undefined;
  }
}

/**
 * Downscale an image to a stored hero JPEG. Preserves aspect ratio and never
 * upscales — a source already smaller than the cap is only re-encoded.
 *
 * Returns null when the Images binding is unavailable or the transform fails;
 * the hero is a nicety, and a failed one must not fail the whole import.
 */
export async function resizeToHero(bytes: Uint8Array): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const images = imagesBinding();
  if (!images) return null;

  try {
    // `info` needs its own stream; a ReadableStream is consumed once.
    let width = HERO_MAX_EDGE;
    try {
      const info = await images.info(streamOf(bytes));
      if (typeof info.width === "number" && info.width > 0) width = Math.min(HERO_MAX_EDGE, info.width);
    } catch {
      // Without dimensions we still resize to the cap; the worst case is a mild
      // upscale of an already-small image, which is harmless.
    }

    const result = await images
      .input(streamOf(bytes))
      .transform({ width })
      .output({ format: "image/jpeg", quality: 82 });
    return { bytes: new Uint8Array(await result.response().arrayBuffer()), mimeType: "image/jpeg" };
  } catch (error) {
    console.error("Hero resize via the Images binding failed", error);
    return null;
  }
}

/** A fresh single-use stream over the bytes; the binding consumes one per call. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
