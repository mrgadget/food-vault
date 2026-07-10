import Link from "next/link";

import { listRecipes, signImageUrls, type RecipeSummary } from "@/lib/db/recipes";
import { createClient } from "@/lib/supabase/server";

const NO_PROTEIN = "none";

// The order a cook would scan them in, not alphabetical.
const COURSE_ORDER = [
  "main",
  "starter",
  "side",
  "salad",
  "soup",
  "breakfast",
  "dessert",
  "baking",
  "snack",
  "drink",
  "sauce",
  "other",
];

type Search = { course?: string; protein?: string; vegetable?: string };

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return (
      <div className="mx-auto max-w-md rounded-card border border-line bg-surface p-10 text-center shadow-sm">
        <p className="font-display text-2xl font-semibold">Your recipe vault</p>
        <p className="mt-2 text-muted">Sign in to see everything you&apos;ve saved.</p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper shadow-sm transition-transform hover:-translate-y-px"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const { course, protein, vegetable } = await searchParams;
  const recipes = await listRecipes(supabase);

  if (recipes.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface/60 p-14 text-center">
        <h1 className="font-display text-2xl font-semibold">Nothing in the vault yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-muted">
          Import a recipe from a URL, or photograph the front and back of a recipe card.
        </p>
        <Link
          href="/import"
          className="mt-6 inline-block rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:-translate-y-px"
        >
          Add your first recipe
        </Link>
      </div>
    );
  }

  // Facets come from what has actually been imported, so the filters can never
  // offer a choice that matches nothing.
  const courses = COURSE_ORDER.filter((c) => recipes.some((recipe) => recipe.course === c));
  const proteins = facet(recipes, "protein");
  const vegetables = facet(recipes, "vegetable");

  const visible = recipes.filter(
    (recipe) =>
      (!course || recipe.course === course) &&
      matchesProtein(recipe, protein) &&
      matchesVegetable(recipe, vegetable),
  );

  // Sign every visible thumbnail in one round trip rather than per card.
  const heroUrls = await signImageUrls(
    supabase,
    visible.map((recipe) => recipe.heroPath).filter((path): path is string => path !== null),
  );

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Your recipes</h1>
        <span className="text-sm text-muted">
          {visible.length === recipes.length
            ? `${recipes.length} recipe${recipes.length === 1 ? "" : "s"}`
            : `${visible.length} of ${recipes.length}`}
        </span>
      </div>

      <div className="mt-6 space-y-2.5 rounded-card border border-line bg-surface/70 p-4">
        <FilterRow label="Course" param="course" search={{ course, protein, vegetable }} options={courses} />
        <FilterRow
          label="Protein"
          param="protein"
          search={{ course, protein, vegetable }}
          options={proteins}
          extra={[NO_PROTEIN]}
        />
        <FilterRow
          label="Vegetable"
          param="vegetable"
          search={{ course, protein, vegetable }}
          options={vegetables}
        />
      </div>

      {visible.length === 0 ? (
        <p className="mt-12 text-center text-muted">
          No recipes match those filters.{" "}
          <Link href="/" className="font-medium text-accent hover:underline">
            Clear them
          </Link>
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((recipe) => {
            const heroUrl = recipe.heroPath ? heroUrls.get(recipe.heroPath) : undefined;
            const meta = [
              recipe.cuisine,
              recipe.servings && `Serves ${recipe.servings}`,
              recipe.prep_minutes && `${recipe.prep_minutes} min prep`,
              recipe.cook_minutes && `${recipe.cook_minutes} min cook`,
            ].filter(Boolean);

            return (
              <li key={recipe.id}>
                <Link
                  href={`/recipes/${recipe.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-accent-soft">
                    {heroUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={heroUrl}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center font-display text-4xl font-semibold text-accent/40">
                        {recipe.title.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {recipe.course !== "other" && (
                      <span className="absolute left-3 top-3 rounded-full bg-paper/90 px-2.5 py-1 text-xs font-medium capitalize text-ink shadow-sm backdrop-blur-sm">
                        {recipe.course}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <h2 className="font-display text-lg font-semibold leading-snug">{recipe.title}</h2>
                    {recipe.rating !== null && (
                      <div className="mt-1">
                        <Stars value={recipe.rating} />
                      </div>
                    )}
                    {recipe.description && (
                      <p className="mt-1.5 line-clamp-2 text-sm text-muted">{recipe.description}</p>
                    )}
                    {meta.length > 0 && (
                      <p className="mt-auto pt-3 text-xs uppercase tracking-wide text-muted">
                        {meta.join(" · ")}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
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
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
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
            className={`rounded-full border px-3 py-1 text-sm capitalize transition-colors ${
              active
                ? "border-accent bg-accent text-accent-fg"
                : "border-line bg-surface text-ink hover:border-accent/50"
            }`}
          >
            {choice}
          </Link>
        );
      })}
    </div>
  );
}

/** Read-only rating for the listing. */
function Stars({ value }: { value: number }) {
  return (
    <span className="shrink-0 text-sm tracking-tight text-accent" aria-label={`Rated ${value} of 5`}>
      {"★".repeat(value)}
      <span className="text-line">{"★".repeat(5 - value)}</span>
    </span>
  );
}
