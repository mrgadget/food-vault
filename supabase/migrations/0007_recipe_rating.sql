-- A personal 1-5 rating per recipe.
--
-- Run this in the Supabase SQL editor.
--
-- Every recipe belongs to one user (RLS), so this is the owner's own score of
-- their own recipe, not a shared aggregate. Null means unrated, which is a
-- real state distinct from a low score, so there is no default.

alter table recipe_vault.recipes
  add column rating smallint check (rating between 1 and 5);
