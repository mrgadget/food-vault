import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { anthropic } from "./client";
import type { PdfImage } from "@/lib/import/pdf-images";
import type { Recipe } from "@/lib/schema";

const matchSchema = z.object({
  matches: z.array(
    z.object({
      photoIndex: z.number().describe("The photograph's index, as labelled"),
      stepNumber: z
        .number()
        .nullable()
        .describe("The numbered step it illustrates, or null if it illustrates none"),
    }),
  ),
});

/**
 * Decide which major step each extracted photograph illustrates.
 *
 * The tempting shortcut — nth photo belongs to nth step — is wrong. On a card
 * laid out as a 2x2 grid the paint order is not the reading order: the plated
 * finished dish is painted third but belongs to the fourth step. Nor is the
 * count reliable; a card may print a photograph that illustrates nothing.
 *
 * So the model looks at the pictures. It costs one cheap call, needs no
 * assumption about layout, and when a photograph matches nothing it says so
 * rather than being forced onto a step.
 */
export async function matchPhotosToSteps(
  photos: PdfImage[],
  recipe: Recipe,
): Promise<Map<number, number>> {
  const majors = recipe.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.kind === "major");

  if (photos.length === 0 || majors.length === 0) return new Map();

  const content: Anthropic.ContentBlockParam[] = [];
  photos.forEach((photo) => {
    content.push({ type: "text", text: `Photograph ${photo.index}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: toBase64(photo.jpeg) },
    });
  });
  content.push({
    type: "text",
    text:
      `Match each photograph to the numbered step it illustrates. A photograph may illustrate no step — say null rather than guessing.\n\n` +
      majors.map(({ step }, n) => `${n + 1}. ${step.text}`).join("\n"),
  });

  const response = await anthropic().messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    // Recognising a pan of mince is not hard; the reasoning is in the refusals.
    output_config: { effort: "medium", format: zodOutputFormat(matchSchema) },
    system: "You match photographs from a recipe card to the cooking steps they depict.",
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) return new Map();

  // Photo index -> position of the step within recipe.steps.
  const byPhoto = new Map<number, number>();
  const claimed = new Set<number>();
  for (const match of response.parsed_output.matches) {
    if (match.stepNumber === null) continue;
    const major = majors[match.stepNumber - 1];
    if (!major) continue;
    // A step shows one picture. If the model matched two, keep the first.
    if (claimed.has(major.index)) continue;
    claimed.add(major.index);
    byPhoto.set(match.photoIndex, major.index);
  }
  return byPhoto;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
