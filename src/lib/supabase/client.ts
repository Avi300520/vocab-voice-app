/**
 * src/lib/supabase/client.ts
 *
 * Browser-side Supabase client — use inside Client Components ('use client').
 * Instantiated once per render via createBrowserClient from @supabase/ssr,
 * which automatically manages the auth session through cookies.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
