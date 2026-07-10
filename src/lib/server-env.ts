import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Read a server-side secret or variable.
 *
 * Secrets must never appear in a `.env` file. OpenNext compiles every mode's
 * `.env` files into `next-env.mjs` and ships it inside the Worker script, so a
 * key placed in `.env.local` — or `.env.development.local` — is uploaded to
 * Cloudflare in plaintext, whether or not the running mode ever reads it.
 *
 * The Worker's own bindings are the safe home: `wrangler secret put` in
 * production, `.dev.vars` locally. Both surface on the Cloudflare context.
 *
 * `process.env` is checked first because the adapter copies the bindings into
 * it at the start of each request, and because plain `next dev` and one-off
 * scripts have nothing else. The context is the fallback that makes the Worker
 * work when they don't.
 */
export function serverEnv(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;

  try {
    const value = (getCloudflareContext().env as Record<string, unknown>)[name];
    return typeof value === "string" && value ? value : undefined;
  } catch {
    // Not running under the Cloudflare adapter — a bare `next build`, a test,
    // or a script. There is nowhere else to look.
    return undefined;
  }
}
