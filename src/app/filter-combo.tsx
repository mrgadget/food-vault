"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useFilterNav } from "./filter-bar";

function parseList(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

/**
 * A compact multi-select for one facet: a single pill that opens a checklist,
 * instead of a wrapping row of chips that swallows the screen on a phone.
 *
 * The URL is still the state, but the checkboxes are backed by local state so a
 * tick flips instantly instead of waiting on the server round-trip that
 * re-filters the list. That navigation is debounced — a burst of ticks becomes
 * one server render — and runs in a transition so it never blocks the UI.
 */
export function FilterCombo({
  label,
  param,
  options,
  extra = [],
}: {
  label: string;
  param: string;
  options: string[];
  extra?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Freshest search params for the debounced push, so a sibling combo's change
  // isn't clobbered by a stale snapshot.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => parseList(params.get(param)));
  // Shared with the other filters so one overlay covers any in-flight change.
  const { run } = useFilterNav();
  const runRef = useRef(run);
  runRef.current = run;
  const touched = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  const choices = [...extra, ...options];

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Push the local selection into the URL once the ticks settle.
  useEffect(() => {
    if (!touched.current) return;
    const handle = setTimeout(() => {
      const query = new URLSearchParams(paramsRef.current);
      if (selected.length > 0) query.set(param, selected.join(","));
      else query.delete(param);
      const search = query.toString();
      runRef.current(() => {
        router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [selected, param, pathname, router]);

  if (choices.length === 0) return null;

  function toggle(choice: string) {
    touched.current = true;
    setSelected((cur) => (cur.includes(choice) ? cur.filter((c) => c !== choice) : [...cur, choice]));
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm capitalize transition-colors ${
          selected.length > 0
            ? "border-accent bg-accent text-accent-fg"
            : "border-line bg-surface text-ink hover:border-accent/50"
        }`}
      >
        {label}
        {selected.length > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-fg/20 px-1 text-xs font-semibold tabular-nums">
            {selected.length}
          </span>
        )}
        <svg
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1.5 max-h-72 w-52 max-w-[calc(100vw-2rem)] overflow-auto rounded-xl border border-line bg-paper p-1.5 shadow-lg">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => {
                touched.current = true;
                setSelected([]);
              }}
              className="mb-1 flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted hover:bg-surface"
            >
              Clear {label.toLowerCase()}
            </button>
          )}
          {choices.map((choice) => {
            const active = selected.includes(choice);
            return (
              <button
                key={choice}
                type="button"
                onClick={() => toggle(choice)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm capitalize hover:bg-surface"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    active ? "border-accent bg-accent text-accent-fg" : "border-line"
                  }`}
                >
                  {active && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </span>
                {choice}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
