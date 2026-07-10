-- Classify ingredients so recipes can be filtered by what is in them.
--
-- Run this in the Supabase SQL editor.
--
-- Two columns rather than one. `category` answers "is this a protein" for the
-- filter's shape; `canonical` answers "which one" — "chicken breast", "chicken
-- thigh" and "diced chicken" all reduce to "chicken", or the filter degenerates
-- into a list of every ingredient ever imported.

create type recipe_vault.ingredient_category as enum (
  'protein',
  'vegetable',
  'fruit',
  'grain',
  'dairy',
  'legume',
  'herb_spice',
  'sauce',
  'pantry',
  'other'
);

alter table recipe_vault.ingredients
  add column category recipe_vault.ingredient_category not null default 'other',
  -- Null for anything not worth filtering on; only protein and vegetable rows
  -- are guaranteed to carry one.
  add column canonical text;

create index on recipe_vault.ingredients (category, canonical);

-- Existing rows keep category 'other' and a null canonical, so they answer
-- "no protein, no vegetables" to every filter. There is nothing to backfill
-- from: the classification never existed. Re-import to categorise them.
