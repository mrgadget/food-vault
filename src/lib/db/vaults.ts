import { cookies } from "next/headers";

import type { ServerClient } from "@/lib/supabase/server";

export type Role = "owner" | "editor" | "viewer";

export type Vault = { id: string; name: string; role: Role; status: string };

export type Member = { email: string; role: Role };

const ACTIVE_COOKIE = "vault";

/** Everyone with owner/editor may change a vault's contents. */
export function canEdit(role: Role | undefined): boolean {
  return role === "owner" || role === "editor";
}

/**
 * The vaults the signed-in user belongs to, each with their role.
 *
 * RLS lets a member read the roster of any vault they are in, so filtering the
 * membership table to their own email returns exactly their memberships.
 */
export async function listVaults(supabase: ServerClient, email: string): Promise<Vault[]> {
  const { data, error } = await supabase
    .from("subscription_members")
    .select("role, subscriptions (id, name, status)")
    .eq("member_email", email.toLowerCase());
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => {
      const sub = row.subscriptions as unknown as { id: string; name: string; status: string } | null;
      return sub ? { id: sub.id, name: sub.name, role: row.role as Role, status: sub.status } : null;
    })
    .filter((v): v is Vault => v !== null)
    // Owned vault first, then by name — a stable order for the switcher.
    .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.name.localeCompare(b.name)));
}

/**
 * Every user has at least their own vault. A fresh sign-up has none, so create
 * one the first time we look. The insert policies allow creating a vault and
 * seeding yourself as its sole owner.
 */
export async function ensureVaults(supabase: ServerClient, email: string): Promise<Vault[]> {
  const existing = await listVaults(supabase, email);
  if (existing.length > 0) return existing;

  const name = `${email.split("@")[0]}'s vault`;
  // The id is chosen here rather than read back: RLS cannot see the new vault
  // until the owner membership below exists, so a select-after-insert would
  // return nothing and throw. Insert both, then report the vault we just made.
  const id = crypto.randomUUID();
  const { error } = await supabase.from("subscriptions").insert({ id, name });
  if (error) throw new Error(`Could not create your vault: ${error.message}`);

  const { error: memberError } = await supabase
    .from("subscription_members")
    .insert({ subscription_id: id, member_email: email.toLowerCase(), role: "owner" });
  if (memberError) throw new Error(memberError.message);

  return [{ id, name, role: "owner", status: "active" }];
}

/**
 * The vault the user is currently working in, plus all the vaults they can pick
 * from. The choice is a cookie; it falls back to their own vault when unset or
 * pointing somewhere they no longer belong.
 */
export async function getActiveVault(
  supabase: ServerClient,
  email: string,
): Promise<{ vaults: Vault[]; active: Vault }> {
  const vaults = await ensureVaults(supabase, email);
  const wanted = (await cookies()).get(ACTIVE_COOKIE)?.value;
  const active = vaults.find((v) => v.id === wanted) ?? vaults[0];
  return { vaults, active };
}

/** The roster of a vault (owners see everyone; RLS refuses non-members). */
export async function listMembers(supabase: ServerClient, vaultId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from("subscription_members")
    .select("member_email, role")
    .eq("subscription_id", vaultId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => ({ email: row.member_email as string, role: row.role as Role }))
    .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.email.localeCompare(b.email)));
}

/** Invite or re-role a member. RLS refuses anyone but the vault's owner. */
export async function upsertMember(
  supabase: ServerClient,
  vaultId: string,
  email: string,
  role: Exclude<Role, "owner">,
): Promise<void> {
  const { error } = await supabase
    .from("subscription_members")
    .upsert(
      { subscription_id: vaultId, member_email: email.trim().toLowerCase(), role },
      { onConflict: "subscription_id,member_email" },
    );
  if (error) throw new Error(error.message);
}

export async function removeMember(supabase: ServerClient, vaultId: string, email: string): Promise<void> {
  const { error } = await supabase
    .from("subscription_members")
    .delete()
    .eq("subscription_id", vaultId)
    .eq("member_email", email.toLowerCase());
  if (error) throw new Error(error.message);
}

export { ACTIVE_COOKIE };
