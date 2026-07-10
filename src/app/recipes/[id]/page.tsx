import { notFound } from "next/navigation";

import { DeleteRecipeButton } from "./delete-button";
import { StarRating } from "./rating";
import { ServingsScaler } from "./servings";
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
  kind: "front" | "back" | "other" | "step" | "source" | "hero";
  mime_type: string;
};

type SachetRow = {
  id: string;
  sachet_name: string;
  components: SachetComponent[];
  confidence: "high" | "medium" | "low";
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

  const heroImage =
    images.find((image) => image.kind === "hero") ?? images.find((image) => image.kind === "front");
  const heroUrl = heroImage ? signed.get(heroImage.storage_path) : undefined;

  const blocks = toBlocks(recipe.steps as StepRow[], photoByStepId);

  return (
    <article>
      {heroUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={heroUrl}
          alt=""
          className="mb-6 max-h-72 w-full rounded-xl border border-stone-200 object-cover"
        />
      )}
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">{recipe.title}</h1>
        <DeleteRecipeButton id={recipe.id} title={recipe.title} />
      </div>
      {recipe.description && <p className="mt-3 text-stone-600">{recipe.description}</p>}

      <div className="mt-4">
        <StarRating recipeId={recipe.id} initial={recipe.rating} />
      </div>

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

      <ServingsScaler
        baseServings={recipe.servings}
        ingredients={recipe.ingredients as IngredientRow[]}
        sachets={recipe.sachet_expansions as SachetRow[]}
      />

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Method</h2>
        <ol className="mt-4 space-y-6">
          {blocks.map((block, index) => (
            <li key={block.major.id} className="flex gap-4">
              <span className="shrink-0 pt-0.5 text-sm font-semibold text-amber-700 tabular-nums">
                {index + 1}
              </span>
              {/* `overflow-hidden` contains the floated photograph so the next
                  step starts below it rather than wrapping around it. */}
              <div className="min-w-0 flex-1 overflow-hidden">
                {block.photo && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={block.photo}
                    alt=""
                    className="mb-2 ml-4 w-28 rounded-lg border border-stone-200 bg-white sm:float-right sm:w-40"
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
