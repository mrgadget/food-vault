import { NextResponse } from "next/server";

import { extractFromSource } from "@/lib/ai/extract";
import { matchPhotosToSteps } from "@/lib/ai/match-photos";
import { deleteRecipe, findRecipesBySourceUrl, saveRecipe, type SavedImage } from "@/lib/db/recipes";
import { fetchImage, fetchSource, type Source } from "@/lib/import/fetch-page";
import { resizeToHero } from "@/lib/import/images";
import { extractStepPhotos, findCoverBytes } from "@/lib/import/pdf-images";
import { streamJob, type Progress } from "@/lib/job-stream";
import { IMAGE_BUCKET } from "@/lib/supabase/schema";
import { createClient } from "@/lib/supabase/server";
import type { ServerClient } from "@/lib/supabase/server";
import type { Recipe } from "@/lib/schema";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "A url is required." }, { status: 400 });
  }
  const onExisting: unknown = body?.onExisting;

  // Re-importing the same link would otherwise silently make a second copy.
  // Before doing any slow work, check — and let the client decide.
  const existing = await findRecipesBySourceUrl(supabase, url);
  if (existing.length > 0 && onExisting !== "replace" && onExisting !== "skip") {
    return NextResponse.json({
      duplicate: { title: existing[0].title, count: existing.length },
    });
  }
  if (existing.length > 0 && onExisting === "skip") {
    return NextResponse.json({ skipped: true, id: existing[0].id });
  }
  // On replace, the new recipe is built first and the old ones removed only
  // after it lands, so a failed import never loses the copy you already had.
  const replacedIds = onExisting === "replace" ? existing.map((recipe) => recipe.id) : [];

  // Everything above fails fast with a real status code. Everything below is
  // slow, so it streams — see lib/job-stream.
  return streamJob(async (progress) => {
    progress("Fetching…");
    const source = await fetchSource(url);

    progress(source.kind === "pdf" ? "Reading the recipe card…" : "Reading the recipe…");
    const recipe = await extractFromSource(url, source);

    const images =
      source.kind === "pdf"
        ? await archiveCard(supabase, auth.user.id, source.bytes, recipe, progress)
        : await webHero(supabase, auth.user.id, source, progress);

    progress("Saving…");
    const id = await saveRecipe(supabase, auth.user.id, recipe, { source: "url", sourceUrl: url }, images);

    for (const oldId of replacedIds) await deleteRecipe(supabase, oldId);
    return id;
  });
}

/** Fetch and store the page's lead photograph, if it advertised one. */
async function webHero(
  supabase: ServerClient,
  userId: string,
  source: Source,
  progress: Progress,
): Promise<SavedImage[]> {
  if (source.kind !== "html" || !source.heroUrl) return [];

  progress("Fetching the photo…");
  const fetched = await fetchImage(source.heroUrl);
  if (!fetched) return [];

  // Downscale through the Images binding when it is available; otherwise store
  // the fetched image as-is — a web hero is already a browser-displayable RGB
  // format, so the original is a fine fallback.
  const hero = (await resizeToHero(fetched.bytes)) ?? { bytes: fetched.bytes, mimeType: fetched.mimeType };
  const storagePath = `${userId}/${crypto.randomUUID()}/hero.${extensionFor(hero.mimeType)}`;
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(storagePath, hero.bytes, { contentType: hero.mimeType, upsert: false });
  if (error) throw new Error(error.message);

  return [{ storagePath, kind: "hero", mimeType: hero.mimeType }];
}

function extensionFor(mimeType: string): string {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}

/**
 * Keep the card and its step photographs.
 *
 * The PDF is archived because these URLs are not stable — a meal-kit card id
 * is reused across menu weeks, so `source_url` stops resolving to the recipe
 * stored against it. The archived copy is the only lasting record of what was
 * actually imported.
 *
 * Photographs are best-effort. A card that yields none, or a model that
 * declines to match them, still produces a perfectly good recipe; failing the
 * whole import over a missing picture would be absurd.
 */
async function archiveCard(
  supabase: ServerClient,
  userId: string,
  pdf: Uint8Array,
  recipe: Recipe,
  progress: Progress,
): Promise<SavedImage[]> {
  const batchId = crypto.randomUUID();
  const uploads: SavedImage[] = [];

  const upload = async (name: string, bytes: Uint8Array, mimeType: string) => {
    const storagePath = `${userId}/${batchId}/${name}`;
    const { error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
    if (error) throw new Error(error.message);
    return storagePath;
  };

  try {
    progress("Archiving the card…");
    uploads.push({
      storagePath: await upload("source.pdf", pdf, "application/pdf"),
      kind: "source",
      mimeType: "application/pdf",
    });

    const coverBytes = await findCoverBytes(pdf);
    const hero = coverBytes ? await resizeToHero(coverBytes) : null;
    if (hero) {
      uploads.push({
        storagePath: await upload("hero.jpg", hero.bytes, hero.mimeType),
        kind: "hero",
        mimeType: hero.mimeType,
      });
    }

    const photos = await extractStepPhotos(pdf);
    if (photos.length === 0) return uploads;

    progress(`Matching ${photos.length} photos to steps…`);
    const stepByPhoto = await matchPhotosToSteps(photos, recipe);

    for (const photo of photos) {
      const stepIndex = stepByPhoto.get(photo.index);
      // An unmatched photograph illustrates nothing. Storing it would only
      // give the UI something it cannot place.
      if (stepIndex === undefined) continue;
      uploads.push({
        storagePath: await upload(`step-${photo.index}.jpg`, photo.jpeg, "image/jpeg"),
        kind: "step",
        mimeType: "image/jpeg",
        stepIndex,
      });
    }
    return uploads;
  } catch (error) {
    await supabase.storage.from(IMAGE_BUCKET).remove(uploads.map((u) => u.storagePath));
    throw error;
  }
}
