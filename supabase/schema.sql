-- RecipeVault schema.
-- Apply with: supabase db push, or paste into the Supabase SQL editor.

create extension if not exists "pgcrypto";

create type recipe_source as enum ('url', 'photo', 'manual');
create type image_kind as enum ('front', 'back', 'other');

create table recipes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  description   text,
  source        recipe_source not null,
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

create table ingredients (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references recipes (id) on delete cascade,
  position      int not null,
  -- Null quantity is legitimate ("salt, to taste"), so it is not an error state.
  quantity      numeric,
  unit          text,
  item          text not null,
  prep_note     text,
  group_name    text,
  inferred      boolean not null default false,
  unique (recipe_id, position)
);

create table steps (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references recipes (id) on delete cascade,
  position      int not null,
  text          text not null,
  inferred      boolean not null default false,
  unique (recipe_id, position)
);

-- Meal-kit services ship pre-mixed sachets ("Fajita Spice Blend"). Without the
-- sachet the recipe is uncookable, so we store the model's breakdown of what
-- is in it, keyed to the ingredient row it replaces.
create table sachet_expansions (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references recipes (id) on delete cascade,
  ingredient_id uuid references ingredients (id) on delete cascade,
  sachet_name   text not null,
  components    jsonb not null,
  confidence    text not null check (confidence in ('high', 'medium', 'low')),
  created_at    timestamptz not null default now()
);

create table recipe_images (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references recipes (id) on delete cascade,
  storage_path  text not null,
  position      int not null,
  kind          image_kind not null default 'other',
  created_at    timestamptz not null default now(),
  unique (recipe_id, position)
);

create index on recipes (user_id, created_at desc);
create index on ingredients (recipe_id);
create index on steps (recipe_id);
create index on sachet_expansions (recipe_id);
create index on recipe_images (recipe_id);

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger recipes_touch_updated_at
  before update on recipes
  for each row execute function touch_updated_at();

-- Row-level security: a user reaches only their own recipes. Child tables have
-- no user_id of their own, so they authorize by joining back to the parent.
alter table recipes           enable row level security;
alter table ingredients       enable row level security;
alter table steps             enable row level security;
alter table sachet_expansions enable row level security;
alter table recipe_images     enable row level security;

create policy "own recipes" on recipes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own ingredients" on ingredients
  for all using (exists (
    select 1 from recipes r where r.id = ingredients.recipe_id and r.user_id = auth.uid()
  ));

create policy "own steps" on steps
  for all using (exists (
    select 1 from recipes r where r.id = steps.recipe_id and r.user_id = auth.uid()
  ));

create policy "own sachet expansions" on sachet_expansions
  for all using (exists (
    select 1 from recipes r where r.id = sachet_expansions.recipe_id and r.user_id = auth.uid()
  ));

create policy "own recipe images" on recipe_images
  for all using (exists (
    select 1 from recipes r where r.id = recipe_images.recipe_id and r.user_id = auth.uid()
  ));

-- Private bucket. Images are served through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', false)
on conflict (id) do nothing;

-- Objects are stored under <user_id>/<recipe_id>/<n>.jpg, so the first path
-- segment is the ownership check.
create policy "own recipe image objects" on storage.objects
  for all using (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
