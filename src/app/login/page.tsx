"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) setError(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <p className="text-stone-600">
        Check <span className="font-medium text-stone-900">{email}</span> for a sign-in link.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <label htmlFor="email" className="mt-6 block text-sm font-medium">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="mt-2 w-full rounded-lg border border-stone-300 px-4 py-3"
      />
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        className="mt-6 rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-white"
      >
        Email me a link
      </button>
    </form>
  );
}
