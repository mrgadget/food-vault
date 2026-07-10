-- Per-user preferences. First one: metric or imperial display.
--
-- Run this in the Supabase SQL editor.
--
-- Amounts are stored metric; this is only which system the reader is shown.
-- Keyed by user, one row each, so it sits in its own table rather than as
-- columns on some existing entity.

create type recipe_vault.unit_system as enum ('metric', 'imperial');

create table recipe_vault.user_settings (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  unit_system recipe_vault.unit_system not null default 'metric',
  updated_at  timestamptz not null default now()
);

alter table recipe_vault.user_settings enable row level security;

create policy "own settings" on recipe_vault.user_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on recipe_vault.user_settings to authenticated;
