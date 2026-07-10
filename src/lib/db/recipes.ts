import type { ServerClient } from "@/lib/supabase/server";

import type { Recipe } from "@/lib/schema";
import { IMAGE_BUCKET } from "@/lib/supabase/schema";

export type SavedImage = {
  storagePath: string;
  kind: "front" | "back" | "other" | "step" | "source";
  mimeType: string;
  /** Index into `recipe.steps` of the step this photograph illustrates. */
  stepIndex?: number;
};

/**
 * Persist an extracted recipe and its children.
 *
 * Postgres has no cross-table transaction available over PostgREST, so a
 * failure partway through would leave a recipe with no steps. Children are
 * inserted first-to-last and the recipe row is deleted on any failure; the
 * cascade cleans up whatever landed.
 */
export async function saveRecipe(
  supabase: ServerClient,
  userId: string,
  recipe: Recipe,
  source: { source: "url" | "photo" | "manual"; sourceUrl?: string },
  images: SavedImage[] = [],
): Promise<string> {
  const { data: inserted, error: recipeError } = await supabase
    .from("recipes")
    .insert({
      user_id: userId,
      title: recipe.title,
      description: recipe.description,
      source: source.source,
      source_url: source.sourceUrl ?? null,
      servings: recipe.servings,
      prep_minutes: recipe.prepMinutes,
      cook_minutes: recipe.cookMinutes,
      cuisine: recipe.cuisine,
      tags: recipe.tags,
      ai_notes: recipe.aiNotes,
    })
    .select("id")
    .single();

  if (recipeError || !inserted) {
    throw new Error(`Could not save recipe: ${recipeError?.message ?? "no row returned"}`);
  }
  const recipeId = inserted.id as string;

  try {
    const { data: ingredientRows, error: ingredientError } = await supabase
      .from("ingredients")
      .insert(
        recipe.ingredients.map((ingredient, position) => ({
          recipe_id: recipeId,
          position,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          item: ingredient.item,
          prep_note: ingredient.prepNote,
          group_name: ingredient.groupName,
          inferred: ingredient.inferred,
        })),
      )
      .select("id, item");
    if (ingredientError) throw new Error(ingredientError.message);

    const { data: stepRows, error: stepError } = await supabase
      .from("steps")
      .insert(
        recipe.steps.map((step, position) => ({
          recipe_id: recipeId,
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

    if (recipe.sachetExpansions.length > 0) {
      const { error: sachetError } = await supabase.from("sachet_expansions").insert(
        recipe.sachetExpansions.map((sachet) => ({
          recipe_id: recipeId,
          // Best-effort link back to the ingredient the sachet stands in for.
          // A miss is cosmetic: the expansion still renders on the recipe.
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
      const { error: imageError } = await supabase.from("recipe_images").insert(
        images.map((image, position) => ({
          recipe_id: recipeId,
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
    await supabase.from("recipes").delete().eq("id", recipeId);
    throw error;
  }

  return recipeId;
}

export async function listRecipes(supabase: ServerClient) {
  const { data, error } = await supabase
    .from("recipes")
    .select("id, title, description, cuisine, servings, prep_minutes, cook_minutes, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function getRecipe(supabase: ServerClient, id: string) {
  const { data, error } = await supabase
    .from("recipes")
    .select(
      `*,
       ingredients (*),
       steps (*),
       sachet_expansions (*),
       recipe_images (*)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  data.ingredients.sort((a: { position: number }, b: { position: number }) => a.position - b.position);
  data.steps.sort((a: { position: number }, b: { position: number }) => a.position - b.position);
  return data;
}

/**
 * The bucket is private, so images are reachable only through short-lived
 * signed URLs. One round trip for the whole recipe rather than one per image.
 */
export async function signImageUrls(
  supabase: ServerClient,
  storagePaths: string[],
  expiresInSeconds = 3600,
): Promise<Map<string, string>> {
  if (storagePaths.length === 0) return new Map();

  const { data, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrls(storagePaths, expiresInSeconds);
  if (error) throw new Error(error.message);

  // `path` and `signedUrl` are both nullable per entry: signing one object can
  // fail without failing the batch.
  const signed = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.error || !entry.path || !entry.signedUrl) continue;
    signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}
