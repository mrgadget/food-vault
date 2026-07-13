"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Free-text filter for the food list. Like the chips, the URL is the state — the
 * typed query lives in `?q=`, debounced so it doesn't push a history entry per
 * keystroke, and the other filters are preserved untouched.
 */
export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params);
      const trimmed = value.trim();
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      if (next.toString() === params.toString()) return;
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 200);
    return () => clearTimeout(handle);
    // Only re-run as the user types; a chip toggle updates `params` on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative flex-1 sm:min-w-[15rem]">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search title, ingredient, cuisine…"
        aria-label="Search foods"
        className="w-full rounded-full border border-line bg-surface py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
    </div>
  );
}
