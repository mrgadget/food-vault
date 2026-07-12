-- Fix infinite recursion when a brand-new user creates their vault.
--
-- The "seed own membership" insert policy checked "is this vault empty" with a
-- subquery ON subscription_members. That self-reference recurses when a fresh
-- user seeds their own owner row (they aren't an owner yet, so the owners-manage
-- policy doesn't apply and this one is evaluated) — Postgres raises "infinite
-- recursion detected in policy". It only surfaced for first sign-ins; the owner
-- path passes owners-manage first and never evaluates the self-referencing one.
--
-- Replace the whole client-side create-then-seed dance with a SECURITY DEFINER
-- function that makes the vault and its owner row in one shot, bypassing RLS.
-- The two now-unused insert policies go with it.

drop policy "seed own membership" on food_vault.subscription_members;
drop policy "create a subscription" on food_vault.subscriptions;

create function food_vault.create_vault(vault_name text)
  returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
  caller text := lower((select auth.email()));
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  insert into food_vault.subscriptions (name)
    values (coalesce(nullif(trim(vault_name), ''), 'My FoodVault'))
    returning id into new_id;
  insert into food_vault.subscription_members (subscription_id, member_email, role)
    values (new_id, caller, 'owner');
  return new_id;
end;
$$;

grant execute on function food_vault.create_vault(text) to authenticated;
