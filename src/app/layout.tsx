import type { Metadata, Viewport } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "RecipeVault",
  description: "Collect recipes from the web and from photos of recipe cards.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "RecipeVault", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#faf7f2",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <header className="border-b border-stone-200">
          <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Recipe<span className="text-amber-700">Vault</span>
            </Link>
            <Link
              href="/import"
              className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white"
            >
              Add recipe
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
