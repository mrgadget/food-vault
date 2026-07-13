"use client";

import { useState } from "react";

type Vault = { id: string; name: string; role: string };

/**
 * Picks which vault the user is working in. Writes the choice via the switch
 * route, then does a full load so every server component re-renders against the
 * new active vault. Only shown when there's more than one to choose from.
 */
export function VaultSwitcher({ vaults, activeId }: { vaults: Vault[]; activeId: string }) {
  const [busy, setBusy] = useState(false);

  if (vaults.length < 2) return null;

  async function switchTo(id: string) {
    if (id === activeId || busy) return;
    setBusy(true);
    await fetch("/api/vault/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId: id }),
    });
    window.location.assign("/");
  }

  return (
    <select
      aria-label="Active vault"
      value={activeId}
      disabled={busy}
      onChange={(event) => switchTo(event.target.value)}
      className="min-w-0 max-w-[8rem] truncate rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm font-medium text-ink sm:max-w-[11rem]"
    >
      {vaults.map((vault) => (
        <option key={vault.id} value={vault.id}>
          {vault.name}
          {vault.role !== "owner" ? ` · ${vault.role}` : ""}
        </option>
      ))}
    </select>
  );
}
