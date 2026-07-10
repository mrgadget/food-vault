"use client";

import { useState } from "react";

type Ingredient = {
  id: string;
  quantity: number | null;
  unit: string | null;
  item: string;
  prep_note: string | null;
  inferred: boolean;
};

type SachetComponent = { item: string; quantity: number | null; unit: string | null };

type Sachet = {
  id: string;
  sachet_name: string;
  components: SachetComponent[];
  confidence: "high" | "medium" | "low";
};

const CHOICES = [1, 2, 3, 4, 6, 8, 10, 12];

export function ServingsScaler({
  baseServings,
  ingredients,
  sachets,
}: {
  baseServings: number | null;
  ingredients: Ingredient[];
  sachets: Sachet[];
}) {
  const [servings, setServings] = useState(baseServings ?? 0);

  // A recipe that never said how many it serves cannot be scaled: there is no
  // denominator. Show the amounts as written.
  const scalable = baseServings !== null && baseServings > 0;
  const factor = scalable ? servings / baseServings : 1;

  // Always offer the recipe's own figure, even if it is an odd number.
  const options = scalable
    ? [...new Set([...CHOICES, baseServings])].sort((a, b) => a - b)
    : [];

  return (
    <>
      <section className="mt-10 rounded-card border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-2xl font-semibold">Ingredients</h2>
          {scalable && (
            <label className="flex items-center gap-2 text-sm text-muted">
              Serves
              <select
                value={servings}
                onChange={(event) => setServings(Number(event.target.value))}
                className="rounded-lg border border-line bg-paper px-2.5 py-1.5 font-medium text-ink"
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {factor !== 1 && (
          <p className="mt-2 text-sm text-accent">
            Amounts scaled {formatFactor(factor)} from {baseServings}. Cooking times and pan sizes
            are not — use judgement.
          </p>
        )}

        <ul className="mt-4 divide-y divide-line/70">
          {ingredients.map((ingredient) => (
            <li key={ingredient.id} className="flex gap-3 py-2">
              <span className="w-24 shrink-0 text-right font-medium tabular-nums text-accent">
                {formatAmount(scale(ingredient.quantity, factor), ingredient.unit)}
              </span>
              <span>
                {ingredient.item}
                {ingredient.prep_note && (
                  <span className="text-muted">, {ingredient.prep_note}</span>
                )}
                {ingredient.inferred && <InferredBadge />}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {sachets.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl font-semibold">If you don&apos;t have the spice sachets</h2>
          <p className="mt-1 text-sm text-muted">
            Our best reconstruction of each pre-mixed blend, scaled to this recipe.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {sachets.map((sachet) => (
              <div key={sachet.id} className="rounded-card border border-line bg-surface p-5 shadow-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {sachet.sachet_name}
                  <Confidence level={sachet.confidence} />
                </p>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {sachet.components.map((component) => (
                    <li key={component.item} className="flex gap-3">
                      <span className="w-20 shrink-0 text-right tabular-nums text-accent">
                        {formatAmount(scale(component.quantity, factor), component.unit)}
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
    </>
  );
}

/** A null quantity is "to taste", which does not scale. */
function scale(quantity: number | null, factor: number): number | null {
  if (quantity === null) return null;
  const scaled = quantity * factor;

  // Keep small amounts precise and large ones tidy: 0.375 tsp matters, 187.5g
  // of mince does not.
  if (scaled < 1) return round(scaled, 3);
  if (scaled < 10) return round(scaled, 2);
  return round(scaled, 0);
}

function round(value: number, places: number): number {
  const power = 10 ** places;
  return Math.round(value * power) / power;
}

function formatAmount(quantity: number | null, unit: string | null): string {
  if (quantity === null) return unit ?? "";
  return unit ? `${quantity} ${unit}` : String(quantity);
}

function formatFactor(factor: number): string {
  return factor > 1 ? `up ${round(factor, 2)}×` : `down to ${round(factor, 2)}×`;
}

function InferredBadge() {
  return (
    <span
      title="Not stated in the original recipe"
      className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-accent"
    >
      added
    </span>
  );
}

function Confidence({ level }: { level: "high" | "medium" | "low" }) {
  const tone = {
    high: "bg-emerald-100 text-emerald-800",
    medium: "bg-accent-soft text-accent",
    low: "bg-line text-muted",
  }[level];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}>
      {level} confidence
    </span>
  );
}
