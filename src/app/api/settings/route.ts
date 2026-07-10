import { NextResponse } from "next/server";

import { setUnitSystem } from "@/lib/db/settings";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const system = body?.unitSystem;
  if (system !== "metric" && system !== "imperial") {
    return NextResponse.json({ error: "unitSystem must be metric or imperial." }, { status: 400 });
  }

  try {
    await setUnitSystem(supabase, auth.user.id, system);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Settings update failed", error);
    return NextResponse.json({ error: "Could not save that setting." }, { status: 500 });
  }
}
