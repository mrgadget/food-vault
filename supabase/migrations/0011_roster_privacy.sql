-- Roster privacy.
--
-- 0010's "members read the roster" let ANY member of a vault read every
-- membership row — so a viewer or editor could see the emails of everyone else
-- with access. Only the owner should see the full roster.
--
-- Replace it with "read your own membership row". Owners keep full visibility
-- through the existing "owners manage members" policy (for all → covers select),
-- so they still see the whole roster; everyone else sees only their own row,
-- which is all listVaults needs to know which vaults they belong to.

drop policy "members read the roster" on food_vault.subscription_members;

create policy "read own membership" on food_vault.subscription_members
  for select to authenticated
  using (lower(member_email) = lower((select auth.email())));
