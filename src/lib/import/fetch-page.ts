import * as cheerio from "cheerio";

import { UserFacingError } from "@/lib/job-stream";

const MAX_BYTES = 3_000_000;
const MAX_TEXT_CHARS = 60_000;

export class FetchFailed extends UserFacingError {}

/**
 * Fetch a page and reduce it to the text a recipe extractor cares about.
 *
 * Most recipe sites embed a schema.org/Recipe JSON-LD block. When present we
 * hand that to the model verbatim — it is already structured, so extraction is
 * near-lossless. Otherwise we fall back to the stripped body text, which is
 * noisier but still works.
 */
export async function fetchPageText(url: string): Promise<string> {
  const parsed = assertPublicHttpUrl(url);

  const response = await fetch(parsed, {
    redirect: "follow",
    headers: {
      // Some recipe sites serve a bot wall to unrecognized agents.
      "user-agent": "Mozilla/5.0 (compatible; RecipeVault/0.1; +https://github.com/)",
      accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new FetchFailed(`${parsed.hostname} returned ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("html")) {
    throw new FetchFailed(`${parsed.hostname} returned ${contentType || "no content type"}, not HTML.`);
  }

  const html = await readCapped(response);
  const $ = cheerio.load(html);

  const jsonLd = findRecipeJsonLd($);
  if (jsonLd) return `schema.org/Recipe JSON-LD:\n${jsonLd}`;

  $("script, style, nav, header, footer, noscript, iframe, svg, form").remove();
  const text = $("body").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

  if (!text) throw new FetchFailed(`No readable text found at ${parsed.hostname}.`);
  return text.slice(0, MAX_TEXT_CHARS);
}

/**
 * The URL is user-supplied and fetched by the server, so it is an SSRF vector.
 * Restrict to public http(s) and let the platform's egress rules handle the
 * rest — resolving hostnames here would still race DNS rebinding.
 */
function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new FetchFailed("That is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FetchFailed("Only http and https URLs can be imported.");
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host);
  if (isLoopback) throw new FetchFailed("That URL points at a private address.");
  return parsed;
}

async function readCapped(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    throw new FetchFailed("That page is too large to import.");
  }
  return new TextDecoder().decode(buffer);
}

/** Walk every JSON-LD block, including @graph arrays, looking for a Recipe. */
function findRecipeJsonLd($: cheerio.CheerioAPI): string | null {
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(element).text();
    if (!raw.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // A malformed block on the page is not our problem.
    }

    const recipe = findRecipeNode(parsed);
    if (recipe) return JSON.stringify(recipe, null, 2);
  }
  return null;
}

function findRecipeNode(node: unknown): unknown | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRecipeNode(child);
      if (found) return found;
    }
    return null;
  }
  if (node === null || typeof node !== "object") return null;

  const record = node as Record<string, unknown>;
  const type = record["@type"];
  const isRecipe = Array.isArray(type) ? type.includes("Recipe") : type === "Recipe";
  if (isRecipe) return record;

  if (record["@graph"]) return findRecipeNode(record["@graph"]);
  return null;
}
