import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Object storage for recipe images, backed by a Cloudflare R2 bucket bound to
 * the Worker as `IMAGES_BUCKET` (see wrangler.jsonc).
 *
 * Objects are keyed `{userId}/{batchId}/{name}`, so the user id prefix is what
 * scopes ownership — the same shape the rows in Postgres store. R2 has no notion
 * of the signed-in user, so reads go through an authenticated route
 * (app/api/images) rather than a public or presigned URL; `imageUrl` builds the
 * path to it.
 */

/** The slice of the R2 binding we use. Structural, to avoid a global type dependency. */
interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
}

/** An R2 object with its bytes and the metadata stored alongside it. */
export interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
}

function bucket(): R2Bucket {
  const binding = (getCloudflareContext().env as Record<string, unknown>).IMAGES_BUCKET;
  if (!binding) throw new Error("R2 binding IMAGES_BUCKET is not configured");
  return binding as R2Bucket;
}

export async function putImage(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await bucket().put(path, bytes, { httpMetadata: { contentType } });
}

export function getImage(path: string): Promise<R2ObjectBody | null> {
  return bucket().get(path);
}

/** Delete objects by key. R2 takes up to 1000 keys per call; recipes have a handful. */
export async function deleteImages(paths: string[]): Promise<void> {
  if (paths.length > 0) await bucket().delete(paths);
}

/**
 * The in-app URL that serves a stored object. Pure string-building — no binding
 * needed — so it is safe to call from a Server Component rendering `<img>` tags.
 * Each path segment is encoded; the serving route decodes them back to the key.
 */
export function imageUrl(path: string): string {
  return `/api/images/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Build a path → URL map for a batch of objects, mirroring the old signer's shape. */
export function imageUrls(paths: string[]): Map<string, string> {
  return new Map(paths.map((path) => [path, imageUrl(path)]));
}
