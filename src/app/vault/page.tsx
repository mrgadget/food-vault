import { getActiveVault, listMembers } from "@/lib/db/vaults";
import { createClient } from "@/lib/supabase/server";

import { MembersManager } from "./members-manager";

/**
 * Manage who can reach the active vault. Owners invite people by email and set
 * their role; everyone else sees the roster read-only. Switch vaults from the
 * header to manage a different one.
 */
export default async function VaultPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) return null;

  const { active } = await getActiveVault(supabase, auth.user.email);
  const members = await listMembers(supabase, active.id);
  const isOwner = active.role === "owner";

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Sharing</h1>
      <p className="mt-1.5 text-muted">
        Who can reach <span className="font-medium text-ink">{active.name}</span>.{" "}
        {isOwner
          ? "Invite people by email — viewers can browse, editors can also add and change recipes."
          : `You have ${active.role} access to this vault.`}
      </p>

      <MembersManager
        vaultId={active.id}
        members={members}
        isOwner={isOwner}
        me={auth.user.email.toLowerCase()}
      />

      {!isOwner && (
        <p className="mt-6 text-sm text-muted">
          Only the owner can change who has access. To manage your own vault, switch to it in the
          header.
        </p>
      )}
    </div>
  );
}
