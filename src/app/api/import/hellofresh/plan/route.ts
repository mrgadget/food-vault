import { NextResponse } from "next/server";

import { listImportKeys } from "@/lib/db/foods";
import { canEdit, getActiveVault } from "@/lib/db/vaults";
import { parseScraped, planImport } from "@/lib/import/hellofresh";
import { createClient } from "@/lib/supabase/server";

/**
 * Work out which of a pasted HelloFresh history is actually new.
 *
 * Only the planning happens here — the importing is the existing
 * /api/import/url, run once per food by the client, so a long history is a
 * sequence of short requests rather than one that outlives the connection.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const pasted = typeof body?.pasted === "string" ? body.pasted : "";
  if (!pasted.trim()) {
    return NextResponse.json({ error: "Paste the copied list first." }, { status: 400 });
  }

  const { active } = await getActiveVault(supabase, auth.user.email);
  if (!canEdit(active.role)) {
    return NextResponse.json({ error: "You have read-only access to this vault." }, { status: 403 });
  }

  try {
    const scraped = parseScraped(pasted);
    const existing = await listImportKeys(supabase, active.id);
    const { toImport, skipped } = planImport(existing, scraped);
    return NextResponse.json({ vault: active.name, found: scraped.length, toImport, skipped });
  } catch (error) {
    // parseScraped throws messages meant for the person who pasted.
    const message = error instanceof Error ? error.message : "Could not read that list.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
