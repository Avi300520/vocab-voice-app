/**
 * src/proxy.ts
 *
 * Next.js 16+ Proxy (formerly Middleware — see migration guide).
 * Replaces src/middleware.ts, which is deprecated as of Next.js 16.0.0.
 *
 * Responsibilities:
 *   1. Refresh the Supabase session token (PKCE + cookie rotation).
 *   2. Redirect unauthenticated users from /dashboard → /login.
 *   3. Redirect authenticated users from /login and /register → /dashboard.
 *
 * Runtime: Node.js (new default in Next.js 16; Edge is no longer the default).
 * NOTE: The `runtime` segment-config option is NOT allowed in proxy files.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest, type NextProxy } from 'next/server';
import type { Database } from '@/lib/supabase/types';

export const proxy: NextProxy = async (request: NextRequest) => {
  /**
   * We start with a plain NextResponse.next() and then potentially replace it
   * if Supabase needs to rotate the session cookie. The @supabase/ssr pattern
   * requires us to rebuild the response inside setAll so the refreshed token
   * is written to BOTH the request cookies (for upstream Server Components)
   * AND the response Set-Cookie headers (for the browser).
   */
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // 1. Forward rotated cookies onto the mutated request object…
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          // 2. …then rebuild the response from the updated request so the
          //    browser also receives the new Set-Cookie headers.
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  /**
   * CRITICAL: Do NOT add any awaited calls between createServerClient()
   * and supabase.auth.getUser(). Any async gap here can break cookie
   * rotation and cause session drift between the proxy and Server Components.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // ── Protected routes: /dashboard  /words  /setup-session ────────────────
  const PROTECTED = ['/dashboard', '/words', '/setup-session'];
  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));

  if (!user && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('message', 'Please+sign+in+to+continue.');
    return NextResponse.redirect(loginUrl);
  }

  // ── Guard: authenticated → /login or /register redirects to /dashboard ───
  if (user && (pathname === '/login' || pathname === '/register')) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    return NextResponse.redirect(dashboardUrl);
  }

  // Return the (potentially cookie-rotated) response for all other routes.
  return supabaseResponse;
};

/**
 * Run the proxy on every route except Next.js internals and static assets.
 * Pattern sourced from the official Next.js 16 proxy API reference.
 *
 * Note: _next/data routes are intentionally NOT excluded — the proxy still
 * runs for them even if listed here (by design, to prevent accidental security
 * gaps where a page is protected but its data route is not).
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
