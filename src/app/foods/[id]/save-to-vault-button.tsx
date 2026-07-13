"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Copy a food out of someone else's vault into your own. Shown only when the
 * food lives in a vault you don't own (see the food page); on success it lands
 * you on your new copy.
 */
export function SaveToVaultButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/foods/${id}/copy`, { method: "POST" });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.id) {
      setError(result?.error ?? "Could not save that food to your vault.");
      setBusy(false);
      return;
    }

    router.refresh();
    router.push(`/foods/${result.id}`);
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-3 text-sm">
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 font-medium text-paper shadow-sm transition-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-40"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
          <path d="M17 21v-8H7v8M7 3v5h8" />
        </svg>
        {busy ? "Saving…" : "Save to my vault"}
      </button>
      {error && <span className="text-red-700">{error}</span>}
    </span>
  );
}
