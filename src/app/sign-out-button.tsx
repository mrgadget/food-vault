"use client";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        await createClient().auth.signOut();
        // The server still holds the old session cookie until it re-renders.
        router.refresh();
        router.push("/login");
      }}
      className="text-sm text-stone-600 underline"
    >
      Sign out
    </button>
  );
}
