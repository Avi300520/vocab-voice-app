/**
 * src/lib/supabase/server.ts
 *
 * Server-side Supabase client — use inside Server Components, Route Handlers,
 * and Server Actions. Reads/writes the auth session via the Next.js `cookies()`
 * API so the token is always forwarded correctly to Supabase.
 *
 * NOTE: `cookies()` returns a ReadonlyRequestCookies in Server Components,
 * meaning `setAll` writes are silently ignored there — this is expected and safe.
 * Cookie mutations only succeed (and are needed) inside Route Handlers and
 * Server Actions.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Intentionally empty: mutations are no-ops in Server Components.
          }
        },
      },
    },
  );
}
