import { NextResponse } from "next/server";

import { ACTIVE_COOKIE, listVaults } from "@/lib/db/vaults";
import { createClient } from "@/lib/supabase/server";

/** Remember which vault the user is working in. Stored as a cookie the pages read. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const vaultId = typeof body?.vaultId === "string" ? body.vaultId : "";

  // Only a vault the user actually belongs to may become active.
  const vaults = await listVaults(supabase, auth.user.email);
  if (!vaults.some((v) => v.id === vaultId)) {
    return NextResponse.json({ error: "Not a member of that vault." }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACTIVE_COOKIE, vaultId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
