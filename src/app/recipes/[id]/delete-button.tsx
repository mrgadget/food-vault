"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteRecipeButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/recipes/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error ?? "Could not delete that recipe.");
      setBusy(false);
      return;
    }

    // The list is a server component holding the deleted row; refresh before
    // navigating or it renders from cache.
    router.refresh();
    router.push("/");
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Delete recipe"
        className="shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-red-50 hover:text-red-700"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-3 text-sm">
      {/* The recipe and its photographs go for good; deletion is not undoable. */}
      <span className="text-muted">Delete permanently?</span>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="rounded-full bg-red-700 px-3.5 py-1.5 font-medium text-white shadow-sm disabled:opacity-40"
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="text-muted hover:text-ink"
      >
        Cancel
      </button>
      {error && <span className="text-red-700">{error}</span>}
    </span>
  );
}
