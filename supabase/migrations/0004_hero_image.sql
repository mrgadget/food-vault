-- A hero image per recipe, for the listing thumbnail and the detail banner.
--
-- Run this in the Supabase SQL editor.
--
-- Nothing structural to add: a hero is just another row in recipe_images, so
-- this only widens the kind enum. Photo imports need no hero of their own —
-- the listing falls back to the 'front' photo — so this value is populated for
-- URL and PDF imports.

alter type recipe_vault.image_kind add value if not exists 'hero';
