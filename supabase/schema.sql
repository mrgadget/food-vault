-- RecipeVault schema.
-- Apply with: supabase db push, or paste into the Supabase SQL editor.
--
-- This is the first app in a shared Supabase project. The convention is one
-- Postgres schema per app, named after the app. Nothing an app owns lives in
-- `public`, so two apps can both have a `notes` table, or both need an enum
-- called `source`, without ever knowing about each other.
--
-- What IS shared, deliberately:
--   auth.users       one identity across every app, so one sign-in
--   storage.objects  one object store, partitioned by bucket
--
-- After applying this, expose the schema to the API:
--   Dashboard → Project Settings → API → Exposed schemas → add `recipe_vault`
-- PostgREST will not see the tables otherwise.

create schema if not exists recipe_vault;

-- Enums are schema-scoped, so these names are ours alone.
create type recipe_vault.recipe_source as enum ('url', 'photo', 'manual');
create type recipe_vault.image_kind as enum ('front', 'back', 'other', 'step', 'source');

-- Meal-kit cards print numbered steps with a bold lead, each followed by
-- bulleted sub-steps, and hang one photograph off the numbered step. A plain
-- web recipe has no such hierarchy and emits everything as `major`.
create type recipe_vault.step_kind as enum ('major', 'minor');

-- Lets recipes be filtered by what is in them.  gives the filter its
-- shape;  collapses 'chicken breast', 'chicken thigh' and 'diced
-- chicken' onto 'chicken', without which the filter is a list of every
-- ingredient ever imported.
create type recipe_vault.ingredient_category as enum (
  'protein', 'vegetable', 'fruit', 'grain', 'dairy',
  'legume', 'herb_spice', 'sauce', 'pantry', 'other'
);

-- gen_random_uuid() is in core Postgres since 13; no extension needed.

create table recipe_vault.recipes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  description   text,
  source        recipe_vault.recipe_source not null,
  source_url    text,
  servings      int,
  prep_minutes  int,
  cook_minutes  int,
  cuisine       text,
  tags          text[] not null default '{}',
  notes         text,
  -- What the model had to infer, and why. Surfaced in the UI so the cook
  -- knows which parts of the recipe did not come from the source.
  ai_notes      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table recipe_vault.ingredients (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references recipe_vault.recipes (id) on delete cascade,
  position      int not null,
  -- Null quantity is legitimate ("salt, to taste"), so it is not an error state.
  quantity      numeric,
  unit          text,
  item          text not null,
  prep_note     text,
  group_name    text,
  category      recipe_vault.ingredient_category not null default 'other',
  -- Null for anything not worth filtering on.
  canonical     text,
  inferred      boolean not null default false,
  unique (recipe_id, position)
);

create table recipe_vault.steps (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references recipe_vault.recipes (id) on delete cascade,
  position      int not null,
  -- One ordered sequence, not a tree: a `minor` step belongs to the nearest
  -- `major` step above it. Ordering and re-ordering stay trivial.
  kind          recipe_vault.step_kind not null default 'major',
  text          text not null,
  inferred      boolean not null default false,
  unique (recipe_id, position)
);

-- Meal-kit services ship pre-mixed sachets ("Fajita Spice Blend"). Without the
-- sachet the recipe is uncookable, so we store the model's breakdown of what
-- is in it, keyed to the ingredient row it replaces.
create table recipe_vault.sachet_expansions (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references recipe_vault.recipes (id) on delete cascade,
  ingredient_id uuid references recipe_vault.ingredients (id) on delete cascade,
  sachet_name   text not null,
  components    jsonb not null,
  confidence    text not null check (confidence in ('high', 'medium', 'low')),
  created_at    timestamptz not null default now()
);

-- Holds photographs and, for a URL import, the source document itself. The
-- source is archived because a meal-kit card URL is not stable: HelloFresh
-- reuses card ids across menu weeks, so `recipes.source_url` stops resolving
-- to the recipe stored against it.
create table recipe_vault.recipe_images (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references recipe_vault.recipes (id) on delete cascade,
  -- A step has at most one picture, a picture belongs to at most one step.
  -- Pointing this way lets steps be inserted before the images that show them.
  step_id       uuid references recipe_vault.steps (id) on delete set null,
  storage_path  text not null,
  mime_type     text not null default 'image/jpeg',
  position      int not null,
  kind          recipe_vault.image_kind not null default 'other',
  created_at    timestamptz not null default now(),
  unique (recipe_id, position)
);

create index on recipe_vault.recipes (user_id, created_at desc);
create index on recipe_vault.ingredients (recipe_id);
create index on recipe_vault.ingredients (category, canonical);
create index on recipe_vault.steps (recipe_id);
create index on recipe_vault.sachet_expansions (recipe_id);
create index on recipe_vault.recipe_images (recipe_id);
create index on recipe_vault.recipe_images (step_id);

-- Kept in our own schema rather than a shared one. Five lines duplicated per
-- app is cheaper than a cross-app dependency that nobody owns. An empty
-- search_path forces every reference inside to be schema-qualified, so this
-- cannot be hijacked by a caller's search_path.
create or replace function recipe_vault.touch_updated_at() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger recipes_touch_updated_at
  before update on recipe_vault.recipes
  for each row execute function recipe_vault.touch_updated_at();

-- Row-level security: a user reaches only their own recipes. Child tables have
-- no user_id of their own, so they authorize by joining back to the parent.
alter table recipe_vault.recipes           enable row level security;
alter table recipe_vault.ingredients       enable row level security;
alter table recipe_vault.steps             enable row level security;
alter table recipe_vault.sachet_expansions enable row level security;
alter table recipe_vault.recipe_images     enable row level security;

-- Two details in every policy below:
--
--   `to authenticated` — anon is already stopped by holding no table grant,
--   but naming the role keeps the boundary from resting on that alone. A
--   future grant to anon for some unrelated reason would otherwise open
--   every table at once.
--
--   `(select auth.uid())` — the subselect lets Postgres evaluate the call
--   once per query as an InitPlan rather than once per scanned row. It
--   matters most on the child tables, where it sits inside an EXISTS.

create policy "own recipes" on recipe_vault.recipes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own ingredients" on recipe_vault.ingredients
  for all to authenticated
  using (exists (
    select 1 from recipe_vault.recipes r
    where r.id = ingredients.recipe_id and r.user_id = (select auth.uid())
  ));

create policy "own steps" on recipe_vault.steps
  for all to authenticated
  using (exists (
    select 1 from recipe_vault.recipes r
    where r.id = steps.recipe_id and r.user_id = (select auth.uid())
  ));

create policy "own sachet expansions" on recipe_vault.sachet_expansions
  for all to authenticated
  using (exists (
    select 1 from recipe_vault.recipes r
    where r.id = sachet_expansions.recipe_id and r.user_id = (select auth.uid())
  ));

create policy "own recipe images" on recipe_vault.recipe_images
  for all to authenticated
  using (exists (
    select 1 from recipe_vault.recipes r
    where r.id = recipe_images.recipe_id and r.user_id = (select auth.uid())
  ));

-- Grants. RLS decides which ROWS a role may touch; grants decide whether the
-- role may touch the table at all. `public` has these by default and a new
-- schema does not, so without this block every request fails with
-- "permission denied" no matter how permissive the policies are.
--
-- `anon` is granted nothing: RecipeVault has no public recipes, so an
-- unauthenticated request should be refused at the table, not the row.
grant usage on schema recipe_vault to authenticated;
grant select, insert, update, delete
  on all tables in schema recipe_vault to authenticated;

-- Applies to tables added later, so a new migration cannot silently ship
-- a table that PostgREST refuses to read.
alter default privileges in schema recipe_vault
  grant select, insert, update, delete on tables to authenticated;

-- Storage is shared across every app in this project, partitioned by bucket,
-- so bucket ids carry the app name. Private: images are served through
-- short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('recipe-vault-images', 'recipe-vault-images', false)
on conflict (id) do nothing;

-- Objects are stored under <user_id>/<batch_id>/<n>.jpg, so the first path
-- segment is the ownership check. Scoped to our bucket: storage.objects is a
-- shared table, and a policy that forgot `bucket_id` would grant access to
-- every other app's files.
create policy "own recipe-vault image objects" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'recipe-vault-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
