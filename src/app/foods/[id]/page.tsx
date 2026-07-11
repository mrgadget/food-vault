import { notFound } from "next/navigation";

import { DeleteFoodButton } from "./delete-button";
import { StarRating } from "./rating";
import { ServingsScaler } from "./servings";
import { getFood } from "@/lib/db/foods";
import { getUnitSystem } from "@/lib/db/settings";
import { imageUrls } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { convertTemperatures, type UnitSystem } from "@/lib/units";

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
function toBlocks(
  steps: StepRow[],
  photoByStepId: Map<string, string>,
  system: UnitSystem,
): Block[] {
  // Oven temperatures are stored in Celsius; convert them in the text for an
  // imperial reader before the steps are grouped and rendered.
  const withTemps = steps.map((step) => ({
    ...step,
    text: convertTemperatures(step.text, system),
  }));

  const blocks: Block[] = [];
  for (const step of withTemps) {
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

export default async function FoodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const food = await getFood(supabase, id);
  if (!food) notFound();

  const system = await getUnitSystem(supabase);

  const images = food.food_images as ImageRow[];
  const signed = imageUrls(images.map((image) => image.storage_path));

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

  const blocks = toBlocks(food.steps as StepRow[], photoByStepId, system);

  const meta = [
    food.course !== "other" ? food.course : null,
    food.cuisine,
    food.servings && `Serves ${food.servings}`,
    food.prep_minutes && `${food.prep_minutes} min prep`,
    food.cook_minutes && `${food.cook_minutes} min cook`,
  ].filter((value): value is string => Boolean(value));

  return (
    <article className="mx-auto max-w-3xl">
      {heroUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={heroUrl}
          alt=""
          className="mb-8 max-h-80 w-full rounded-card object-cover shadow-md"
        />
      )}
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight">
          {food.title}
        </h1>
        <DeleteFoodButton id={food.id} title={food.title} />
      </div>
      {food.description && <p className="mt-3 text-lg text-muted">{food.description}</p>}

      <div className="mt-5">
        <StarRating foodId={food.id} initial={food.rating} />
      </div>

      {meta.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {meta.map((item) => (
            <span
              key={item}
              className="rounded-full bg-surface px-3 py-1 text-sm capitalize text-muted ring-1 ring-line"
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {food.ai_notes && (
        <aside className="mt-8 rounded-card border border-accent/20 bg-accent-soft/60 p-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">What we filled in</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink/80">
            {convertTemperatures(food.ai_notes, system)}
          </p>
        </aside>
      )}

      <ServingsScaler
        baseServings={food.servings}
        ingredients={food.ingredients as IngredientRow[]}
        sachets={food.sachet_expansions as SachetRow[]}
        system={system}
      />

      <section className="mt-12">
        <h2 className="font-display text-2xl font-semibold">Method</h2>
        <ol className="mt-5 space-y-7">
          {blocks.map((block, index) => (
            <li key={block.major.id} className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-sm font-semibold text-accent tabular-nums">
                {index + 1}
              </span>
              {/* `overflow-hidden` contains the floated photograph so the next
                  step starts below it rather than wrapping around it. */}
              <div className="min-w-0 flex-1 overflow-hidden pt-0.5">
                {block.photo && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={block.photo}
                    alt=""
                    className="mb-2 ml-4 w-28 rounded-xl shadow-sm sm:float-right sm:w-44"
                  />
                )}
                <p className={block.minors.length > 0 ? "font-medium" : "leading-relaxed"}>
                  <Emphasised text={block.major.text} />
                  {block.major.inferred && <InferredBadge />}
                </p>
                {block.minors.length > 0 && (
                  <ul className="mt-2.5 space-y-2 text-ink/80">
                    {block.minors.map((minor) => (
                      <li key={minor.id} className="flex gap-2.5 leading-relaxed">
                        <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent/50" />
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

      {(food.source_url || sourceUrl) && (
        <footer className="mt-14 border-t border-line pt-5 text-sm text-muted">
          {sourceUrl && (
            <p>
              <a href={sourceUrl} className="text-accent hover:underline" rel="noreferrer noopener">
                View the original card
              </a>{" "}
              — archived when this food was imported.
            </p>
          )}
          {food.source_url && (
            <p className={sourceUrl ? "mt-1" : undefined}>
              Imported from{" "}
              <a href={food.source_url} className="text-accent hover:underline" rel="noreferrer noopener">
                {new URL(food.source_url).hostname}
              </a>
              {/* Meal-kit card ids are reused across menu weeks, so this link
                  may now lead to an entirely different food. */}
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
      title="Not stated in the original food"
      className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-accent"
    >
      added
    </span>
  );
}
