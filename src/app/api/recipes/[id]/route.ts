import { NextResponse } from "next/server";

import { deleteRecipe } from "@/lib/db/recipes";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    // No ownership check here on purpose. Row-level security already scopes the
    // delete to this user, and a second check in application code would be a
    // second thing to get wrong.
    await deleteRecipe(supabase, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Delete failed", error);
    return NextResponse.json({ error: "Could not delete that recipe." }, { status: 500 });
  }
}
