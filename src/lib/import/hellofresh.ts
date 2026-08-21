/**
 * Bulk import of your own HelloFresh past deliveries.
 *
 * HelloFresh needs a logged-in session to know what *you* were sent, but the
 * recipe cards themselves are public PDFs. Rather than hold your credentials,
 * the list is scraped in your own browser by a bookmarklet (see BOOKMARKLET)
 * and pasted in here; from there it is ordinary URL importing.
 */

export type ScrapedFood = { title: string; id: string };

export type PlannedFood = { title: string; url: string };

export type SkippedFood = { title: string; reason: string };

/** Recipe ids are 24 hex characters — the same id the card PDF is keyed by. */
const RECIPE_ID = /^[a-f0-9]{24}$/;

/**
 * The card PDF for a recipe id. The id shown on a past-delivery tile is the one
 * the card is served under, so no page visit is needed to find the link.
 */
export function cardUrl(id: string): string {
  return `https://www.hellofresh.co.nz/recipecards/card/${id}-en-NZ.pdf`;
}

/**
 * Titles are compared loosely: HelloFresh writes curly quotes, and the importer
 * often stores a longer "<name> with <the trimmings>" version of the same dish.
 */
export function normaliseTitle(title: string): string {
  return title.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

function sameDish(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** Whatever the bookmarklet put on the clipboard, as a list we can trust. */
export function parseScraped(text: string): ScrapedFood[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That doesn't look like the copied list. Run the bookmarklet again.");
  }
  if (!Array.isArray(raw)) {
    throw new Error("That doesn't look like the copied list. Run the bookmarklet again.");
  }

  const foods: ScrapedFood[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { title, id } = entry as { title?: unknown; id?: unknown };
    if (typeof title !== "string" || typeof id !== "string" || !RECIPE_ID.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    foods.push({ title: title.trim(), id });
  }

  if (foods.length === 0) throw new Error("No recipes in that list.");
  return foods;
}

/**
 * Split the scraped list into what's new and what you already have.
 *
 * Both keys matter. HelloFresh reissues a dish under a *new* card id every time
 * it comes round again, so the id alone would re-import it — the title catches
 * that. It also relabels tiles ("Louisiana" one week, "Spiced" the next) for the
 * *same* card, which only the id catches.
 */
export function planImport(
  existing: { title: string; sourceUrl: string | null }[],
  scraped: ScrapedFood[],
): { toImport: PlannedFood[]; skipped: SkippedFood[] } {
  const urls = new Set(existing.map((food) => food.sourceUrl).filter(Boolean) as string[]);
  const titles = existing.map((food) => normaliseTitle(food.title));

  const toImport: PlannedFood[] = [];
  const skipped: SkippedFood[] = [];

  for (const food of scraped) {
    const url = cardUrl(food.id);
    const title = normaliseTitle(food.title);

    if (urls.has(url)) {
      skipped.push({ title: food.title, reason: "already imported" });
      continue;
    }
    const match = titles.find((have) => sameDish(have, title));
    if (match) {
      skipped.push({ title: food.title, reason: "already in your vault" });
      continue;
    }
    toImport.push({ title: food.title, url });
  }

  return { toImport, skipped };
}

/**
 * The scraper, as a one-line bookmarklet.
 *
 * Runs on the "My Past Meals" page: expands the full history, then reads each
 * tile's recipe id out of its markup and copies the lot to the clipboard. Kept
 * here rather than in the page so it lives with the parsing it feeds.
 */
export const BOOKMARKLET = `javascript:(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<15;i++){const b=[...document.querySelectorAll('button,a')].find(e=>/show more/i.test(e.textContent||''));if(!b)break;b.click();await s(1200);}const seen=new Set(),out=[];for(const img of document.querySelectorAll('img[src*="recipes/image"]')){let el=img,id=null,tile=null;for(let i=0;i<8&&el.parentElement;i++){el=el.parentElement;const m=el.innerHTML.match(/[a-f0-9]{24}/);if(m){id=m[0];tile=el;break;}}if(!id||seen.has(id))continue;seen.add(id);const h=tile.querySelector('h1,h2,h3,h4,h5');const t=h?h.textContent.trim():'';if(!t)continue;out.push({title:t,id});}if(!out.length){alert('No recipes found. Are you on the Past Meals page?');return;}const j=JSON.stringify(out);try{await navigator.clipboard.writeText(j);alert('Copied '+out.length+' recipes. Paste them into FoodVault.');}catch(e){const t=document.createElement('textarea');t.value=j;t.style.cssText='position:fixed;top:10px;left:10px;width:80vw;height:40vh;z-index:2147483647';document.body.appendChild(t);t.focus();t.select();alert('Press Ctrl+C to copy '+out.length+' recipes, then close the box.');}})()`;
