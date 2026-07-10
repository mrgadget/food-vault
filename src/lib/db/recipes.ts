import type { SupabaseClient } from "@supabase/supabase-js";

import type { Recipe } from "@/lib/schema";

export type SavedImage = { storagePath: string; kind: "front" | "back" | "other" };

/**
 * Persist an extracted recipe and its children.
 *
 * Postgres has no cross-table transaction available over PostgREST, so a
 * failure partway through would leave a recipe with no steps. Children are
 * inserted first-to-last and the recipe row is deleted on any failure; the
 * cascade cleans up whatever landed.
 */
export async function saveRecipe(
  supabase: SupabaseClient,
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

    const { error: stepError } = await supabase.from("steps").insert(
      recipe.steps.map((step, position) => ({
        recipe_id: recipeId,
        position,
        text: step.text,
        inferred: step.inferred,
      })),
    );
    if (stepError) throw new Error(stepError.message);

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
          kind: image.kind,
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

export async function listRecipes(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("recipes")
    .select("id, title, description, cuisine, servings, prep_minutes, cook_minutes, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function getRecipe(supabase: SupabaseClient, id: string) {
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
