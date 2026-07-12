import { NextResponse } from "next/server";

import { removeMember, upsertMember } from "@/lib/db/vaults";
import { createClient } from "@/lib/supabase/server";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Invite a member or change their role. RLS lets only the vault's owner through. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const vaultId = typeof body?.vaultId === "string" ? body.vaultId : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = body?.role;

  if (!EMAIL.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  if (role !== "viewer" && role !== "editor") {
    return NextResponse.json({ error: "Role must be viewer or editor." }, { status: 400 });
  }
  if (email.toLowerCase() === auth.user.email?.toLowerCase()) {
    return NextResponse.json({ error: "That's you — you already own this vault." }, { status: 400 });
  }

  try {
    await upsertMember(supabase, vaultId, email, role);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}

/** Remove a member. Owner only (RLS). */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const vaultId = typeof body?.vaultId === "string" ? body.vaultId : "";
  const email = typeof body?.email === "string" ? body.email : "";

  try {
    await removeMember(supabase, vaultId, email);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
