"use client";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await createClient().auth.signOut();
        // Full load, not a client nav: the root-layout header was server-rendered
        // logged in, and only a fresh server render clears it. Same reason as the
        // sign-in redirect.
        window.location.assign("/login");
      }}
      className="text-sm text-muted transition-colors hover:text-ink"
    >
      Sign out
    </button>
  );
}
