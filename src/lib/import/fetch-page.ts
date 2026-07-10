import * as cheerio from "cheerio";

import { UserFacingError } from "@/lib/job-stream";

// HTML is reduced to text before it reaches the model, so a small cap is fine.
// A PDF is sent whole; Anthropic's request ceiling is 32MB, and base64 inflates
// by a third, so 20MB of PDF is the practical limit.
const MAX_HTML_BYTES = 3_000_000;
const MAX_PDF_BYTES = 20_000_000;
const MAX_TEXT_CHARS = 60_000;

export class FetchFailed extends UserFacingError {}

/**
 * What a recipe URL turned out to be pointing at.
 *
 * Meal-kit services publish their recipe cards as PDFs — the same artifact a
 * cook would otherwise photograph front and back — so a PDF is a first-class
 * source here, not a failure.
 */
export type Source =
  | { kind: "html"; text: string }
  // Both forms of the same document: base64 for the model, bytes for archiving
  // and for pulling the step photographs out. Encoding once is worth the memory.
  | { kind: "pdf"; base64: string; bytes: Uint8Array };

export async function fetchSource(url: string): Promise<Source> {
  const parsed = assertPublicHttpUrl(url);

  const response = await fetch(parsed, {
    redirect: "follow",
    headers: {
      // Some recipe sites serve a bot wall to unrecognized agents.
      "user-agent": "Mozilla/5.0 (compatible; RecipeVault/0.1; +https://github.com/)",
      accept: "text/html,application/xhtml+xml,application/pdf",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new FetchFailed(`${parsed.hostname} returned ${response.status}.`);
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("application/pdf")) {
    const bytes = await readCapped(response, MAX_PDF_BYTES, "PDF");
    return { kind: "pdf", base64: toBase64(bytes), bytes };
  }

  if (contentType.includes("html")) {
    const bytes = await readCapped(response, MAX_HTML_BYTES, "page");
    return { kind: "html", text: readableText(new TextDecoder().decode(bytes), parsed) };
  }

  throw new FetchFailed(
    `${parsed.hostname} returned ${contentType || "no content type"}; only web pages and PDFs can be imported.`,
  );
}

/**
 * Most recipe sites embed a schema.org/Recipe JSON-LD block. When present we
 * hand that to the model verbatim — it is already structured, so extraction is
 * near-lossless. Otherwise we fall back to the stripped body text.
 */
function readableText(html: string, url: URL): string {
  const $ = cheerio.load(html);

  const jsonLd = findRecipeJsonLd($);
  if (jsonLd) return `schema.org/Recipe JSON-LD:\n${jsonLd}`;

  $("script, style, nav, header, footer, noscript, iframe, svg, form").remove();
  const text = $("body").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

  if (!text) throw new FetchFailed(`No readable text found at ${url.hostname}.`);
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
  const isPrivate =
    host === "localhost" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host);
  if (isPrivate) throw new FetchFailed("That URL points at a private address.");
  return parsed;
}

async function readCapped(response: Response, limit: number, what: string): Promise<Uint8Array> {
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > limit) {
    throw new FetchFailed(
      `That ${what} is ${(buffer.byteLength / 1_000_000).toFixed(1)}MB; the limit is ${limit / 1_000_000}MB.`,
    );
  }
  return new Uint8Array(buffer);
}

/** Workers has no Buffer, and spreading megabytes into fromCharCode blows the argument limit. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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
