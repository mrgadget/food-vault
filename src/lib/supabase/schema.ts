/**
 * This app's Postgres schema inside a Supabase project shared with other apps.
 *
 * Every table query is scoped to it, so `.from("foods")` resolves to
 * `food_vault.foods`. It must be listed under Exposed schemas in the
 * project's API settings or PostgREST will not see the tables at all.
 *
 * Images live in a Cloudflare R2 bucket, not Supabase Storage (see lib/storage).
 */
export const DB_SCHEMA = "food_vault";
