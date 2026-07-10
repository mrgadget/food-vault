import Link from "next/link";

import { listRecipes } from "@/lib/db/recipes";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return (
      <p className="text-stone-600">
        Sign in to see your recipes.{" "}
        <Link href="/login" className="text-amber-700 underline">
          Sign in
        </Link>
      </p>
    );
  }

  const recipes = await listRecipes(supabase);

  if (recipes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center">
        <h1 className="text-xl font-semibold">Nothing in the vault yet</h1>
        <p className="mt-2 text-stone-600">
          Import a recipe from a URL, or photograph the front and back of a recipe card.
        </p>
        <Link
          href="/import"
          className="mt-6 inline-block rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-white"
        >
          Add your first recipe
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Your recipes</h1>
      <ul className="mt-6 divide-y divide-stone-200">
        {recipes.map((recipe) => (
          <li key={recipe.id}>
            <Link href={`/recipes/${recipe.id}`} className="block py-4">
              <h2 className="font-medium">{recipe.title}</h2>
              {recipe.description && (
                <p className="mt-1 line-clamp-2 text-sm text-stone-600">{recipe.description}</p>
              )}
              <p className="mt-2 text-xs uppercase tracking-wide text-stone-500">
                {[
                  recipe.cuisine,
                  recipe.servings && `Serves ${recipe.servings}`,
                  totalTime(recipe.prep_minutes, recipe.cook_minutes),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function totalTime(prep: number | null, cook: number | null): string | null {
  const total = (prep ?? 0) + (cook ?? 0);
  return total > 0 ? `${total} min` : null;
}
