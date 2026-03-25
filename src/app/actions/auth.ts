'use server';

/**
 * src/app/actions/auth.ts
 *
 * Server Actions for authentication.
 * All actions use the server-side Supabase client so the session cookie
 * is set/cleared correctly before the redirect fires.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// ─── Sign Up ─────────────────────────────────────────────────────────────────

export async function signUp(formData: FormData) {
  const supabase = await createClient();

  const email       = (formData.get('email')        as string).trim();
  const password    =  formData.get('password')     as string;
  const displayName = (formData.get('display_name') as string).trim();
  const proficiency = (formData.get('proficiency')  as string) || 'intermediate';

  if (!email || !password || !displayName) {
    redirect('/register?error=All+fields+are+required.');
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      /**
       * Supabase passes `options.data` into auth.users.raw_user_meta_data.
       * Our trigger (handle_new_user) reads display_name and proficiency
       * from that JSON blob to auto-create the profiles row.
       */
      data: {
        display_name: displayName,
        proficiency,
      },
    },
  });

  if (error) {
    redirect(`/register?error=${encodeURIComponent(error.message)}`);
  }

  // Supabase may return a user but with identities:[] when email
  // confirmation is required. Detect that and show a helpful message.
  if (data.user && data.user.identities?.length === 0) {
    redirect('/register?error=An+account+with+this+email+already+exists.');
  }

  if (!data.session) {
    // Email confirmation is enabled — user must verify before logging in.
    redirect('/login?message=Check+your+email+to+confirm+your+account+before+signing+in.');
  }

  redirect('/dashboard');
}

// ─── Sign In ─────────────────────────────────────────────────────────────────

export async function signIn(formData: FormData) {
  const supabase = await createClient();

  const email    = (formData.get('email')    as string).trim();
  const password =  formData.get('password') as string;

  if (!email || !password) {
    redirect('/login?error=Email+and+password+are+required.');
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect('/dashboard');
}

// ─── Sign Out ─────────────────────────────────────────────────────────────────

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

// ─── Request Password Reset ───────────────────────────────────────────────────
/**
 * Sends a Supabase password-reset email.
 * The email contains a PKCE link that redirects to /auth/callback?next=/reset-password,
 * where the code is exchanged for a temporary recovery session before the
 * user lands on /reset-password to set their new password.
 *
 * Always redirects to the same success message regardless of whether the
 * email is registered — prevents user enumeration.
 */
export async function requestPasswordReset(formData: FormData) {
  const supabase = await createClient();
  const email    = (formData.get('email') as string).trim();

  if (!email) {
    redirect('/forgot-password?error=Email+is+required.');
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`,
  });

  if (error) {
    console.error('[requestPasswordReset] Supabase error:', error.message);
    // Still redirect to the success message to avoid leaking whether the email exists.
  }

  redirect(
    '/forgot-password?message=If+that+email+is+registered,+a+reset+link+has+been+sent.',
  );
}

// ─── Update Password ──────────────────────────────────────────────────────────
/**
 * Called from /reset-password after /auth/callback has exchanged the PKCE code
 * and established a temporary recovery session.
 * Validates that both password fields match before calling updateUser.
 */
export async function updatePassword(formData: FormData) {
  const supabase        = await createClient();
  const password        =  formData.get('password')         as string;
  const confirmPassword =  formData.get('confirm_password') as string;

  if (!password || password.length < 8) {
    redirect('/reset-password?error=Password+must+be+at+least+8+characters.');
  }

  if (password !== confirmPassword) {
    redirect('/reset-password?error=Passwords+do+not+match.');
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(`/reset-password?error=${encodeURIComponent(error.message)}`);
  }

  redirect('/dashboard?message=Password+updated+successfully.');
}
