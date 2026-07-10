import Anthropic from "@anthropic-ai/sdk";

/**
 * Overridable so a bulk import can trade accuracy for cost without a deploy.
 *
 * Measured on one HelloFresh card, every model from Haiku 4.5 up produced the
 * same ingredients, the same steps, and a correct sachet breakdown — the prompt
 * carries the work. Latency is ~20s on all of them, because it is dominated by
 * ingesting a 6.6MB PDF rather than by thinking. The whole spread is 8 cents to
 * 1 cent per import.
 *
 * Opus stays the default anyway. The cards that separate these models are the
 * awkward ones — a two-and-four-serving layout where the wrong column is still
 * a plausible recipe — and a wrong quantity is a failure nobody notices until
 * they are cooking.
 */
export const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-4-8";
export const EFFORT = (process.env.EXTRACTION_EFFORT ?? "high") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export class MissingApiKey extends Error {}

/**
 * Built per request, not at module scope.
 *
 * Node hands you a populated `process.env` when the module is first imported.
 * Workers does not — bindings and secrets arrive with the request, and the
 * adapter only populates `process.env` once it is inside a request context. A
 * client constructed at import time can therefore capture an undefined key and
 * hold it for the life of the isolate, which fails on the edge and never
 * locally. Constructing per request costs nothing; the SDK is a thin wrapper
 * over `fetch`.
 */
export function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Deliberately not a UserFacingError subclass carrying config detail to the
    // browser — but distinct enough in the log to end an afternoon.
    throw new MissingApiKey("ANTHROPIC_API_KEY is not set in this environment.");
  }
  return new Anthropic({ apiKey });
}
