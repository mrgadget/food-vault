-- Classify each recipe by course, so the collection can be browsed by the kind
-- of dish rather than only by what is in it.
--
-- Run this in the Supabase SQL editor.
--
-- A single course per recipe, the standard culinary axis: what role the dish
-- plays in a meal. Sweet baked goods — cakes, cookies, tarts — fall under
-- 'dessert' rather than getting a form-based bucket of their own, so a recipe
-- is never ambiguously two courses at once.

create type recipe_vault.recipe_course as enum (
  'main',
  'starter',
  'side',
  'salad',
  'soup',
  'breakfast',
  'dessert',
  'snack',
  'drink',
  'sauce',
  'other'
);

alter table recipe_vault.recipes
  add column course recipe_vault.recipe_course not null default 'other';

create index on recipe_vault.recipes (user_id, course);

-- Existing recipes default to 'other'. There is nothing to backfill from — the
-- course was never captured — so they answer "no particular course" until
-- re-imported.
