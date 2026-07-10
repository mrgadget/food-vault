import { NextResponse } from "next/server";

import { extractFromPage, ExtractionRefused } from "@/lib/ai/extract";
import { saveRecipe } from "@/lib/db/recipes";
import { fetchPageText, FetchFailed } from "@/lib/import/fetch-page";
import { createClient } from "@/lib/supabase/server";

// Fetch + a high-effort extraction runs well past the default serverless limit.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "A url is required." }, { status: 400 });
  }

  try {
    const pageText = await fetchPageText(url);
    const recipe = await extractFromPage(url, pageText);
    const id = await saveRecipe(supabase, auth.user.id, recipe, { source: "url", sourceUrl: url });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof FetchFailed) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof ExtractionRefused) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("URL import failed", error);
    return NextResponse.json({ error: "Could not import that recipe." }, { status: 500 });
  }
}
