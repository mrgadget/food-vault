import Link from "next/link";

import { UnitsToggle } from "./units-toggle";
import { getUnitSystem } from "@/lib/db/settings";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return (
      <p className="text-muted">
        Sign in to change your settings.{" "}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    );
  }

  const system = await getUnitSystem(supabase);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>

      <section className="mt-8 rounded-card border border-line bg-surface p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold">Measurements</h2>
        <p className="mt-1 text-sm text-muted">
          Foods are stored in metric and shown in your chosen system. This changes how amounts and
          oven temperatures are displayed, not what was imported.
        </p>
        <div className="mt-5">
          <UnitsToggle initial={system} />
        </div>
      </section>
    </div>
  );
}
