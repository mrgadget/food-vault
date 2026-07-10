"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

// Supabase's own floor is 6. Eight costs the user nothing and is a better default.
const MIN_PASSWORD = 8;

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (mode === "signup" && password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(friendlyError(error.message));
        setBusy(false);
        return;
      }
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(friendlyError(error.message));
        setBusy(false);
        return;
      }
      // With "Confirm email" enabled, signUp returns a user but no session --
      // nothing is signed in until the emailed link is clicked. With it
      // disabled, a session comes straight back and we can go to the app.
      if (!data.session) {
        setConfirmSent(true);
        setBusy(false);
        return;
      }
    }

    // The session lives in a cookie the server has not seen yet.
    router.refresh();
    router.push("/");
  }

  if (confirmSent) {
    return (
      <div className="mx-auto max-w-md rounded-card border border-line bg-surface p-8 shadow-sm">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Confirm your email</h1>
        <p className="mt-3 text-muted">
          We sent a confirmation link to{" "}
          <span className="font-medium text-ink">{email}</span>. Click it, then sign in.
        </p>
        <p className="mt-4 text-sm text-muted">
          Not what you wanted? Turn off <span className="font-medium">Confirm email</span> under
          Authentication → Sign In / Providers in the Supabase dashboard, and accounts will be
          usable the moment they are created.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-md rounded-card border border-line bg-surface p-8 shadow-sm">
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        {mode === "signin" ? "Welcome back" : "Create an account"}
      </h1>
      <p className="mt-1.5 text-muted">
        {mode === "signin" ? "Sign in to your recipe vault." : "Start saving recipes in one place."}
      </p>

      <label htmlFor="email" className="mt-7 block text-sm font-medium">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="mt-2 w-full rounded-lg border border-line bg-paper px-4 py-3 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
      />

      <label htmlFor="password" className="mt-4 block text-sm font-medium">
        Password
      </label>
      <input
        id="password"
        type="password"
        required
        minLength={mode === "signup" ? MIN_PASSWORD : undefined}
        // Tells a password manager to offer a new password rather than autofill an old one.
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="mt-2 w-full rounded-lg border border-line bg-paper px-4 py-3 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      {mode === "signup" && (
        <p className="mt-2 text-sm text-muted">At least {MIN_PASSWORD} characters.</p>
      )}

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={busy || !email || !password}
        className="mt-6 w-full rounded-full bg-accent px-5 py-3 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0"
      >
        {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <p className="mt-6 text-sm text-muted">
        {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="font-medium text-accent hover:underline"
        >
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>
    </form>
  );
}

function friendlyError(message: string): string {
  // Supabase deliberately returns one message for a wrong password and an
  // unknown email, so an attacker cannot enumerate accounts. Don't undo that.
  if (/invalid login credentials/i.test(message)) {
    return "That email and password don't match an account.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Confirm your email address first — check your inbox for the link.";
  }
  if (/already registered/i.test(message)) {
    return "That email already has an account. Sign in instead.";
  }
  return message;
}
