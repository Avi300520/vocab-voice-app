'use server';

/**
 * src/app/actions/sessions.ts
 *
 * Server Actions for session lifecycle management.
 */

import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { createClient } from '@/lib/supabase/server';
import type {
  SessionRow,
  SessionMessageRow,
  SemanticEvaluationRow,
  SessionWordRow,
  WordRow,
} from '@/lib/supabase/types';

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

  // No redirect() here — the Client Component handles navigation via useRouter
  // so that startTransition can properly manage the loading state.
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

  // No redirect() here — the Client Component handles navigation via useRouter.
}

// ── Session summary data (used by the post-session summary page) ─────────────

export type SessionSummaryData = {
  session: SessionRow;
  messages: SessionMessageRow[];
  evaluations: (SemanticEvaluationRow & { word_text: string })[];
  sessionWords: (SessionWordRow & { word_text: string })[];
};

export async function getSessionSummaryData(
  sessionId: string,
): Promise<SessionSummaryData | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  // Parallel fetch: session, messages, evaluations, session_words, words (for names)
  const [sessionRes, messagesRes, evalsRes, swRes, wordsRes] = await Promise.all([
    supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .single<SessionRow>(),
    supabase
      .from('session_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('turn_index', { ascending: true })
      .order('role', { ascending: true })
      .returns<SessionMessageRow[]>(),
    supabase
      .from('semantic_evaluations')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .order('turn_index', { ascending: true })
      .returns<SemanticEvaluationRow[]>(),
    supabase
      .from('session_words')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .returns<SessionWordRow[]>(),
    supabase
      .from('words')
      .select('id, word')
      .eq('user_id', user.id)
      .returns<Pick<WordRow, 'id' | 'word'>[]>(),
  ]);

  if (sessionRes.error || !sessionRes.data) return null;

  // Build a word-id → word-text lookup
  const wordLookup = new Map(
    (wordsRes.data ?? []).map((w) => [w.id, w.word]),
  );

  const evaluations = (evalsRes.data ?? []).map((e) => ({
    ...e,
    word_text: wordLookup.get(e.word_id) ?? '(unknown)',
  }));

  const sessionWords = (swRes.data ?? []).map((sw) => ({
    ...sw,
    word_text: wordLookup.get(sw.word_id) ?? '(unknown)',
  }));

  return {
    session: sessionRes.data,
    messages: messagesRes.data ?? [],
    evaluations,
    sessionWords,
  };
}
