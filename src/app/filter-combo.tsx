"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function parseList(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

/**
 * A compact multi-select for one facet: a single pill that opens a checklist,
 * instead of a wrapping row of chips that swallows the screen on a phone. The
 * URL stays the state — each toggle rewrites this facet's comma list in `?param=`
 * and leaves the others (and the search box) untouched.
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = parseList(params.get(param));
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

  if (choices.length === 0) return null;

  function apply(next: string[]) {
    const query = new URLSearchParams(params);
    if (next.length > 0) query.set(param, next.join(","));
    else query.delete(param);
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  function toggle(choice: string) {
    apply(selected.includes(choice) ? selected.filter((c) => c !== choice) : [...selected, choice]);
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
              onClick={() => apply([])}
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
