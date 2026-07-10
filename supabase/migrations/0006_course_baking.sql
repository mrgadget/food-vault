-- Add a 'baking' course for baked goods: cakes, scones, muffins, cookies,
-- breads, pastries, pies.
--
-- Run this in the Supabase SQL editor.
--
-- Baked goods cut across the meal-course axis — a scone is afternoon tea, a
-- cake can be dessert or a snack — so without a home of their own they scatter
-- into breakfast, dessert and snack depending on the reading. This gives them
-- one place. 'dessert' now means a sweet course that is not a baked good
-- (ice cream, mousse, trifle, fruit).

alter type recipe_vault.recipe_course add value if not exists 'baking' after 'dessert';
