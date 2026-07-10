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
        className="text-sm text-stone-500 underline underline-offset-2 hover:text-red-700"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-3 text-sm">
      {/* The recipe and its photographs go for good; deletion is not undoable. */}
      <span className="text-stone-700">Delete “{title}” permanently?</span>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="rounded-full bg-red-700 px-3 py-1 font-medium text-white disabled:opacity-40"
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="text-stone-500 underline"
      >
        Cancel
      </button>
      {error && <span className="text-red-700">{error}</span>}
    </span>
  );
}
