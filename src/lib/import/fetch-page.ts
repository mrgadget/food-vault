import * as cheerio from "cheerio";

import { UserFacingError } from "@/lib/job-stream";

// HTML is reduced to text before it reaches the model, so a small cap is fine.
// A PDF is sent whole; Anthropic's request ceiling is 32MB, and base64 inflates
// by a third, so 20MB of PDF is the practical limit.
const MAX_HTML_BYTES = 3_000_000;
const MAX_PDF_BYTES = 20_000_000;
const MAX_IMAGE_BYTES = 15_000_000;
const MAX_TEXT_CHARS = 60_000;

export class FetchFailed extends UserFacingError {}

/**
 * What a food URL turned out to be pointing at.
 *
 * Meal-kit services publish their food cards as PDFs — the same artifact a
 * cook would otherwise photograph front and back — so a PDF is a first-class
 * source here, not a failure.
 */
export type Source =
  // `heroUrl` is the page's own lead photograph (og:image / schema.org image),
  // fetched separately and only if present.
  | { kind: "html"; text: string; heroUrl: string | null }
  // Both forms of the same document: base64 for the model, bytes for archiving
  // and for pulling the step photographs out. Encoding once is worth the memory.
  | { kind: "pdf"; base64: string; bytes: Uint8Array };

export async function fetchSource(url: string): Promise<Source> {
  const parsed = assertPublicHttpUrl(url);

  const response = await fetch(parsed, {
    redirect: "follow",
    headers: {
      // Some food sites serve a bot wall to unrecognized agents.
      "user-agent": "Mozilla/5.0 (compatible; FoodVault/0.1; +https://github.com/)",
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
    const html = new TextDecoder().decode(bytes);
    return { kind: "html", text: readableText(html, parsed), heroUrl: findHeroUrl(html, parsed) };
  }

  throw new FetchFailed(
    `${parsed.hostname} returned ${contentType || "no content type"}; only web pages and PDFs can be imported.`,
  );
}

/**
 * Most food sites embed a schema.org/Food JSON-LD block. When present we
 * hand that to the model verbatim — it is already structured, so extraction is
 * near-lossless. Otherwise we fall back to the stripped body text.
 */
function readableText(html: string, url: URL): string {
  const $ = cheerio.load(html);

  const jsonLd = findFoodJsonLd($);
  if (jsonLd) return `schema.org/Food JSON-LD:\n${jsonLd}`;

  $("script, style, nav, header, footer, noscript, iframe, svg, form").remove();
  const text = $("body").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

  if (!text) throw new FetchFailed(`No readable text found at ${url.hostname}.`);
  return text.slice(0, MAX_TEXT_CHARS);
}

/**
 * The page's own lead photograph: the Food JSON-LD `image`, else `og:image`.
 * Resolved against the page URL so a relative path becomes absolute. Null when
 * the page advertises none.
 */
function findHeroUrl(html: string, pageUrl: URL): string | null {
  const $ = cheerio.load(html);

  const fromFood = imageFromJsonLd(findFoodJsonLdNode($));
  const raw = fromFood ?? $('meta[property="og:image"]').attr("content") ?? null;
  if (!raw) return null;

  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return null;
  }
}

/** schema.org `image` is maddeningly polymorphic: a string, an array, or an ImageObject. */
function imageFromJsonLd(food: unknown): string | null {
  if (!food || typeof food !== "object") return null;
  const image = (food as Record<string, unknown>).image;

  const first = Array.isArray(image) ? image[0] : image;
  if (typeof first === "string") return first;
  if (first && typeof first === "object") {
    const url = (first as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  return null;
}

/**
 * Fetch an image the page pointed at. Best-effort: a hero is a nicety, so any
 * failure returns null rather than derailing the import. Same public-URL guard
 * as the page fetch — this is another server-side fetch of a page-supplied URL.
 */
export async function fetchImage(url: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  let parsed: URL;
  try {
    parsed = assertPublicHttpUrl(url);
  } catch {
    return null;
  }

  try {
    const response = await fetch(parsed, {
      redirect: "follow",
      headers: { accept: "image/*" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;

    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return null;

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
    return { bytes: new Uint8Array(buffer), mimeType };
  } catch {
    return null;
  }
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

/** Walk every JSON-LD block, including @graph arrays, looking for a Food. */
function findFoodJsonLd($: cheerio.CheerioAPI): string | null {
  const food = findFoodJsonLdNode($);
  return food ? JSON.stringify(food, null, 2) : null;
}

/** The Food node itself, for callers that want a field off it (e.g. the image). */
function findFoodJsonLdNode($: cheerio.CheerioAPI): unknown | null {
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(element).text();
    if (!raw.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // A malformed block on the page is not our problem.
    }

    const food = findFoodNode(parsed);
    if (food) return food;
  }
  return null;
}

function findFoodNode(node: unknown): unknown | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFoodNode(child);
      if (found) return found;
    }
    return null;
  }
  if (node === null || typeof node !== "object") return null;

  const record = node as Record<string, unknown>;
  const type = record["@type"];
  const isFood = Array.isArray(type) ? type.includes("Food") : type === "Food";
  if (isFood) return record;

  if (record["@graph"]) return findFoodNode(record["@graph"]);
  return null;
}
