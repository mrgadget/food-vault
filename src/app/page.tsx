import Link from "next/link";

import { listFoods, type FoodSummary } from "@/lib/db/foods";
import { imageUrls } from "@/lib/storage";
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
        <p className="font-display text-2xl font-semibold">Your food vault</p>
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
  const foods = await listFoods(supabase);

  if (foods.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface/60 p-14 text-center">
        <h1 className="font-display text-2xl font-semibold">Nothing in the vault yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-muted">
          Import a food from a URL, or photograph the front and back of a food card.
        </p>
        <Link
          href="/import"
          className="mt-6 inline-block rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:-translate-y-px"
        >
          Add your first food
        </Link>
      </div>
    );
  }

  // Facets come from what has actually been imported, so the filters can never
  // offer a choice that matches nothing.
  const courses = COURSE_ORDER.filter((c) => foods.some((food) => food.course === c));
  const proteins = facet(foods, "protein");
  const vegetables = facet(foods, "vegetable");

  const visible = foods.filter(
    (food) =>
      (!course || food.course === course) &&
      matchesProtein(food, protein) &&
      matchesVegetable(food, vegetable),
  );

  const heroUrls = imageUrls(
    visible.map((food) => food.heroPath).filter((path): path is string => path !== null),
  );

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Your foods</h1>
        <span className="text-sm text-muted">
          {visible.length === foods.length
            ? `${foods.length} food${foods.length === 1 ? "" : "s"}`
            : `${visible.length} of ${foods.length}`}
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
          No foods match those filters.{" "}
          <Link href="/" className="font-medium text-accent hover:underline">
            Clear them
          </Link>
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((food) => {
            const heroUrl = food.heroPath ? heroUrls.get(food.heroPath) : undefined;
            const meta = [
              food.cuisine,
              food.servings && `Serves ${food.servings}`,
              food.prep_minutes && `${food.prep_minutes} min prep`,
              food.cook_minutes && `${food.cook_minutes} min cook`,
            ].filter(Boolean);

            return (
              <li key={food.id}>
                <Link
                  href={`/foods/${food.id}`}
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
                        {food.title.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {food.course !== "other" && (
                      <span className="absolute left-3 top-3 rounded-full bg-paper/90 px-2.5 py-1 text-xs font-medium capitalize text-ink shadow-sm backdrop-blur-sm">
                        {food.course}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <h2 className="font-display text-lg font-semibold leading-snug">{food.title}</h2>
                    {food.rating !== null && (
                      <div className="mt-1">
                        <Stars value={food.rating} />
                      </div>
                    )}
                    {food.description && (
                      <p className="mt-1.5 line-clamp-2 text-sm text-muted">{food.description}</p>
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


/** Distinct canonical names in a category, across every food. */
function facet(foods: FoodSummary[], category: string): string[] {
  const names = new Set<string>();
  for (const food of foods) {
    for (const ingredient of food.ingredients) {
      if (ingredient.category === category && ingredient.canonical) names.add(ingredient.canonical);
    }
  }
  return [...names].sort();
}

function canonicalsIn(food: FoodSummary, category: string): string[] {
  return food.ingredients
    .filter((ingredient) => ingredient.category === category && ingredient.canonical)
    .map((ingredient) => ingredient.canonical as string);
}

function matchesProtein(food: FoodSummary, protein: string | undefined): boolean {
  if (!protein) return true;
  const proteins = canonicalsIn(food, "protein");
  // "none" means vegetarian in the loose sense the cook cares about: no meat,
  // no fish, nothing the food treats as its protein.
  return protein === NO_PROTEIN ? proteins.length === 0 : proteins.includes(protein);
}

function matchesVegetable(food: FoodSummary, vegetable: string | undefined): boolean {
  if (!vegetable) return true;
  return canonicalsIn(food, "vegetable").includes(vegetable);
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
