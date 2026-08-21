"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { BOOKMARKLET, type PlannedFood, type SkippedFood } from "@/lib/import/hellofresh";
import { readJobStream } from "@/lib/job-stream";

type Plan = { vault: string; found: number; toImport: PlannedFood[]; skipped: SkippedFood[] };

type Outcome = { url: string; title: string; ok: boolean; note?: string };

/**
 * Import a whole HelloFresh history at once.
 *
 * The list of what you were sent needs your HelloFresh login, so it is scraped
 * where you are already signed in — a bookmarklet on their site — and pasted
 * here. FoodVault never sees your credentials, and the cards themselves are
 * public URLs it can fetch on its own.
 */
export function HelloFreshImport() {
  const router = useRouter();
  const [pasted, setPasted] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Import progress. `running` doubles as the busy flag.
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<{ title: string; status: string } | null>(null);
  const [done, setDone] = useState<Outcome[]>([]);

  async function check() {
    setChecking(true);
    setError(null);
    setPlan(null);
    setDone([]);
    try {
      const response = await fetch("/api/import/hellofresh/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pasted }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Could not read that list.");
      setPlan(result as Plan);
      setChosen(new Set((result as Plan).toImport.map((food) => food.url)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
    } finally {
      setChecking(false);
    }
  }

  function toggle(url: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  /**
   * One request per food rather than one long batch: each card takes the better
   * part of a minute, and a failure part-way should cost that food only.
   */
  async function importChosen() {
    if (!plan) return;
    const queue = plan.toImport.filter((food) => chosen.has(food.url));

    setRunning(true);
    setError(null);
    setDone([]);

    for (const food of queue) {
      setCurrent({ title: food.title, status: "Starting…" });
      try {
        const response = await fetch("/api/import/url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The plan already ruled out duplicates; if the card turns out to be
          // one anyway, keep what's there rather than stopping to ask.
          body: JSON.stringify({ url: food.url, onExisting: "skip" }),
        });

        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(result?.error ?? "Import failed.");
        }
        if ((response.headers.get("content-type") ?? "").includes("application/json")) {
          await response.json(); // a skipped duplicate — nothing to read
          setDone((d) => [...d, { url: food.url, title: food.title, ok: true, note: "already had it" }]);
          continue;
        }

        await readJobStream(response, (message) => setCurrent({ title: food.title, status: message }));
        setDone((d) => [...d, { url: food.url, title: food.title, ok: true }]);
      } catch (failure) {
        setDone((d) => [
          ...d,
          {
            url: food.url,
            title: food.title,
            ok: false,
            note: failure instanceof Error ? failure.message : "Import failed.",
          },
        ]);
      }
    }

    setCurrent(null);
    setRunning(false);
    router.refresh(); // the list behind this page is now stale
  }

  const queued = plan?.toImport.filter((food) => chosen.has(food.url)).length ?? 0;
  const failed = done.filter((outcome) => !outcome.ok).length;

  return (
    <div>
      <ol className="space-y-4 text-sm">
        <li>
          <p className="font-medium">1. Save the bookmarklet, once</p>
          <p className="mt-1 text-muted">
            Copy it, then make a new bookmark in your browser and paste this as its address.
          </p>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(BOOKMARKLET)}
            className="mt-2 rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent/50"
          >
            Copy bookmarklet
          </button>
        </li>
        <li>
          <p className="font-medium">2. Run it on HelloFresh</p>
          <p className="mt-1 text-muted">
            Sign in, open{" "}
            <span className="font-medium text-ink">My Account → Past Deliveries</span>, then click
            the bookmark. It loads your full history and copies it.
          </p>
        </li>
        <li>
          <p className="font-medium">3. Paste it here</p>
        </li>
      </ol>

      <textarea
        value={pasted}
        onChange={(event) => setPasted(event.target.value)}
        rows={3}
        placeholder='[{"title":"…","id":"…"}]'
        className="mt-3 w-full rounded-lg border border-line bg-paper px-4 py-3 font-mono text-xs outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
      />

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {!plan && (
        <button
          type="button"
          onClick={check}
          disabled={checking || !pasted.trim()}
          className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0"
        >
          {checking ? "Checking…" : "Check what's new"}
        </button>
      )}

      {plan && (
        <div className="mt-6 border-t border-line pt-6">
          <p className="text-sm text-muted">
            Found {plan.found} in your history. {plan.skipped.length} already in{" "}
            <span className="font-medium text-ink">{plan.vault}</span>.
          </p>

          {plan.toImport.length === 0 ? (
            <p className="mt-4 text-sm font-medium">Nothing new — you're up to date.</p>
          ) : (
            <>
              <p className="mt-4 text-sm font-medium">{plan.toImport.length} new:</p>
              <ul className="mt-2 space-y-1">
                {plan.toImport.map((food) => {
                  const outcome = done.find((d) => d.url === food.url);
                  return (
                    <li key={food.url} className="flex items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={chosen.has(food.url)}
                        disabled={running || done.length > 0}
                        onChange={() => toggle(food.url)}
                        className="h-4 w-4 shrink-0 accent-accent"
                      />
                      <span className={outcome && !outcome.ok ? "text-red-700" : undefined}>
                        {food.title}
                      </span>
                      {outcome?.ok && <span className="text-xs text-emerald-700">✓ {outcome.note ?? "added"}</span>}
                      {outcome && !outcome.ok && <span className="text-xs text-red-700">{outcome.note}</span>}
                      {current?.title === food.title && (
                        <span className="text-xs text-muted">{current.status}</span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {!running && done.length === 0 && (
                <button
                  type="button"
                  onClick={importChosen}
                  disabled={queued === 0}
                  className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0"
                >
                  Import {queued} recipe{queued === 1 ? "" : "s"}
                </button>
              )}

              {running && (
                <p className="mt-5 text-sm text-muted">
                  Importing {done.length + 1} of {queued} — around a minute each, so leave this
                  tab open.
                </p>
              )}

              {!running && done.length > 0 && (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <p className="text-sm font-medium">
                    Added {done.length - failed} of {done.length}.
                    {failed > 0 && " The rest are marked above."}
                  </p>
                  {/* Re-planning drops whatever just landed, so this comes back
                      with only the ones still missing — the retry path. */}
                  <button
                    type="button"
                    onClick={check}
                    disabled={checking}
                    className="rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent/50 disabled:opacity-40"
                  >
                    {checking ? "Checking…" : failed > 0 ? "Retry the rest" : "Check again"}
                  </button>
                </div>
              )}
            </>
          )}

          {plan.skipped.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-sm text-muted">
                Skipped {plan.skipped.length} you already have
              </summary>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {plan.skipped.map((food) => (
                  <li key={`${food.title}-${food.reason}`}>
                    {food.title} — {food.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
