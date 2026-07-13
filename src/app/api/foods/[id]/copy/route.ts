import { NextResponse } from "next/server";

import { copyFood } from "@/lib/db/foods";
import { listVaults } from "@/lib/db/vaults";
import { createClient } from "@/lib/supabase/server";

/**
 * Copy this food into the caller's own vault — the "save to my vault" action a
 * reader takes on a food in someone else's shared vault. The target is the
 * vault they own; RLS lets the copy write there and refuses everywhere else.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const vaults = await listVaults(supabase, auth.user.email);
  const target = vaults.find((v) => v.role === "owner");
  if (!target) {
    return NextResponse.json({ error: "You don't have a vault to save into." }, { status: 400 });
  }

  try {
    const newId = await copyFood(supabase, id, target.id, auth.user.id);
    return NextResponse.json({ id: newId });
  } catch (error) {
    console.error("Copy to vault failed", error);
    return NextResponse.json({ error: "Could not save that food to your vault." }, { status: 500 });
  }
}
