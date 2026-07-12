"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Role = "owner" | "editor" | "viewer";
type Member = { email: string; role: Role };
type Vault = { id: string; name: string; role: Role };

// Each role gets its own colour so the roster reads at a glance.
const ROLE_STYLE: Record<Role, string> = {
  owner: "bg-accent-soft text-accent",
  editor: "bg-emerald-100 text-emerald-800",
  viewer: "bg-slate-200 text-slate-600",
};

function Chip({ role, onClick, title }: { role: Role; onClick?: () => void; title?: string }) {
  const className = `rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ROLE_STYLE[role]}`;
  if (!onClick) return <span className={className}>{role}</span>;
  return (
    <button type="button" onClick={onClick} title={title} className={`${className} transition-transform hover:scale-105`}>
      {role}
    </button>
  );
}

const other = (role: "viewer" | "editor") => (role === "viewer" ? "editor" : "viewer");

export function VaultManager({ vault, members, me }: { vault: Vault; members: Member[]; me: string }) {
  const router = useRouter();
  const isOwner = vault.role === "owner";
  const [name, setName] = useState(vault.name);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function api(path: string, method: "POST" | "DELETE", body: object): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId: vault.id, ...body }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "Something went wrong.");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <section className="mt-8 rounded-card border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">This vault</h2>
        {isOwner ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              api("/api/vault/rename", "POST", { name });
            }}
            className="mt-3 flex gap-3"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              aria-label="Vault name"
              className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm font-medium outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <button
              type="submit"
              disabled={busy || !name.trim() || name.trim() === vault.name}
              className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper shadow-sm disabled:opacity-40"
            >
              Rename
            </button>
          </form>
        ) : (
          <p className="mt-2 text-lg font-medium">{vault.name}</p>
        )}
      </section>

      <section className="mt-6 rounded-card border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Members</h2>

        {isOwner && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await api("/api/vault/members", "POST", { email, role: inviteRole })) setEmail("");
            }}
            className="mt-3 flex flex-wrap items-center gap-3"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              aria-label="Invite by email"
              className="min-w-[14rem] flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <Chip role={inviteRole} onClick={() => setInviteRole(other(inviteRole))} title="Click to switch role" />
            <button
              type="submit"
              disabled={busy || !email}
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm disabled:opacity-40"
            >
              Invite
            </button>
          </form>
        )}

        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

        <ul className="mt-5 divide-y divide-line/70">
          {members.map((member) => {
            const isMe = member.email === me;
            const canToggle = isOwner && member.role !== "owner";
            const role = member.role as "viewer" | "editor";
            return (
              <li key={member.email} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-sm">
                  {member.email}
                  {isMe && <span className="ml-1.5 text-muted">(you)</span>}
                </span>
                <div className="flex items-center gap-3">
                  <Chip
                    role={member.role}
                    onClick={canToggle ? () => api("/api/vault/members", "POST", { email: member.email, role: other(role) }) : undefined}
                    title={canToggle ? `Make ${other(role)}` : undefined}
                  />
                  {canToggle && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => api("/api/vault/members", "DELETE", { email: member.email })}
                      className="text-xs font-medium text-red-700 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
