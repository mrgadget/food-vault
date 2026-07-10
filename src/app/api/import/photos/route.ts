import { NextResponse } from "next/server";

import { extractFromImages, ExtractionRefused, type ImageInput } from "@/lib/ai/extract";
import { saveRecipe, type SavedImage } from "@/lib/db/recipes";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_IMAGES = 8;
const MAX_BYTES_EACH = 10_000_000;

type Accepted = (typeof ACCEPTED)[number];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const files = form?.getAll("images").filter((value): value is File => value instanceof File) ?? [];
  // Positional: kinds[i] labels files[i] as the front or back of the card.
  const kinds = form?.getAll("kinds").map(String) ?? [];

  if (files.length === 0) {
    return NextResponse.json({ error: "Attach at least one photo." }, { status: 400 });
  }
  if (files.length > MAX_IMAGES) {
    return NextResponse.json({ error: `At most ${MAX_IMAGES} photos per recipe.` }, { status: 400 });
  }
  for (const file of files) {
    if (!ACCEPTED.includes(file.type as Accepted)) {
      return NextResponse.json({ error: `${file.type || "That file"} is not a supported image.` }, { status: 400 });
    }
    if (file.size > MAX_BYTES_EACH) {
      return NextResponse.json({ error: `${file.name} is larger than 10MB.` }, { status: 400 });
    }
  }

  const buffers = await Promise.all(files.map(async (file) => Buffer.from(await file.arrayBuffer())));
  const images: ImageInput[] = buffers.map((buffer, i) => ({
    base64: buffer.toString("base64"),
    mediaType: files[i].type as Accepted,
  }));

  try {
    // Extract before uploading. A refusal or a photo of something that is not a
    // recipe then costs no storage and leaves nothing to clean up.
    const recipe = await extractFromImages(images);

    const batchId = crypto.randomUUID();
    const uploaded: SavedImage[] = [];
    try {
      for (const [i, buffer] of buffers.entries()) {
        const extension = files[i].type.split("/")[1];
        const storagePath = `${auth.user.id}/${batchId}/${i}.${extension}`;
        const { error } = await supabase.storage
          .from("recipe-images")
          .upload(storagePath, buffer, { contentType: files[i].type, upsert: false });
        if (error) throw new Error(error.message);
        uploaded.push({ storagePath, kind: normalizeKind(kinds[i]) });
      }
    } catch (error) {
      await supabase.storage.from("recipe-images").remove(uploaded.map((image) => image.storagePath));
      throw error;
    }

    const id = await saveRecipe(supabase, auth.user.id, recipe, { source: "photo" }, uploaded);
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof ExtractionRefused) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("Photo import failed", error);
    return NextResponse.json({ error: "Could not read a recipe from those photos." }, { status: 500 });
  }
}

function normalizeKind(value: string | undefined): SavedImage["kind"] {
  return value === "front" || value === "back" ? value : "other";
}
