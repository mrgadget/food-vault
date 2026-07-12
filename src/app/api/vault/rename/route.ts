import { NextResponse } from "next/server";

import { renameVault } from "@/lib/db/vaults";
import { createClient } from "@/lib/supabase/server";

/** Rename a vault. Owner only, enforced by RLS. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const vaultId = typeof body?.vaultId === "string" ? body.vaultId : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Give the vault a name." }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: "Keep it under 60 characters." }, { status: 400 });

  try {
    await renameVault(supabase, vaultId, name);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
