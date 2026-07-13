import Link from "next/link";
import { redirect } from "next/navigation";

import { FilterBar, FilterResults } from "./filter-bar";
import { FilterCombo } from "./filter-combo";
import { SearchBox } from "./search-box";
import { listFoods, type FoodSummary } from "@/lib/db/foods";
import { canEdit, getActiveVault } from "@/lib/db/vaults";
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

type Search = { course?: string; protein?: string; vegetable?: string; q?: string };

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) redirect("/login");

  const { course, protein, vegetable, q } = await searchParams;
  const { active } = await getActiveVault(supabase, auth.user.email ?? "");
  const foods = await listFoods(supabase, active.id);
  const writable = canEdit(active.role);

  if (foods.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface/60 p-14 text-center">
        <h1 className="font-display text-2xl font-semibold">
          {writable ? "Nothing in the vault yet" : `Nothing in ${active.name} yet`}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-muted">
          {writable
            ? "Import a food from a URL, or photograph the front and back of a food card."
            : "This vault is empty, or nothing has been shared into it yet."}
        </p>
        {writable && (
          <Link
            href="/import"
            className="mt-6 inline-block rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:-translate-y-px"
          >
            Add your first food
          </Link>
        )}
      </div>
    );
  }

  // Facets come from what has actually been imported, so the filters can never
  // offer a choice that matches nothing.
  const courses = COURSE_ORDER.filter((c) => foods.some((food) => food.course === c));
  const proteins = facet(foods, "protein");
  const vegetables = facet(foods, "vegetable");

  const courseSel = parseList(course);
  const visible = foods.filter(
    (food) =>
      matchesText(food, q) &&
      (courseSel.length === 0 || courseSel.includes(food.course)) &&
      matchesProtein(food, protein) &&
      matchesVegetable(food, vegetable),
  );

  const heroUrls = imageUrls(
    visible.map((food) => food.heroPath).filter((path): path is string => path !== null),
  );

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {active.role === "owner" ? "Your foods" : active.name}
          {!writable && (
            <span className="ml-2 align-middle text-xs font-medium uppercase tracking-wide text-muted">read-only</span>
          )}
        </h1>
        <span className="text-sm text-muted">
          {visible.length === foods.length
            ? `${foods.length} food${foods.length === 1 ? "" : "s"}`
            : `${visible.length} of ${foods.length}`}
        </span>
      </div>

      <FilterBar>
        <div className="mt-6 rounded-card border border-line bg-surface/70 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchBox initial={q ?? ""} />
            <div className="flex flex-wrap gap-2">
              <FilterCombo label="Course" param="course" options={courses} />
              <FilterCombo label="Protein" param="protein" options={proteins} extra={[NO_PROTEIN]} />
              <FilterCombo label="Vegetable" param="vegetable" options={vegetables} />
            </div>
          </div>
        </div>

        <FilterResults>
          {visible.length === 0 ? (
            <p className="mt-12 text-center text-muted">
              No foods match those filters.{" "}
              <Link href="/" className="font-medium text-accent hover:underline">
                Clear them
              </Link>
            </p>
          ) : (
            <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
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
                {/* Mobile: a compact row — thumbnail left, text right. From sm up
                    it unfolds into the taller image-on-top card. */}
                <Link
                  href={`/foods/${food.id}`}
                  className="group flex h-full flex-row overflow-hidden rounded-card border border-line bg-surface shadow-sm transition-all hover:shadow-md sm:flex-col sm:hover:-translate-y-0.5"
                >
                  <div className="relative aspect-square w-24 shrink-0 overflow-hidden bg-accent-soft sm:aspect-[4/3] sm:w-full">
                    {heroUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={heroUrl}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center font-display text-2xl font-semibold text-accent/40 sm:text-4xl">
                        {food.title.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {food.course !== "other" && (
                      <span className="absolute left-2 top-2 rounded-full bg-paper/90 px-2 py-0.5 text-[10px] font-medium capitalize text-ink shadow-sm backdrop-blur-sm sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-xs">
                        {food.course}
                      </span>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
                    <h2 className="font-display text-base font-semibold leading-snug sm:text-lg">{food.title}</h2>
                    {food.rating !== null && (
                      <div className="mt-1">
                        <Stars value={food.rating} />
                      </div>
                    )}
                    {food.description && (
                      <p className="mt-1 line-clamp-1 text-sm text-muted sm:mt-1.5 sm:line-clamp-2">
                        {food.description}
                      </p>
                    )}
                    {meta.length > 0 && (
                      <p className="mt-auto pt-2 text-xs uppercase tracking-wide text-muted sm:pt-3">
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
        </FilterResults>
      </FilterBar>
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

/** A comma-separated filter value → its selected options. */
function parseList(value: string | undefined): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

/** Free-text match across a food's title, description, cuisine and ingredients. */
function matchesText(food: FoodSummary, q: string | undefined): boolean {
  const needle = q?.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [food.title, food.description, food.cuisine, ...food.ingredients.map((i) => i.canonical)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function matchesProtein(food: FoodSummary, protein: string | undefined): boolean {
  const selected = parseList(protein);
  if (selected.length === 0) return true;
  const have = canonicalsIn(food, "protein");
  // OR within the facet; "none" means vegetarian in the loose sense the cook
  // cares about: no meat, no fish, nothing the food treats as its protein.
  return selected.some((p) => (p === NO_PROTEIN ? have.length === 0 : have.includes(p)));
}

function matchesVegetable(food: FoodSummary, vegetable: string | undefined): boolean {
  const selected = parseList(vegetable);
  if (selected.length === 0) return true;
  const have = canonicalsIn(food, "vegetable");
  return selected.some((v) => have.includes(v));
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
