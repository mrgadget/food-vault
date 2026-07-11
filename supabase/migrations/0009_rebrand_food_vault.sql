-- Rebrand: recipe_vault → food_vault.
--
-- Renames the schema, its two "recipe" tables, the recipe_id foreign-key
-- columns, the two enum types, the touch trigger, and the two policy names that
-- carried the old word. Everything else already reads the same in both worlds.
--
-- Renames preserve the data and everything attached to the renamed object —
-- grants, RLS policies, indexes, foreign keys, the trigger's link to its
-- function — so no rows move and no access changes.
--
-- CUTOVER: the app talks to food_vault the instant this lands, and the running
-- build still talks to recipe_vault, so apply this and deploy the matching build
-- together. Two manual dashboard steps go with it:
--   1. Project Settings → API → Exposed schemas: add `food_vault` (remove
--      `recipe_vault`). PostgREST cannot see an unexposed schema.
--   2. Nothing else here — storage moved to R2 separately.

alter schema recipe_vault rename to food_vault;

alter type food_vault.recipe_source rename to food_source;
alter type food_vault.recipe_course rename to food_course;

alter table food_vault.recipes rename to foods;
alter table food_vault.recipe_images rename to food_images;

alter table food_vault.ingredients       rename column recipe_id to food_id;
alter table food_vault.steps             rename column recipe_id to food_id;
alter table food_vault.sachet_expansions rename column recipe_id to food_id;
alter table food_vault.food_images       rename column recipe_id to food_id;

alter trigger recipes_touch_updated_at on food_vault.foods rename to foods_touch_updated_at;

alter policy "own recipes" on food_vault.foods rename to "own foods";
alter policy "own recipe images" on food_vault.food_images rename to "own food images";
