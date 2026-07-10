-- Proves the row-level security policies in schema.sql actually isolate users.
--
-- RLS failures are silent: a broken policy does not raise, it just returns
-- somebody else's rows. So this asserts rather than prints, and raises on any
-- disagreement. Run it in the SQL editor after applying schema.sql.
--
-- Everything happens inside a transaction that is rolled back, including the
-- two throwaway auth.users rows. Nothing survives.
--
-- Note on roles: the SQL editor connects as `postgres`, which has BYPASSRLS.
-- Policies would appear to pass no matter what they said. Each check therefore
-- switches to `authenticated` and sets the JWT claim that auth.uid() reads.

begin;

do $$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
  bob   uuid := '22222222-2222-2222-2222-222222222222';
  alice_recipe uuid;
  bob_recipe   uuid;
  visible int;
  leaked  int;
begin
  -- Two users. Recipes reference auth.users, so these must be real rows.
  insert into auth.users (id, email, aud, role)
  values (alice, 'alice@example.test', 'authenticated', 'authenticated'),
         (bob,   'bob@example.test',   'authenticated', 'authenticated');

  -- Seeded as postgres (bypassing RLS) so the test data itself is not
  -- dependent on the policies under test.
  insert into recipe_vault.recipes (user_id, title, source)
  values (alice, 'Alice pasta', 'manual') returning id into alice_recipe;
  insert into recipe_vault.recipes (user_id, title, source)
  values (bob, 'Bob curry', 'manual') returning id into bob_recipe;

  insert into recipe_vault.ingredients (recipe_id, position, item)
  values (alice_recipe, 0, 'alice garlic'), (bob_recipe, 0, 'bob garlic');

  insert into recipe_vault.steps (recipe_id, position, text)
  values (alice_recipe, 0, 'alice stirs'), (bob_recipe, 0, 'bob stirs');

  -- ---- Act as Alice -------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', alice)::text, true);

  select count(*) into visible from recipe_vault.recipes;
  if visible <> 1 then
    raise exception 'recipes: Alice sees % rows, expected exactly her own', visible;
  end if;

  select count(*) into leaked from recipe_vault.recipes where user_id = bob;
  if leaked <> 0 then
    raise exception 'recipes: Alice can read % of Bob''s rows', leaked;
  end if;

  -- Child tables carry no user_id; they authorize by joining to the parent.
  -- This is the join most likely to be wrong, and it fails silently.
  select count(*) into leaked from recipe_vault.ingredients where item like 'bob%';
  if leaked <> 0 then
    raise exception 'ingredients: Alice can read Bob''s ingredients';
  end if;

  select count(*) into leaked from recipe_vault.steps where text like 'bob%';
  if leaked <> 0 then
    raise exception 'steps: Alice can read Bob''s steps';
  end if;

  -- Writing into Bob's recipe must be refused, not silently dropped.
  begin
    insert into recipe_vault.steps (recipe_id, position, text)
    values (bob_recipe, 99, 'alice injects a step');
    raise exception 'steps: Alice was allowed to write into Bob''s recipe';
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- Claiming a row for another user must be refused by the WITH CHECK clause.
  begin
    insert into recipe_vault.recipes (user_id, title, source)
    values (bob, 'Alice forges a recipe for Bob', 'manual');
    raise exception 'recipes: WITH CHECK did not stop Alice writing as Bob';
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- ---- Act as an unauthenticated visitor ----------------------------------
  -- `anon` is granted nothing, so this must fail at the table, not the row.
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', null, true);

  begin
    select count(*) into visible from recipe_vault.recipes;
    raise exception 'recipes: anon read the table (% rows); it holds no grant', visible;
  exception
    when insufficient_privilege then null; -- expected
  end;

  reset role;
  raise notice 'RLS verified: cross-user reads and writes are denied, anon has no access.';
end $$;

rollback;
