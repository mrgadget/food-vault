import { getImage } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

/**
 * Serve a stored recipe image from R2.
 *
 * The bucket is private, so every request is authenticated with the caller's
 * Supabase session and checked against the object key, which is prefixed with
 * the owner's user id. A signed-in user can therefore only read their own
 * images — the same guarantee the old signed URLs gave, without a shareable link.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const key = path.map(decodeURIComponent).join("/");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Not signed in.", { status: 401 });

  // Keys are `{userId}/{batchId}/{name}`; anything outside the caller's prefix
  // is not theirs to see. 404 rather than 403 so a probe learns nothing.
  if (key !== auth.user.id && !key.startsWith(`${auth.user.id}/`)) {
    return new Response("Not found.", { status: 404 });
  }

  const object = await getImage(key);
  if (!object) return new Response("Not found.", { status: 404 });

  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}
