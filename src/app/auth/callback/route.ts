/**
 * src/app/auth/callback/route.ts
 *
 * GET /auth/callback
 *
 * PKCE code-exchange handler. Supabase redirects here after:
 *   • Email confirmation links
 *   • Password-reset links  (redirects onward to /reset-password)
 *
 * The `next` query param carries the post-auth destination.
 * Defaults to /dashboard if absent.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // next must be a relative path to prevent open-redirect attacks.
      const destination = next.startsWith('/') ? next : '/dashboard';
      return NextResponse.redirect(`${origin}${destination}`);
    }

    console.error('[auth/callback] exchangeCodeForSession failed:', error.message);
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('Auth link is invalid or has expired. Please try again.')}`,
  );
}
