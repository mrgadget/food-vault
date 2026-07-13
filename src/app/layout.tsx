import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { HeaderMenu } from "./header-menu";
import { VaultSwitcher } from "./vault-switcher";
import { canEdit, getActiveVault } from "@/lib/db/vaults";
import { createClient } from "@/lib/supabase/server";

import "./globals.css";

export const metadata: Metadata = {
  title: "FoodVault",
  description: "Collect foods from the web and from photos of food cards.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FoodVault", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#faf7f1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  // The signed-in header depends on which vault is active and the role there.
  const vault = auth.user?.email ? await getActiveVault(supabase, auth.user.email) : null;

  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/80 backdrop-blur-md">
          <nav className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Link
                href="/"
                className="shrink-0 font-display text-xl font-semibold tracking-tight text-ink transition-opacity hover:opacity-70"
              >
                Food<span className="text-accent">Vault</span>
              </Link>
              {vault && <VaultSwitcher vaults={vault.vaults} activeId={vault.active.id} />}
            </div>
            {vault && <HeaderMenu canEdit={canEdit(vault.active.role)} />}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
