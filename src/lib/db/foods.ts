import type { ServerClient } from "@/lib/supabase/server";

import type { Food } from "@/lib/schema";
import { deleteImages, getImage, objectKey, putImage } from "@/lib/storage";

export type SavedImage = {
  storagePath: string;
  kind: "front" | "back" | "other" | "step" | "source" | "hero";
  mimeType: string;
  /** Index into `food.steps` of the step this photograph illustrates. */
  stepIndex?: number;
};

/**
 * Persist an extracted food and its children.
 *
 * Postgres has no cross-table transaction available over PostgREST, so a
 * failure partway through would leave a food with no steps. Children are
 * inserted first-to-last and the food row is deleted on any failure; the
 * cascade cleans up whatever landed.
 */
export async function saveFood(
  supabase: ServerClient,
  userId: string,
  // The vault this food belongs to. RLS allows the insert only if the user is
  // its owner or editor. user_id is kept as "who added it".
  subscriptionId: string,
  food: Food,
  source: { source: "url" | "photo" | "manual"; sourceUrl?: string },
  images: SavedImage[] = [],
  // Generated up front so image objects can be keyed by it before the row
  // exists (see lib/storage); callers that don't store images can let it default.
  id: string = crypto.randomUUID(),
): Promise<string> {
  const { data: inserted, error: foodError } = await supabase
    .from("foods")
    .insert({
      id,
      user_id: userId,
      subscription_id: subscriptionId,
      title: food.title,
      description: food.description,
      source: source.source,
      source_url: source.sourceUrl ?? null,
      course: food.course,
      servings: food.servings,
      prep_minutes: food.prepMinutes,
      cook_minutes: food.cookMinutes,
      cuisine: food.cuisine,
      tags: food.tags,
      ai_notes: food.aiNotes,
    })
    .select("id")
    .single();

  if (foodError || !inserted) {
    throw new Error(`Could not save food: ${foodError?.message ?? "no row returned"}`);
  }
  const foodId = inserted.id as string;

  try {
    const { data: ingredientRows, error: ingredientError } = await supabase
      .from("ingredients")
      .insert(
        food.ingredients.map((ingredient, position) => ({
          food_id: foodId,
          position,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          item: ingredient.item,
          prep_note: ingredient.prepNote,
          group_name: ingredient.groupName,
          category: ingredient.category,
          canonical: ingredient.canonical,
          inferred: ingredient.inferred,
        })),
      )
      .select("id, item");
    if (ingredientError) throw new Error(ingredientError.message);

    const { data: stepRows, error: stepError } = await supabase
      .from("steps")
      .insert(
        food.steps.map((step, position) => ({
          food_id: foodId,
          position,
          kind: step.kind,
          text: step.text,
          inferred: step.inferred,
        })),
      )
      .select("id, position");
    if (stepError) throw new Error(stepError.message);

    // Steps are inserted before the images that illustrate them, so the
    // foreign key resolves without a second pass. Postgres does not promise
    // insert order in the returned rows, so index by position rather than by
    // array offset.
    const stepIdByPosition = new Map<number, string>(
      (stepRows ?? []).map((row) => [row.position as number, row.id as string]),
    );

    if (food.sachetExpansions.length > 0) {
      const { error: sachetError } = await supabase.from("sachet_expansions").insert(
        food.sachetExpansions.map((sachet) => ({
          food_id: foodId,
          // Best-effort link back to the ingredient the sachet stands in for.
          // A miss is cosmetic: the expansion still renders on the food.
          ingredient_id:
            ingredientRows?.find((row) =>
              row.item.toLowerCase().includes(sachet.sachetName.toLowerCase()),
            )?.id ?? null,
          sachet_name: sachet.sachetName,
          components: sachet.components,
          confidence: sachet.confidence,
        })),
      );
      if (sachetError) throw new Error(sachetError.message);
    }

    if (images.length > 0) {
      const { error: imageError } = await supabase.from("food_images").insert(
        images.map((image, position) => ({
          food_id: foodId,
          position,
          storage_path: image.storagePath,
          mime_type: image.mimeType,
          kind: image.kind,
          step_id:
            image.stepIndex === undefined ? null : stepIdByPosition.get(image.stepIndex) ?? null,
        })),
      );
      if (imageError) throw new Error(imageError.message);
    }
  } catch (error) {
    await supabase.from("foods").delete().eq("id", foodId);
    throw error;
  }

  return foodId;
}

export type FoodSummary = {
  id: string;
  title: string;
  description: string | null;
  cuisine: string | null;
  course: string;
  rating: number | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  created_at: string;
  ingredients: { category: string; canonical: string | null }[];
  /** Storage path of the listing thumbnail, or null if the food has no image. */
  heroPath: string | null;
};

type ImageForHero = { kind: string; storage_path: string };

/** The thumbnail: a dedicated hero, else the front-of-card photo, else nothing. */
function heroPathFrom(images: ImageForHero[]): string | null {
  return (
    images.find((image) => image.kind === "hero")?.storage_path ??
    images.find((image) => image.kind === "front")?.storage_path ??
    null
  );
}

/**
 * Every food, with just enough of each ingredient to filter on.
 *
 * The filtering happens in JS rather than in the query. Filtering on two
 * different ingredients at once ("chicken AND broccoli") is a relational
 * division, which PostgREST cannot express without a view or an RPC — and a
 * personal food vault holds hundreds of rows, not millions. If that ever
 * stops being true, this is the thing to move into Postgres.
 */
export async function listFoods(supabase: ServerClient, subscriptionId: string): Promise<FoodSummary[]> {
  const { data, error } = await supabase
    .from("foods")
    .select(
      "id, title, description, cuisine, course, rating, servings, prep_minutes, cook_minutes, created_at, ingredients (category, canonical), food_images (kind, storage_path)",
    )
    .eq("subscription_id", subscriptionId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const { food_images, ...rest } = row as typeof row & { food_images: ImageForHero[] };
    return { ...rest, heroPath: heroPathFrom(food_images) } as unknown as FoodSummary;
  });
}

/** Set or clear the owner's rating. RLS scopes the update to the signed-in user. */
export async function setFoodRating(
  supabase: ServerClient,
  id: string,
  rating: number | null,
): Promise<void> {
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new Error("Rating must be a whole number from 1 to 5, or null.");
  }
  const { error } = await supabase.from("foods").update({ rating }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Existing foods in this vault imported from the same URL — so a re-import can
 * offer to replace or skip rather than silently duplicating. Scoped to the one
 * vault, since the same recipe may legitimately live in several.
 */
export async function findFoodsBySourceUrl(
  supabase: ServerClient,
  subscriptionId: string,
  sourceUrl: string,
): Promise<{ id: string; title: string }[]> {
  const { data, error } = await supabase
    .from("foods")
    .select("id, title")
    .eq("subscription_id", subscriptionId)
    .eq("source_url", sourceUrl);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; title: string }[];
}

/**
 * Just enough of every food in a vault to tell whether something is already
 * here — by the link it came from, or by its name. Feeds the bulk importer's
 * duplicate check (see lib/import/hellofresh).
 */
export async function listImportKeys(
  supabase: ServerClient,
  subscriptionId: string,
): Promise<{ title: string; sourceUrl: string | null }[]> {
  const { data, error } = await supabase
    .from("foods")
    .select("title, source_url")
    .eq("subscription_id", subscriptionId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    title: row.title as string,
    sourceUrl: (row.source_url as string | null) ?? null,
  }));
}

/**
 * Delete a food, its children, and the images it owns.
 *
 * The rows go by cascade. The storage objects do not — nothing in Postgres
 * knows about the bucket — so they are removed first. Losing an image whose
 * row survives is the worse failure of the two, so ordering it this way means
 * a mid-way failure leaves an orphaned row pointing at a missing file, which
 * the food page already tolerates, rather than a file nobody can reach.
 */
export async function deleteFood(supabase: ServerClient, id: string): Promise<void> {
  const { data: images, error: imageError } = await supabase
    .from("food_images")
    .select("storage_path")
    .eq("food_id", id);
  if (imageError) throw new Error(imageError.message);

  const paths = (images ?? []).map((image) => image.storage_path as string);
  await deleteImages(paths);

  // RLS scopes this to the signed-in user; a wrong id deletes nothing.
  const { error } = await supabase.from("foods").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getFood(supabase: ServerClient, id: string) {
  const { data, error } = await supabase
    .from("foods")
    .select(
      `*,
       ingredients (*),
       steps (*),
       sachet_expansions (*),
       food_images (*)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  data.ingredients.sort((a: { position: number }, b: { position: number }) => a.position - b.position);
  data.steps.sort((a: { position: number }, b: { position: number }) => a.position - b.position);
  return data;
}

type SourceRow = { id: string; position: number; [key: string]: unknown };

/**
 * Deep-copy a food into another vault, images and all.
 *
 * Used when someone reading a shared vault wants their own editable copy. The
 * source is read under the caller's RLS (they can see it), and every child row
 * and storage object is re-created under a fresh food id in `targetVaultId` —
 * RLS allows the writes only if the caller owns or edits that vault. The copy
 * starts unrated: a rating belongs to the person who gave it. Same
 * children-first, delete-on-failure shape as saveFood, since PostgREST gives us
 * no transaction.
 */
export async function copyFood(
  supabase: ServerClient,
  sourceId: string,
  targetVaultId: string,
  userId: string,
): Promise<string> {
  const src = await getFood(supabase, sourceId);
  if (!src) throw new Error("That food no longer exists.");

  const newId = crypto.randomUUID();
  const { error: foodError } = await supabase.from("foods").insert({
    id: newId,
    user_id: userId,
    subscription_id: targetVaultId,
    title: src.title,
    description: src.description,
    source: src.source,
    source_url: src.source_url,
    course: src.course,
    servings: src.servings,
    prep_minutes: src.prep_minutes,
    cook_minutes: src.cook_minutes,
    cuisine: src.cuisine,
    tags: src.tags,
    ai_notes: src.ai_notes,
  });
  if (foodError) throw new Error(`Could not save food: ${foodError.message}`);

  try {
    const ingredients = src.ingredients as SourceRow[];
    if (ingredients.length > 0) {
      const { error } = await supabase.from("ingredients").insert(
        ingredients.map((row) => {
          const { id: _id, food_id: _foodId, ...rest } = row as SourceRow & { food_id: string };
          return { ...rest, food_id: newId };
        }),
      );
      if (error) throw new Error(error.message);
    }

    const steps = src.steps as SourceRow[];
    // Old step id → position, so image rows can find their new step by position.
    const positionByOldStep = new Map<string, number>(steps.map((row) => [row.id, row.position]));
    let stepIdByPosition = new Map<number, string>();
    if (steps.length > 0) {
      const { data: newSteps, error } = await supabase
        .from("steps")
        .insert(
          steps.map((row) => {
            const { id: _id, food_id: _foodId, created_at: _createdAt, ...rest } = row as SourceRow & {
              food_id: string;
            };
            return { ...rest, food_id: newId };
          }),
        )
        .select("id, position");
      if (error) throw new Error(error.message);
      stepIdByPosition = new Map((newSteps ?? []).map((r) => [r.position as number, r.id as string]));
    }

    const sachets = src.sachet_expansions as SourceRow[];
    if (sachets.length > 0) {
      const { error } = await supabase.from("sachet_expansions").insert(
        sachets.map((row) => {
          // Drop the ingredient link rather than remap it: it's a cosmetic
          // best-effort pointer and the expansion renders fine without it.
          const {
            id: _id,
            food_id: _foodId,
            ingredient_id: _ingredientId,
            created_at: _createdAt,
            ...rest
          } = row as SourceRow & { food_id: string; ingredient_id: string | null };
          return { ...rest, food_id: newId, ingredient_id: null };
        }),
      );
      if (error) throw new Error(error.message);
    }

    const images = src.food_images as (SourceRow & {
      storage_path: string;
      mime_type: string;
      step_id: string | null;
    })[];
    if (images.length > 0) {
      const rows = [];
      for (const image of images) {
        // Copy the object to a key under the new food id so the copy is
        // self-contained and survives the original being deleted.
        const name = image.storage_path.split("/").pop() ?? crypto.randomUUID();
        const newPath = objectKey(newId, name);
        const object = await getImage(image.storage_path);
        if (object) {
          const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
          await putImage(newPath, bytes, object.httpMetadata?.contentType ?? image.mime_type);
        }
        const oldPosition = image.step_id === null ? undefined : positionByOldStep.get(image.step_id);
        rows.push({
          food_id: newId,
          position: image.position,
          storage_path: newPath,
          mime_type: image.mime_type,
          kind: image.kind,
          step_id: oldPosition === undefined ? null : stepIdByPosition.get(oldPosition) ?? null,
        });
      }
      const { error } = await supabase.from("food_images").insert(rows);
      if (error) throw new Error(error.message);
    }
  } catch (error) {
    await supabase.from("foods").delete().eq("id", newId);
    throw error;
  }

  return newId;
}

