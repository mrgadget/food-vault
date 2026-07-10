-- Step hierarchy, step photographs, and archived source documents.
--
-- Run this in the Supabase SQL editor. The `alter type ... add value`
-- statements must commit before anything uses the new values, so this file is
-- split into two parts — run part 1, then part 2. Running the whole file at
-- once in the editor is fine, since the editor commits between statements.

-- ---------------------------------------------------------------- part 1 ----

-- Meal-kit cards print numbered steps with a bold lead, each followed by
-- bulleted sub-steps, and hang one photograph off the numbered step. A plain
-- web recipe has no such hierarchy, and emits everything as `major`, so it
-- renders exactly as it does today.
create type recipe_vault.step_kind as enum ('major', 'minor');

-- `step`   a photograph illustrating one numbered step
-- `source` the original document the recipe was extracted from
alter type recipe_vault.image_kind add value if not exists 'step';
alter type recipe_vault.image_kind add value if not exists 'source';

-- ---------------------------------------------------------------- part 2 ----

alter table recipe_vault.steps
  add column kind recipe_vault.step_kind not null default 'major';

-- The photograph points at the step rather than the reverse: a step has at
-- most one picture, an image belongs to at most one step, and this direction
-- lets steps be inserted before the images that illustrate them.
alter table recipe_vault.recipe_images
  add column step_id uuid references recipe_vault.steps (id) on delete set null;

-- The bucket now holds PDFs as well as photographs.
alter table recipe_vault.recipe_images
  add column mime_type text not null default 'image/jpeg';

create index on recipe_vault.recipe_images (step_id);

-- Backfill is unnecessary: `kind` defaults to 'major', which is exactly what
-- every existing flat step already is. Recipes imported before this migration
-- keep their flattened structure — the hierarchy was never captured, so there
-- is nothing to recover. Re-import to get it.
