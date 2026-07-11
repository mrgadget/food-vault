import { NextResponse } from "next/server";

import { deleteFood, setFoodRating } from "@/lib/db/foods";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const rating = body?.rating;
  // null clears the rating; 1-5 sets it. Anything else is a bad request.
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return NextResponse.json({ error: "Rating must be 1 to 5, or null." }, { status: 400 });
  }

  try {
    await setFoodRating(supabase, id, rating);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Rating update failed", error);
    return NextResponse.json({ error: "Could not update the rating." }, { status: 500 });
  }
}

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
    await deleteFood(supabase, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Delete failed", error);
    return NextResponse.json({ error: "Could not delete that food." }, { status: 500 });
  }
}
