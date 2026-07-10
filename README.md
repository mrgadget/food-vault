# RecipeVault

Collect recipes from anywhere and read them back in a form you can actually cook from.

- **Import from a URL.** Reads the page, prefers its `schema.org/Recipe` JSON-LD when present, falls back to the page text otherwise.
- **Import from photos.** Photograph the front and back of a recipe card — as many shots per recipe as you need. Claude reads them together, so an ingredient list on one side and instructions on the other come out as one recipe.
- **Fills the gaps.** Recipe cards omit oven temperatures, pantry staples, and resting times. Anything the model adds is stored with `inferred: true` and rendered with an "added" badge, so you always know what the source actually said.
- **Breaks down meal-kit sachets.** HelloFresh and friends ship pre-mixed blends like "Fajita Spice Blend". Each one gets reconstructed into its component spices, scaled to the recipe, and tagged with a confidence level.
- **Installs to your phone.** One Next.js app; add it to your home screen and the camera import works from the standard file input.

## Stack

Next.js 15 (App Router) · Supabase (Postgres, Storage, Auth) · Claude Opus 4.8 · Tailwind 4 · Cloudflare Workers via OpenNext

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

## Deploying to Cloudflare

The app runs as a Worker via [OpenNext](https://opennext.js.org/cloudflare).

```bash
npm run preview   # build the Worker and run it locally on workerd
npm run deploy    # build and ship it
```

Set the runtime secret once per environment:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are inlined into the client bundle at build time, so they belong in the **build** environment (`.env.local`, or build variables in CI) rather than in `wrangler.jsonc`.

Two Cloudflare-specific constraints shape the code:

- **Requests must produce bytes early.** A high-effort vision extraction can run for minutes, and Cloudflare closes a proxied request that has sent nothing. Both import endpoints therefore stream newline-delimited JSON (`src/lib/job-stream.ts`): authentication and validation fail fast with real status codes, then progress lines flush immediately and the outcome arrives on the last line. A failed import can return HTTP 200 — clients must read the final event, not `response.ok`.
- **`limits.cpu_ms` is raised to 300s**, which requires a paid Workers plan. Almost none of that is real CPU; the extraction is spent waiting on the Anthropic API. The default 30s ceiling is about base64 and JSON work.

If imports ever outgrow a single request, the next step is Cloudflare Queues: enqueue the job, return immediately, and let the recipe appear in the list when it lands.

## How extraction works

Both import paths converge on one Claude call (`src/lib/ai/extract.ts`) that returns a structured recipe validated against a Zod schema (`src/lib/schema.ts`). The URL path feeds it page text; the photo path feeds it images. The system prompt (`src/lib/ai/prompt.ts`) is the whole product — transcription rules, the sachet-expansion rule, and the requirement to mark every inference.

Adaptive thinking is on at high effort. Transcription doesn't need it; deciding what a "Southwest Seasoning" sachet contains does.

## Security notes

- Row-level security scopes every table to `auth.uid()`. Child tables authorize by joining back to `recipes`.
- Recipe images live in a private bucket, keyed under `<user_id>/<batch>/`, and are served through signed URLs.
- The URL importer is a server-side fetch of a user-supplied address. `src/lib/import/fetch-page.ts` rejects non-HTTP schemes and private address ranges, but DNS rebinding is not fully addressed there — put the importer behind an egress proxy or allowlist if you deploy this somewhere with a sensitive internal network.
