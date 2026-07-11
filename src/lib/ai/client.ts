import Anthropic from "@anthropic-ai/sdk";

import { describeEnv, serverEnv } from "@/lib/server-env";

export class MissingApiKey extends Error {}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

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
 * a plausible food — and a wrong quantity is a failure nobody notices until
 * they are cooking.
 *
 * Read lazily: a Worker's bindings do not exist until a request arrives, so a
 * value captured at module scope is whatever the isolate saw at cold start.
 */
export function model(): string {
  return serverEnv("EXTRACTION_MODEL") ?? "claude-opus-4-8";
}

export function effort(): Effort {
  return (serverEnv("EXTRACTION_EFFORT") as Effort | undefined) ?? "high";
}

/**
 * Built per request, not at module scope, for the same reason.
 *
 * Node hands you a populated `process.env` when the module is first imported.
 * Workers does not — bindings and secrets arrive with the request. A client
 * constructed at import time can capture an undefined key and hold it for the
 * life of the isolate, which fails on the edge and never locally. Constructing
 * per request costs nothing; the SDK is a thin wrapper over `fetch`.
 */
export function anthropic(): Anthropic {
  const apiKey = serverEnv("ANTHROPIC_API_KEY");
  if (!apiKey) {
    // Not a UserFacingError: the message is logged server-side and the browser
    // only ever gets the generic scrubbed reply. The key-name dump (no values)
    // says whether the Worker sees any bindings at all, and under what names —
    // the difference between an unbound secret and a mistyped one.
    throw new MissingApiKey(
      `ANTHROPIC_API_KEY is not set. Bind it with \`wrangler secret put\` in production, or add it to .dev.vars locally. Visible — ${describeEnv()}`,
    );
  }
  return new Anthropic({ apiKey });
}
