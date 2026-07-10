import { NextResponse } from "next/server";

import { extractFromPage } from "@/lib/ai/extract";
import { saveRecipe } from "@/lib/db/recipes";
import { fetchPageText } from "@/lib/import/fetch-page";
import { streamJob } from "@/lib/job-stream";
import { createClient } from "@/lib/supabase/server";

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

  // Everything above fails fast with a real status code. Everything below is
  // slow, so it streams — see lib/job-stream.
  return streamJob(async (progress) => {
    progress("Fetching the page…");
    const pageText = await fetchPageText(url);

    progress("Reading the recipe…");
    const recipe = await extractFromPage(url, pageText);

    progress("Saving…");
    return saveRecipe(supabase, auth.user.id, recipe, { source: "url", sourceUrl: url });
  });
}
