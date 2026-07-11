import { getImage } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serve a stored food image from R2.
 *
 * The bucket is private. Keys are `{foodId}/{name}`, so ownership is whether
 * the caller owns that food: a row lookup under the caller's session, which
 * RLS scopes to their own foods. An anonymous or non-owner request sees no
 * row and gets a 404 — the same guarantee the old signed URLs gave, without a
 * shareable link and without trusting the path itself.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const key = path.map(decodeURIComponent).join("/");
  const foodId = path[0] ? decodeURIComponent(path[0]) : "";

  // A malformed id would make the uuid comparison throw in Postgres; reject it
  // as simply not found.
  if (!UUID.test(foodId)) return new Response("Not found.", { status: 404 });

  const supabase = await createClient();
  const { data: food } = await supabase
    .from("foods")
    .select("id")
    .eq("id", foodId)
    .maybeSingle();
  if (!food) return new Response("Not found.", { status: 404 });

  const object = await getImage(key);
  if (!object) return new Response("Not found.", { status: 404 });

  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}
