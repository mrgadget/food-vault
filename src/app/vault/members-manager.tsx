"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Member = { email: string; role: "owner" | "editor" | "viewer" };

export function MembersManager({
  vaultId,
  members,
  isOwner,
  me,
}: {
  vaultId: string;
  members: Member[];
  isOwner: boolean;
  me: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE", body: object) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/vault/members", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, ...body }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Something went wrong.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (await send("POST", { email, role })) setEmail("");
  }

  return (
    <section className="mt-8 rounded-card border border-line bg-surface p-6 shadow-sm">
      {isOwner && (
        <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[14rem]">
            <label htmlFor="member-email" className="block text-sm font-medium">
              Invite by email
            </label>
            <input
              id="member-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
            aria-label="Role"
            className="rounded-lg border border-line bg-paper px-2.5 py-2 text-sm font-medium"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
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

      <ul className="mt-6 divide-y divide-line/70">
        {members.map((member) => (
          <li key={member.email} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0 truncate text-sm">
              {member.email}
              {member.email === me && <span className="ml-1.5 text-muted">(you)</span>}
            </span>
            <div className="flex items-center gap-3">
              {isOwner && member.role !== "owner" ? (
                <>
                  <select
                    value={member.role}
                    disabled={busy}
                    onChange={(e) => send("POST", { email: member.email, role: e.target.value })}
                    aria-label={`Role for ${member.email}`}
                    className="rounded-md border border-line bg-paper px-2 py-1 text-xs font-medium"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => send("DELETE", { email: member.email })}
                    className="text-xs font-medium text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium capitalize text-accent">
                  {member.role}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
