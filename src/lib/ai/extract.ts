import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";

import { anthropic, MODEL } from "./client";
import {
  EXTRACTION_SYSTEM_PROMPT,
  PDF_USER_PROMPT,
  PHOTO_USER_PROMPT,
  URL_USER_PROMPT,
} from "./prompt";
import type { Source } from "@/lib/import/fetch-page";
import { UserFacingError } from "@/lib/job-stream";
import { recipeSchema, type Recipe } from "@/lib/schema";

export type ImageInput = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
};

export class ExtractionRefused extends UserFacingError {}
export class ExtractionTruncated extends UserFacingError {}

async function extract(content: Anthropic.ContentBlockParam[]): Promise<Recipe> {
  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: EXTRACTION_SYSTEM_PROMPT,
    // Sachet breakdowns and gap-filling are the parts worth thinking about;
    // transcription is not.
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: zodOutputFormat(recipeSchema),
    },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new ExtractionRefused("The model declined to process this source.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new ExtractionTruncated("That recipe was too long to extract in one pass.");
  }
  if (!response.parsed_output) {
    throw new Error("The model returned no structured recipe.");
  }
  return response.parsed_output;
}

/** Read a recipe off one or more photographs of the same card. */
export function extractFromImages(images: ImageInput[]): Promise<Recipe> {
  if (images.length === 0) throw new Error("No images supplied.");

  const content: Anthropic.ContentBlockParam[] = [];
  images.forEach((image, i) => {
    content.push({ type: "text", text: `Photograph ${i + 1} of ${images.length}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.base64 },
    });
  });
  // The instruction goes after the attachments: Claude attends to a trailing
  // question more reliably than to one buried above a stack of images.
  content.push({ type: "text", text: PHOTO_USER_PROMPT });

  return extract(content);
}

/**
 * Read a recipe from whatever a URL turned out to serve.
 *
 * A PDF goes to the model whole, as a document block: meal-kit cards are
 * published as PDFs, and their layout carries meaning that flattening to text
 * would destroy — which column is pantry staples, which small print lists a
 * spice blend's components.
 */
export function extractFromSource(url: string, source: Source): Promise<Recipe> {
  if (source.kind === "pdf") {
    return extract([
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: source.base64 },
      },
      { type: "text", text: PDF_USER_PROMPT(url) },
    ]);
  }
  return extract([{ type: "text", text: URL_USER_PROMPT(url, source.text) }]);
}
