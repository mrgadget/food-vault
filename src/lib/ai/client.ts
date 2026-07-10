import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-4-8";

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
