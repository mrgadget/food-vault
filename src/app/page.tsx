import Link from "next/link";

import { listRecipes, type RecipeSummary } from "@/lib/db/recipes";
import { createClient } from "@/lib/supabase/server";

const NO_PROTEIN = "none";

type Search = { protein?: string; vegetable?: string };

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
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

  const { protein, vegetable } = await searchParams;
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

  // Facets come from what has actually been imported, so the filters can never
  // offer a choice that matches nothing.
  const proteins = facet(recipes, "protein");
  const vegetables = facet(recipes, "vegetable");

  const visible = recipes.filter(
    (recipe) => matchesProtein(recipe, protein) && matchesVegetable(recipe, vegetable),
  );

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Your recipes</h1>

      <FilterRow
        label="Protein"
        param="protein"
        search={{ protein, vegetable }}
        options={proteins}
        extra={[NO_PROTEIN]}
      />
      <FilterRow
        label="Vegetable"
        param="vegetable"
        search={{ protein, vegetable }}
        options={vegetables}
      />

      {visible.length === 0 ? (
        <p className="mt-10 text-stone-600">
          No recipes match those filters.{" "}
          <Link href="/" className="text-amber-700 underline">
            Clear them
          </Link>
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-stone-200">
          {visible.map((recipe) => (
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
      )}
    </>
  );
}

/** Distinct canonical names in a category, across every recipe. */
function facet(recipes: RecipeSummary[], category: string): string[] {
  const names = new Set<string>();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      if (ingredient.category === category && ingredient.canonical) names.add(ingredient.canonical);
    }
  }
  return [...names].sort();
}

function canonicalsIn(recipe: RecipeSummary, category: string): string[] {
  return recipe.ingredients
    .filter((ingredient) => ingredient.category === category && ingredient.canonical)
    .map((ingredient) => ingredient.canonical as string);
}

function matchesProtein(recipe: RecipeSummary, protein: string | undefined): boolean {
  if (!protein) return true;
  const proteins = canonicalsIn(recipe, "protein");
  // "none" means vegetarian in the loose sense the cook cares about: no meat,
  // no fish, nothing the recipe treats as its protein.
  return protein === NO_PROTEIN ? proteins.length === 0 : proteins.includes(protein);
}

function matchesVegetable(recipe: RecipeSummary, vegetable: string | undefined): boolean {
  if (!vegetable) return true;
  return canonicalsIn(recipe, "vegetable").includes(vegetable);
}

/**
 * Filters are links, not buttons. The page stays a server component, the URL
 * is the state, and a filtered list can be shared or bookmarked.
 */
function FilterRow({
  label,
  param,
  search,
  options,
  extra = [],
}: {
  label: string;
  param: keyof Search;
  search: Search;
  options: string[];
  extra?: string[];
}) {
  if (options.length === 0) return null;

  const selected = search[param];
  const choices = [...extra, ...options];

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      {choices.map((choice) => {
        const active = selected === choice;
        // Toggling one filter must not silently drop the other.
        const next = new URLSearchParams(
          Object.entries(search).filter(([, value]) => value) as [string, string][],
        );
        if (active) next.delete(param);
        else next.set(param, choice);
        const query = next.toString();

        return (
          <Link
            key={choice}
            href={query ? `/?${query}` : "/"}
            className={`rounded-full border px-3 py-1 text-sm ${
              active
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-300 text-stone-700 hover:border-stone-400"
            }`}
          >
            {choice}
          </Link>
        );
      })}
    </div>
  );
}

function totalTime(prep: number | null, cook: number | null): string | null {
  const total = (prep ?? 0) + (cook ?? 0);
  return total > 0 ? `${total} min` : null;
}
