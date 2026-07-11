-- FoodVault schema.
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
--   Dashboard → Project Settings → API → Exposed schemas → add `food_vault`
-- PostgREST will not see the tables otherwise.

create schema if not exists food_vault;

-- Enums are schema-scoped, so these names are ours alone.
create type food_vault.food_source as enum ('url', 'photo', 'manual');
create type food_vault.image_kind as enum ('front', 'back', 'other', 'step', 'source', 'hero');

-- Meal-kit cards print numbered steps with a bold lead, each followed by
-- bulleted sub-steps, and hang one photograph off the numbered step. A plain
-- web food has no such hierarchy and emits everything as `major`.
create type food_vault.step_kind as enum ('major', 'minor');

-- Lets foods be filtered by what is in them. `category` gives the filter its
-- shape; `canonical` collapses 'chicken breast', 'chicken thigh' and 'diced
-- chicken' onto 'chicken', without which the filter is a list of every
-- ingredient ever imported.
create type food_vault.ingredient_category as enum (
  'protein', 'vegetable', 'fruit', 'grain', 'dairy',
  'legume', 'herb_spice', 'sauce', 'pantry', 'other'
);

-- One course per food, so the collection is browsable by kind of dish.
-- 'baking' is the home for baked goods (cakes, scones, breads); 'dessert' is a
-- sweet course that is not a baked good. Keeping them apart stops a scone or a
-- cake scattering across breakfast/dessert/snack.
create type food_vault.food_course as enum (
  'main', 'starter', 'side', 'salad', 'soup', 'breakfast',
  'dessert', 'baking', 'snack', 'drink', 'sauce', 'other'
);

-- Which measurement system a reader is shown. Amounts are stored metric.
create type food_vault.unit_system as enum ('metric', 'imperial');

-- gen_random_uuid() is in core Postgres since 13; no extension needed.

create table food_vault.foods (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  description   text,
  source        food_vault.food_source not null,
  source_url    text,
  course        food_vault.food_course not null default 'other',
  servings      int,
  prep_minutes  int,
  cook_minutes  int,
  cuisine       text,
  tags          text[] not null default '{}',
  -- The owner's own 1-5 rating; null is unrated, distinct from a low score.
  rating        smallint check (rating between 1 and 5),
  notes         text,
  -- What the model had to infer, and why. Surfaced in the UI so the cook
  -- knows which parts of the food did not come from the source.
  ai_notes      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table food_vault.ingredients (
  id            uuid primary key default gen_random_uuid(),
  food_id     uuid not null references food_vault.foods (id) on delete cascade,
  position      int not null,
  -- Null quantity is legitimate ("salt, to taste"), so it is not an error state.
  quantity      numeric,
  unit          text,
  item          text not null,
  prep_note     text,
  group_name    text,
  category      food_vault.ingredient_category not null default 'other',
  -- Null for anything not worth filtering on.
  canonical     text,
  inferred      boolean not null default false,
  unique (food_id, position)
);

create table food_vault.steps (
  id            uuid primary key default gen_random_uuid(),
  food_id     uuid not null references food_vault.foods (id) on delete cascade,
  position      int not null,
  -- One ordered sequence, not a tree: a `minor` step belongs to the nearest
  -- `major` step above it. Ordering and re-ordering stay trivial.
  kind          food_vault.step_kind not null default 'major',
  text          text not null,
  inferred      boolean not null default false,
  unique (food_id, position)
);

-- Meal-kit services ship pre-mixed sachets ("Fajita Spice Blend"). Without the
-- sachet the food is uncookable, so we store the model's breakdown of what
-- is in it, keyed to the ingredient row it replaces.
create table food_vault.sachet_expansions (
  id            uuid primary key default gen_random_uuid(),
  food_id     uuid not null references food_vault.foods (id) on delete cascade,
  ingredient_id uuid references food_vault.ingredients (id) on delete cascade,
  sachet_name   text not null,
  components    jsonb not null,
  confidence    text not null check (confidence in ('high', 'medium', 'low')),
  created_at    timestamptz not null default now()
);

-- Holds photographs and, for a URL import, the source document itself. The
-- source is archived because a meal-kit card URL is not stable: HelloFresh
-- reuses card ids across menu weeks, so `foods.source_url` stops resolving
-- to the food stored against it.
create table food_vault.food_images (
  id            uuid primary key default gen_random_uuid(),
  food_id     uuid not null references food_vault.foods (id) on delete cascade,
  -- A step has at most one picture, a picture belongs to at most one step.
  -- Pointing this way lets steps be inserted before the images that show them.
  step_id       uuid references food_vault.steps (id) on delete set null,
  storage_path  text not null,
  mime_type     text not null default 'image/jpeg',
  position      int not null,
  kind          food_vault.image_kind not null default 'other',
  created_at    timestamptz not null default now(),
  unique (food_id, position)
);

create index on food_vault.foods (user_id, created_at desc);
create index on food_vault.foods (user_id, course);
create index on food_vault.ingredients (food_id);
create index on food_vault.ingredients (category, canonical);
create index on food_vault.steps (food_id);
create index on food_vault.sachet_expansions (food_id);
create index on food_vault.food_images (food_id);
create index on food_vault.food_images (step_id);

-- Kept in our own schema rather than a shared one. Five lines duplicated per
-- app is cheaper than a cross-app dependency that nobody owns. An empty
-- search_path forces every reference inside to be schema-qualified, so this
-- cannot be hijacked by a caller's search_path.
create or replace function food_vault.touch_updated_at() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger foods_touch_updated_at
  before update on food_vault.foods
  for each row execute function food_vault.touch_updated_at();

-- Row-level security: a user reaches only their own foods. Child tables have
-- no user_id of their own, so they authorize by joining back to the parent.
alter table food_vault.foods           enable row level security;
alter table food_vault.ingredients       enable row level security;
alter table food_vault.steps             enable row level security;
alter table food_vault.sachet_expansions enable row level security;
alter table food_vault.food_images     enable row level security;

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

create policy "own foods" on food_vault.foods
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own ingredients" on food_vault.ingredients
  for all to authenticated
  using (exists (
    select 1 from food_vault.foods r
    where r.id = ingredients.food_id and r.user_id = (select auth.uid())
  ));

create policy "own steps" on food_vault.steps
  for all to authenticated
  using (exists (
    select 1 from food_vault.foods r
    where r.id = steps.food_id and r.user_id = (select auth.uid())
  ));

create policy "own sachet expansions" on food_vault.sachet_expansions
  for all to authenticated
  using (exists (
    select 1 from food_vault.foods r
    where r.id = sachet_expansions.food_id and r.user_id = (select auth.uid())
  ));

create policy "own food images" on food_vault.food_images
  for all to authenticated
  using (exists (
    select 1 from food_vault.foods r
    where r.id = food_images.food_id and r.user_id = (select auth.uid())
  ));

-- Grants. RLS decides which ROWS a role may touch; grants decide whether the
-- role may touch the table at all. `public` has these by default and a new
-- schema does not, so without this block every request fails with
-- "permission denied" no matter how permissive the policies are.
--
-- `anon` is granted nothing: FoodVault has no public foods, so an
-- unauthenticated request should be refused at the table, not the row.
grant usage on schema food_vault to authenticated;
grant select, insert, update, delete
  on all tables in schema food_vault to authenticated;

-- Applies to tables added later, so a new migration cannot silently ship
-- a table that PostgREST refuses to read.
alter default privileges in schema food_vault
  grant select, insert, update, delete on tables to authenticated;

-- Per-user preferences. One row each; amounts are stored metric and this only
-- chooses which system the reader is shown. Declared after the grants so the
-- default privilege above already covers it.
create table food_vault.user_settings (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  unit_system food_vault.unit_system not null default 'metric',
  updated_at  timestamptz not null default now()
);

alter table food_vault.user_settings enable row level security;

create policy "own settings" on food_vault.user_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- LEGACY. Images now live in a Cloudflare R2 bucket (see lib/storage); this
-- Supabase bucket predates that move, keeps its original id, and exists only so
-- the one-off app/api/migrate-storage route can read the old objects out of it.
-- Retire it once migration reads clean.
insert into storage.buckets (id, name, public)
values ('recipe-vault-images', 'recipe-vault-images', false)
on conflict (id) do nothing;

create policy "own legacy image objects" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'recipe-vault-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
