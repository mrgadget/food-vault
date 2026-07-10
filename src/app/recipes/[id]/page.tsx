import { notFound } from "next/navigation";

import { getRecipe, signImageUrls } from "@/lib/db/recipes";
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

type StepRow = { id: string; text: string; inferred: boolean; kind: "major" | "minor" };

type ImageRow = {
  id: string;
  step_id: string | null;
  storage_path: string;
  kind: "front" | "back" | "other" | "step" | "source";
  mime_type: string;
};

/** A numbered step, the bullets beneath it, and the photograph that shows it. */
type Block = { major: StepRow; minors: StepRow[]; photo?: string };

/**
 * Steps arrive as one ordered sequence; a minor step belongs to the nearest
 * major above it. A source that never had a hierarchy is all majors, and falls
 * out of this as a plain numbered list.
 */
function toBlocks(steps: StepRow[], photoByStepId: Map<string, string>): Block[] {
  const blocks: Block[] = [];
  for (const step of steps) {
    if (step.kind === "minor" && blocks.length > 0) {
      blocks[blocks.length - 1].minors.push(step);
      continue;
    }
    // A leading minor step would have no parent. Treat it as a major rather
    // than dropping an instruction on the floor.
    blocks.push({ major: step, minors: [], photo: photoByStepId.get(step.id) });
  }
  return blocks;
}

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

  const images = recipe.recipe_images as ImageRow[];
  const signed = await signImageUrls(supabase, images.map((image) => image.storage_path));

  const photoByStepId = new Map<string, string>();
  for (const image of images) {
    const url = signed.get(image.storage_path);
    if (image.kind === "step" && image.step_id && url) photoByStepId.set(image.step_id, url);
  }
  const sourceDocument = images.find((image) => image.kind === "source");
  const sourceUrl = sourceDocument ? signed.get(sourceDocument.storage_path) : undefined;

  const blocks = toBlocks(recipe.steps as StepRow[], photoByStepId);

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
        <ol className="mt-4 space-y-8">
          {blocks.map((block, index) => (
            <li key={block.major.id} className="flex gap-4">
              <span className="shrink-0 pt-0.5 text-sm font-semibold text-amber-700 tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                {block.photo && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={block.photo}
                    alt=""
                    className="mb-3 w-full rounded-lg border border-stone-200 bg-white"
                  />
                )}
                <p className={block.minors.length > 0 ? "font-medium" : undefined}>
                  <Emphasised text={block.major.text} />
                  {block.major.inferred && <InferredBadge />}
                </p>
                {block.minors.length > 0 && (
                  <ul className="mt-2 space-y-1.5 text-stone-700">
                    {block.minors.map((minor) => (
                      <li key={minor.id} className="flex gap-2">
                        <span aria-hidden className="text-stone-400">
                          •
                        </span>
                        <span>
                          <Emphasised text={minor.text} />
                          {minor.inferred && <InferredBadge />}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {(recipe.source_url || sourceUrl) && (
        <footer className="mt-12 border-t border-stone-200 pt-4 text-sm text-stone-500">
          {sourceUrl && (
            <p>
              <a href={sourceUrl} className="underline" rel="noreferrer noopener">
                View the original card
              </a>{" "}
              — archived when this recipe was imported.
            </p>
          )}
          {recipe.source_url && (
            <p className={sourceUrl ? "mt-1" : undefined}>
              Imported from{" "}
              <a href={recipe.source_url} className="underline" rel="noreferrer noopener">
                {new URL(recipe.source_url).hostname}
              </a>
              {/* Meal-kit card ids are reused across menu weeks, so this link
                  may now lead to an entirely different recipe. */}
              {sourceUrl && ", which may since have changed"}
            </p>
          )}
        </footer>
      )}
    </article>
  );
}

/**
 * Steps carry the source's emphasis as `**bold**` markers.
 *
 * They are rendered by splitting the string, never by injecting markup: the
 * text came from a web page we fetched, and this app exists to import from
 * places we do not control. An unpaired or malformed marker degrades to a
 * literal asterisk, which is a great deal better than an escape hatch.
 */
function Emphasised({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, index) =>
        // Odd indices are the captured groups — the bolded runs.
        index % 2 === 1 ? <strong key={index} className="font-semibold">{part}</strong> : part,
      )}
    </>
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
