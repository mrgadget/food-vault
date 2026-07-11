import { NextResponse } from "next/server";

import { objectKey, putImage } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

/**
 * The Supabase Storage bucket images lived in before the move to R2. Its name
 * is historical — it predates the FoodVault rename — so it stays as-is.
 */
const LEGACY_BUCKET = "recipe-vault-images";

/**
 * One-off migration: copy each image from the old Supabase Storage bucket into
 * R2 under the new `{foodId}/{name}` key, and repoint the row.
 *
 * Idempotent — a row already on the new key is skipped, so it is safe to re-run
 * (e.g. after fixing whatever made one fail). The old Supabase objects are left
 * in place; delete the legacy bucket by hand once this reads clean.
 *
 * Guarded to production: run locally and it would write to the *local* R2 while
 * rewriting `storage_path` in the *shared* database, stranding production on
 * objects it cannot see. `?dryRun=1` reports what would happen without writing,
 * which is safe anywhere.
 */
export async function POST(request: Request) {
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  if (process.env.NODE_ENV !== "production" && !dryRun) {
    return NextResponse.json(
      { error: "Refusing to migrate outside production: it would write to a local R2 while mutating the shared database. Append ?dryRun=1 to preview safely." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: rows, error } = await supabase
    .from("food_images")
    .select("id, food_id, storage_path, mime_type");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let migrated = 0;
  let skipped = 0;
  const failures: { path: string; reason: string }[] = [];

  for (const row of rows ?? []) {
    const oldPath = row.storage_path as string;
    const name = oldPath.split("/").pop() ?? oldPath;
    const newKey = objectKey(row.food_id as string, name);

    if (oldPath === newKey) {
      skipped++;
      continue;
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from(LEGACY_BUCKET)
      .download(oldPath);
    if (downloadError || !blob) {
      failures.push({ path: oldPath, reason: downloadError?.message ?? "not found in Supabase Storage" });
      continue;
    }

    if (dryRun) {
      migrated++; // would migrate
      continue;
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    await putImage(newKey, bytes, (row.mime_type as string) ?? "application/octet-stream");

    const { error: updateError } = await supabase
      .from("food_images")
      .update({ storage_path: newKey })
      .eq("id", row.id);
    if (updateError) {
      failures.push({ path: oldPath, reason: `db update failed: ${updateError.message}` });
      continue;
    }
    migrated++;
  }

  return NextResponse.json({ dryRun, migrated, skipped, failures });
}
