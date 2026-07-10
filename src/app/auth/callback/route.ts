import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges a PKCE `code` for a session cookie.
 *
 * Sign-in is email and password now, so nothing in the app routes through here
 * day to day. It stays for the flows that still hand back a code: password
 * reset, and OAuth providers if any are ever added. Email confirmation links
 * use `token_hash` and `verifyOtp` instead, and are not handled here — the
 * intended setup is to turn "Confirm email" off.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }

  return NextResponse.redirect(`${origin}/login?error=link_expired`);
}
