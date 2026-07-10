# RecipeVault

Collect recipes from anywhere and read them back in a form you can actually cook from.

- **Import from a URL.** Reads the page, prefers its `schema.org/Recipe` JSON-LD when present, falls back to the page text otherwise.
- **Import from photos.** Photograph the front and back of a recipe card — as many shots per recipe as you need. Claude reads them together, so an ingredient list on one side and instructions on the other come out as one recipe.
- **Fills the gaps.** Recipe cards omit oven temperatures, pantry staples, and resting times. Anything the model adds is stored with `inferred: true` and rendered with an "added" badge, so you always know what the source actually said.
- **Breaks down meal-kit sachets.** HelloFresh and friends ship pre-mixed blends like "Fajita Spice Blend". Each one gets reconstructed into its component spices, scaled to the recipe, and tagged with a confidence level.
- **Installs to your phone.** One Next.js app; add it to your home screen and the camera import works from the standard file input.

## Stack

Next.js 15 (App Router) · Supabase (Postgres, Storage, Auth) · Claude Opus 4.8 · Tailwind 4

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase and Anthropic keys
```

Apply the database schema — paste `supabase/schema.sql` into the Supabase SQL editor, or:

```bash
supabase db push
```

That script creates the tables, the row-level security policies, and the private `recipe-images` storage bucket.

```bash
npm run dev
```

## How extraction works

Both import paths converge on one Claude call (`src/lib/ai/extract.ts`) that returns a structured recipe validated against a Zod schema (`src/lib/schema.ts`). The URL path feeds it page text; the photo path feeds it images. The system prompt (`src/lib/ai/prompt.ts`) is the whole product — transcription rules, the sachet-expansion rule, and the requirement to mark every inference.

Adaptive thinking is on at high effort. Transcription doesn't need it; deciding what a "Southwest Seasoning" sachet contains does.

## Security notes

- Row-level security scopes every table to `auth.uid()`. Child tables authorize by joining back to `recipes`.
- Recipe images live in a private bucket, keyed under `<user_id>/<batch>/`, and are served through signed URLs.
- The URL importer is a server-side fetch of a user-supplied address. `src/lib/import/fetch-page.ts` rejects non-HTTP schemes and private address ranges, but DNS rebinding is not fully addressed there — put the importer behind an egress proxy or allowlist if you deploy this somewhere with a sensitive internal network.
