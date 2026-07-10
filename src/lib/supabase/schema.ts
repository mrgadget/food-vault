/**
 * This app's Postgres schema inside a Supabase project shared with other apps.
 *
 * Every table query is scoped to it, so `.from("recipes")` resolves to
 * `recipe_vault.recipes`. It must be listed under Exposed schemas in the
 * project's API settings or PostgREST will not see the tables at all.
 *
 * Storage is not schema-scoped — buckets carry the app name instead.
 */
export const DB_SCHEMA = "recipe_vault";

export const IMAGE_BUCKET = "recipe-vault-images";
