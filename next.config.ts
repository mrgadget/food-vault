import { readFileSync } from "node:fs";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;

// Makes Cloudflare bindings available to `next dev`. No-op in production,
// where the Worker supplies them directly.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();

loadDevVars();

/**
 * Put `.dev.vars` into `process.env` for `next dev`.
 *
 * Secrets cannot live in a `.env` file: OpenNext compiles every mode's `.env`
 * files into `next-env.mjs` and ships it inside the Worker script, so anything
 * there is uploaded to Cloudflare in plaintext. `.dev.vars` is Wrangler's own
 * secrets file and is never compiled in — but plain `next dev` does not read
 * it, and `getCloudflareContext()` does not expose it there either. Hence this.
 *
 * Production never runs this: the file does not exist, and the Worker's real
 * secrets arrive as bindings.
 */
function loadDevVars() {
  if (process.env.NODE_ENV === "production") return;

  let contents: string;
  try {
    contents = readFileSync(".dev.vars", "utf8");
  } catch {
    return; // Nothing to load; the app will say so when it needs a key.
  }

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const name = trimmed.slice(0, separator).trim();
    // Real env vars win, so `ANTHROPIC_API_KEY=… npm run dev` still overrides.
    if (process.env[name]) continue;
    process.env[name] = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  }
}
