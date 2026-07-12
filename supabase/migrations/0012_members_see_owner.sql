-- Let a member see who owns the vault they're in.
--
-- 0011 locked non-owners down to their own membership row. That's right for the
-- rest of the roster, but a member should still know whose vault it is. Allow
-- reading the OWNER row (only) of any vault you belong to — still no visibility
-- of other viewers/editors.

create policy "read vault owner" on food_vault.subscription_members
  for select to authenticated
  using (role = 'owner' and food_vault.sub_role(subscription_id) is not null);
