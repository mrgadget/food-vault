"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";

type FilterNav = { isPending: boolean; run: (navigate: () => void) => void };

// Outside a provider (shouldn't happen) the navigation just runs untracked.
const FilterNavContext = createContext<FilterNav>({ isPending: false, run: (navigate) => navigate() });

export const useFilterNav = () => useContext(FilterNavContext);

/**
 * Wraps the search box and filter combos (and the results) so every filter
 * change shares one pending state. Each control routes its URL update through
 * `run`; the overlay that reflects it lives in {@link FilterResults}.
 */
export function FilterBar({ children }: { children: ReactNode }) {
  const [isPending, startTransition] = useTransition();

  return (
    <FilterNavContext.Provider value={{ isPending, run: (navigate) => startTransition(navigate) }}>
      {children}
    </FilterNavContext.Provider>
  );
}

/**
 * The results region. While a filter navigation is in flight a single loading
 * overlay covers just this — the list — leaving the page heading and the filter
 * controls untouched.
 */
export function FilterResults({ children }: { children: ReactNode }) {
  const { isPending } = useFilterNav();

  return (
    <div className="relative">
      {children}
      {isPending && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-paper/40 backdrop-blur-[1px]">
          <div className="mt-10 flex items-center gap-2 rounded-full bg-ink/90 px-4 py-2 text-sm font-medium text-paper shadow-lg">
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Updating…
          </div>
        </div>
      )}
    </div>
  );
}
