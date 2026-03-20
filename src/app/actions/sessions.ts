'use server';

/**
 * src/app/actions/sessions.ts
 *
 * Server Actions for session lifecycle management.
 */

import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { createClient } from '@/lib/supabase/server';

// ── Shared state type for useActionState consumers ────────────────────────────
export type CreateSessionState = { error: string | null };

// ── Create a new practice session ────────────────────────────────────────────
/**
 * Designed for use with React's `useActionState` hook.
 * Signature: (prevState, formData) → CreateSessionState | never (redirect)
 *
 * On DB failure: returns { error: string } so the UI can display it.
 * On success: calls redirect() which throws NEXT_REDIRECT — re-thrown so
 * Next.js handles client-side navigation correctly.
 *
 * WHY: Calling redirect() inside a raw startTransition event-handler silently
 * swallows the NEXT_REDIRECT throw. useActionState is the correct hook for
 * server actions invoked from event handlers — it properly propagates both
 * redirect signals and returned error states back to the framework.
 */
export async function createSession(
  _prev: CreateSessionState,
  formData: FormData,
): Promise<CreateSessionState> {
  const supabase = await createClient();

  // Auth check — redirect() is outside any try/catch so it propagates cleanly.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect('/login');

  const topic = (formData.get('topic') as string)?.trim();
  const topicContext =
    (formData.get('topic_context') as string)?.trim() || null;

  if (!topic) return { error: 'Please select a topic.' };

  // Initialised to '' so TypeScript doesn't flag use-before-assign on redirect().
  // We never reach redirect() with sessionId === '' because insert errors return early.
  let sessionId = '';

  try {
    const { data: session, error: insertError } = await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
        topic,
        topic_context: topicContext,
        status: 'active',
      })
      .select('id')
      .single();

    if (insertError || !session) {
      // Log the full Supabase error so we can diagnose RLS / schema mismatches.
      console.error('[createSession] DB insert failed:', {
        code: insertError?.code,
        message: insertError?.message,
        details: insertError?.details,
        hint: insertError?.hint,
      });
      return {
        error:
          insertError?.message ??
          'Failed to create session — check RLS policies or required fields.',
      };
    }

    sessionId = session.id;
  } catch (err) {
    // Re-throw NEXT_REDIRECT so Next.js can handle navigation.
    if (isRedirectError(err)) throw err;

    console.error('[createSession] Unexpected error:', err);
    return { error: 'Unexpected server error. Please try again.' };
  }

  // redirect() is intentionally outside the try/catch.
  // Its NEXT_REDIRECT throw propagates up to Next.js correctly from here.
  redirect(`/session/${sessionId}`);
}

// ── Mark a session as completed ───────────────────────────────────────────────
export async function completeSession(sessionId: string): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  await supabase
    .from('sessions')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('user_id', user.id);

  redirect('/dashboard');
}

// ── Abandon a session (user left early) ──────────────────────────────────────
export async function abandonSession(sessionId: string): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  await supabase
    .from('sessions')
    .update({ status: 'abandoned', ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('user_id', user.id);

  redirect('/dashboard');
}
