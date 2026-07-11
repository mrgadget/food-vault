import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { DB_SCHEMA } from "./schema";

/** A client bound to this app's schema. Not interchangeable with a `public` one. */
export type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Request-scoped client carrying the signed-in user's session. Every query it
 * makes is filtered by row-level security, so it can never reach another
 * user's foods even if a query forgets its own `where user_id` clause.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: DB_SCHEMA },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh is handled by middleware instead.
          }
        },
      },
    },
  );
}
