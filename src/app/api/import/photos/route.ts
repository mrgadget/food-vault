import { NextResponse } from "next/server";

import { extractFromImages, type ImageInput } from "@/lib/ai/extract";
import { saveRecipe, type SavedImage } from "@/lib/db/recipes";
import { streamJob } from "@/lib/job-stream";
import { deleteImages, objectKey, putImage } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

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

  const buffers = await Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer())));

  return streamJob(async (progress) => {
    const images: ImageInput[] = buffers.map((bytes, i) => ({
      base64: toBase64(bytes),
      mediaType: files[i].type as Accepted,
    }));

    // Extract before uploading. A refusal, or a photo of something that is not
    // a recipe, then costs no storage and leaves nothing to clean up.
    progress(files.length > 1 ? `Reading ${files.length} photos…` : "Reading the photo…");
    const recipe = await extractFromImages(images);

    progress("Saving the photos…");
    // Minted here so the photos are stored under `{recipeId}/…` before the row.
    const recipeId = crypto.randomUUID();
    const uploaded: SavedImage[] = [];
    try {
      for (const [i, bytes] of buffers.entries()) {
        const extension = files[i].type.split("/")[1];
        const storagePath = objectKey(recipeId, `photo-${i + 1}.${extension}`);
        await putImage(storagePath, bytes, files[i].type);
        uploaded.push({ storagePath, kind: normalizeKind(kinds[i]), mimeType: files[i].type });
      }
    } catch (error) {
      await deleteImages(uploaded.map((image) => image.storagePath));
      throw error;
    }

    progress("Saving the recipe…");
    return saveRecipe(supabase, auth.user.id, recipe, { source: "photo" }, uploaded, recipeId);
  });
}

function normalizeKind(value: string | undefined): SavedImage["kind"] {
  return value === "front" || value === "back" ? value : "other";
}

/**
 * Workers has no Buffer, and spreading a 10MB array into String.fromCharCode
 * blows the argument limit. Chunk it.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
