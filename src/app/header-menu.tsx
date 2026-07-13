"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * The right-hand header actions. On a phone the secondary links (Sharing,
 * Settings, Sign out) collapse behind a single menu button so the bar can't
 * overflow; from sm up they sit inline as before. "Add food" stays a first-class
 * button throughout — icon-only on mobile, labelled on desktop.
 */
export function HeaderMenu({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  async function signOut() {
    await createClient().auth.signOut();
    // Full load, not a client nav: the server-rendered header only clears on a
    // fresh render.
    window.location.assign("/login");
  }

  return (
    <div className="flex items-center gap-2 sm:gap-5">
      <Link href="/vault" className="hidden text-sm text-muted transition-colors hover:text-ink sm:inline">
        Sharing
      </Link>
      <Link href="/settings" className="hidden text-sm text-muted transition-colors hover:text-ink sm:inline">
        Settings
      </Link>
      <button
        type="button"
        onClick={signOut}
        className="hidden text-sm text-muted transition-colors hover:text-ink sm:inline"
      >
        Sign out
      </button>

      {canEdit && (
        <Link
          href="/import"
          aria-label="Add food"
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-2 text-sm font-medium text-paper shadow-sm transition-transform hover:-translate-y-px active:translate-y-0 sm:px-4"
        >
          <span className="text-base leading-none">+</span>
          <span className="hidden sm:inline">Add food</span>
        </Link>
      )}

      <div ref={ref} className="relative sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu"
          aria-expanded={open}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 z-30 mt-1.5 w-44 rounded-xl border border-line bg-paper p-1.5 shadow-lg">
            <Link
              href="/vault"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface"
            >
              Sharing
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface"
            >
              Settings
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-surface"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
