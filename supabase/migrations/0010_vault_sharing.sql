-- Subscriptions: the vault becomes a first-class, shareable, billable thing.
--
-- A subscription IS a vault. Foods belong to a subscription, not to a user.
-- Users reach a vault by being a member of it, at a role: 'owner' (manages
-- members + billing, read/write), 'editor' (read/write), 'viewer' (read-only).
-- A person can belong to several subscriptions — their own and others'.
--
-- Billing attaches to the subscription: a `status` gates access, so a lapsed or
-- cancelled subscription locks out members through RLS (the owner keeps access,
-- so they can fix billing or export). Plan/price/processor columns land on the
-- subscriptions table when it becomes payable.

create table food_vault.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'My vault',
  status     text not null default 'active' check (status in ('active', 'past_due', 'cancelled')),
  created_at timestamptz not null default now()
);

-- Membership by email, so someone can be invited before they have an account;
-- their session's auth.email() matches the row once they sign up. Lower-cased
-- by the app.
create table food_vault.subscription_members (
  subscription_id uuid not null references food_vault.subscriptions (id) on delete cascade,
  member_email    text not null,
  role            text not null default 'viewer' check (role in ('owner', 'editor', 'viewer')),
  created_at      timestamptz not null default now(),
  primary key (subscription_id, member_email)
);

create index on food_vault.subscription_members (member_email);

-- Foods hang off a subscription now. user_id stays as "who added it" (handy for
-- attribution in a shared vault) but no longer decides access.
alter table food_vault.foods add column subscription_id uuid references food_vault.subscriptions (id) on delete cascade;

-- Backfill: give every existing owner a personal vault, make them its owner, and
-- move their foods into it.
do $$
declare rec record;
declare sub_id uuid;
begin
  for rec in
    select f.user_id, lower(u.email) as email
    from food_vault.foods f
    join auth.users u on u.id = f.user_id
    group by f.user_id, lower(u.email)
  loop
    insert into food_vault.subscriptions (name)
      values (split_part(rec.email, '@', 1) || '''s vault')
      returning id into sub_id;
    insert into food_vault.subscription_members (subscription_id, member_email, role)
      values (sub_id, rec.email, 'owner');
    update food_vault.foods set subscription_id = sub_id where user_id = rec.user_id;
  end loop;
end $$;

alter table food_vault.foods alter column subscription_id set not null;
create index on food_vault.foods (subscription_id, created_at desc);

alter table food_vault.subscriptions        enable row level security;
alter table food_vault.subscription_members enable row level security;

-- The caller's role in a subscription. Owners always pass; other roles only
-- while the subscription is active (the billing gate). security definer so it
-- reads membership without recursing through these tables' own policies.
create function food_vault.sub_role(sub uuid)
  returns text
  language sql stable security definer set search_path = ''
as $$
  select m.role
  from food_vault.subscription_members m
  join food_vault.subscriptions s on s.id = m.subscription_id
  where m.subscription_id = sub
    and lower(m.member_email) = lower((select auth.email()))
    and (m.role = 'owner' or s.status = 'active')
  limit 1;
$$;

create function food_vault.food_role(fid uuid)
  returns text
  language sql stable security definer set search_path = ''
as $$
  select food_vault.sub_role(f.subscription_id) from food_vault.foods f where f.id = fid;
$$;

grant execute on function food_vault.sub_role(uuid) to authenticated;
grant execute on function food_vault.food_role(uuid) to authenticated;

-- Subscriptions + members: a member can see the vaults they belong to and who
-- else is in them; only an owner can rename, change billing, or manage members.
create policy "members read their subscriptions" on food_vault.subscriptions
  for select to authenticated using (food_vault.sub_role(id) is not null);
create policy "owners update their subscriptions" on food_vault.subscriptions
  for update to authenticated
  using (food_vault.sub_role(id) = 'owner') with check (food_vault.sub_role(id) = 'owner');
-- Any authenticated user may create a vault (their own); they add themselves as
-- owner in the same transaction (app-side).
create policy "create a subscription" on food_vault.subscriptions
  for insert to authenticated with check (true);

create policy "members read the roster" on food_vault.subscription_members
  for select to authenticated using (food_vault.sub_role(subscription_id) is not null);
create policy "owners manage members" on food_vault.subscription_members
  for all to authenticated
  using (food_vault.sub_role(subscription_id) = 'owner')
  with check (food_vault.sub_role(subscription_id) = 'owner');
-- A creator seeds their own owner row when first making a vault. Restricted to a
-- vault that has no members yet, so nobody can insert themselves as owner into
-- someone else's existing vault — once an owner exists, "owners manage members"
-- is the only way in.
create policy "seed own membership" on food_vault.subscription_members
  for insert to authenticated
  with check (
    lower(member_email) = lower((select auth.email()))
    and role = 'owner'
    and not exists (
      select 1 from food_vault.subscription_members existing
      where existing.subscription_id = subscription_members.subscription_id
    )
  );

-- Foods and children: read for any member, write for owner/editor. Replaces the
-- old owner-only policies.
drop policy "own foods" on food_vault.foods;
create policy "read foods" on food_vault.foods
  for select to authenticated using (food_vault.sub_role(subscription_id) is not null);
create policy "write foods" on food_vault.foods
  for all to authenticated
  using (food_vault.sub_role(subscription_id) in ('owner', 'editor'))
  with check (food_vault.sub_role(subscription_id) in ('owner', 'editor'));

drop policy "own ingredients" on food_vault.ingredients;
create policy "read ingredients" on food_vault.ingredients
  for select to authenticated using (food_vault.food_role(food_id) is not null);
create policy "write ingredients" on food_vault.ingredients
  for all to authenticated
  using (food_vault.food_role(food_id) in ('owner', 'editor'))
  with check (food_vault.food_role(food_id) in ('owner', 'editor'));

drop policy "own steps" on food_vault.steps;
create policy "read steps" on food_vault.steps
  for select to authenticated using (food_vault.food_role(food_id) is not null);
create policy "write steps" on food_vault.steps
  for all to authenticated
  using (food_vault.food_role(food_id) in ('owner', 'editor'))
  with check (food_vault.food_role(food_id) in ('owner', 'editor'));

drop policy "own sachet expansions" on food_vault.sachet_expansions;
create policy "read sachet expansions" on food_vault.sachet_expansions
  for select to authenticated using (food_vault.food_role(food_id) is not null);
create policy "write sachet expansions" on food_vault.sachet_expansions
  for all to authenticated
  using (food_vault.food_role(food_id) in ('owner', 'editor'))
  with check (food_vault.food_role(food_id) in ('owner', 'editor'));

drop policy "own food images" on food_vault.food_images;
create policy "read food images" on food_vault.food_images
  for select to authenticated using (food_vault.food_role(food_id) is not null);
create policy "write food images" on food_vault.food_images
  for all to authenticated
  using (food_vault.food_role(food_id) in ('owner', 'editor'))
  with check (food_vault.food_role(food_id) in ('owner', 'editor'));

-- user_settings stays personal (per user, not per vault).
