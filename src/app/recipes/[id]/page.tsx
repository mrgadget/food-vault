import { notFound } from "next/navigation";

import { getRecipe } from "@/lib/db/recipes";
import { createClient } from "@/lib/supabase/server";

type SachetComponent = { item: string; quantity: number | null; unit: string | null };

type IngredientRow = {
  id: string;
  quantity: number | null;
  unit: string | null;
  item: string;
  prep_note: string | null;
  inferred: boolean;
};

type StepRow = { id: string; text: string; inferred: boolean };

type SachetRow = {
  id: string;
  sachet_name: string;
  components: SachetComponent[];
  confidence: "high" | "medium" | "low";
};

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const recipe = await getRecipe(supabase, id);
  if (!recipe) notFound();

  return (
    <article>
      <h1 className="text-3xl font-semibold tracking-tight">{recipe.title}</h1>
      {recipe.description && <p className="mt-3 text-stone-600">{recipe.description}</p>}

      <p className="mt-4 text-xs uppercase tracking-wide text-stone-500">
        {[
          recipe.cuisine,
          recipe.servings && `Serves ${recipe.servings}`,
          recipe.prep_minutes && `${recipe.prep_minutes} min prep`,
          recipe.cook_minutes && `${recipe.cook_minutes} min cook`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {recipe.ai_notes && (
        <aside className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">What we filled in</p>
          <p className="mt-1 text-amber-900/80">{recipe.ai_notes}</p>
        </aside>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Ingredients</h2>
        <ul className="mt-4 space-y-2">
          {(recipe.ingredients as IngredientRow[]).map((ingredient) => (
            <li key={ingredient.id} className="flex gap-2">
              <span className="text-stone-500 tabular-nums">
                {formatAmount(ingredient.quantity, ingredient.unit)}
              </span>
              <span>
                {ingredient.item}
                {ingredient.prep_note && (
                  <span className="text-stone-500">, {ingredient.prep_note}</span>
                )}
                {ingredient.inferred && <InferredBadge />}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {recipe.sachet_expansions.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">If you don&apos;t have the spice sachets</h2>
          <p className="mt-1 text-sm text-stone-600">
            Our best reconstruction of each pre-mixed blend, scaled to this recipe.
          </p>
          <div className="mt-4 space-y-4">
            {(recipe.sachet_expansions as SachetRow[]).map((sachet) => (
              <div key={sachet.id} className="rounded-lg border border-stone-200 p-4">
                <p className="flex items-center gap-2 font-medium">
                  {sachet.sachet_name}
                  <Confidence level={sachet.confidence} />
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {sachet.components.map((component) => (
                    <li key={component.item} className="flex gap-2">
                      <span className="text-stone-500 tabular-nums">
                        {formatAmount(component.quantity, component.unit)}
                      </span>
                      <span>{component.item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Method</h2>
        <ol className="mt-4 space-y-4">
          {(recipe.steps as StepRow[]).map((step, index) => (
            <li key={step.id} className="flex gap-4">
              <span className="shrink-0 text-sm font-semibold text-amber-700 tabular-nums">
                {index + 1}
              </span>
              <p>
                {step.text}
                {step.inferred && <InferredBadge />}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {recipe.source_url && (
        <footer className="mt-12 border-t border-stone-200 pt-4 text-sm text-stone-500">
          Imported from{" "}
          <a href={recipe.source_url} className="underline" rel="noreferrer noopener">
            {new URL(recipe.source_url).hostname}
          </a>
        </footer>
      )}
    </article>
  );
}

function InferredBadge() {
  return (
    <span
      title="Not stated in the original recipe"
      className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-amber-800"
    >
      added
    </span>
  );
}

function Confidence({ level }: { level: "high" | "medium" | "low" }) {
  const tone = {
    high: "bg-emerald-100 text-emerald-800",
    medium: "bg-amber-100 text-amber-800",
    low: "bg-stone-200 text-stone-700",
  }[level];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}>
      {level} confidence
    </span>
  );
}

function formatAmount(quantity: number | null, unit: string | null): string {
  // A null quantity is "to taste", not a missing value — show only the unit.
  if (quantity === null) return unit ?? "";
  return unit ? `${quantity} ${unit}` : String(quantity);
}
