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
  SessionWordInsert,
  WordMasteryRow,
  WordRow,
} from '@/lib/supabase/types';

// ── Shared state type for useActionState consumers ────────────────────────────
export type CreateSessionState = { error: string | null };

// Hard cap prevents LLM context overflow and database bloat.
const SESSION_WORD_LIMIT = 10;

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

    // ── Populate session_words ─────────────────────────────────────────────
    // Fetch all words + mastery state for the user. Priority order:
    //   1. needs_review — earliest next_review_at first
    //   2. all other states — earliest next_review_at first (nulls last)
    const [masteryRes, wordsRes] = await Promise.all([
      supabase
        .from('word_mastery')
        .select('word_id, state, next_review_at')
        .eq('user_id', user.id)
        .returns<Pick<WordMasteryRow, 'word_id' | 'state' | 'next_review_at'>[]>(),
      supabase
        .from('words')
        .select('id')
        .eq('user_id', user.id)
        .returns<Pick<WordRow, 'id'>[]>(),
    ]);

    const masteryByWordId = new Map(
      (masteryRes.data ?? []).map((m) => [m.word_id, m]),
    );
    const allWordIds = (wordsRes.data ?? []).map((w) => w.id);

    const sorted = [...allWordIds].sort((a, b) => {
      const ma = masteryByWordId.get(a);
      const mb = masteryByWordId.get(b);
      const aNeedsReview = ma?.state === 'needs_review' ? 0 : 1;
      const bNeedsReview = mb?.state === 'needs_review' ? 0 : 1;
      if (aNeedsReview !== bNeedsReview) return aNeedsReview - bNeedsReview;
      const aTime = ma?.next_review_at ? new Date(ma.next_review_at).getTime() : Infinity;
      const bTime = mb?.next_review_at ? new Date(mb.next_review_at).getTime() : Infinity;
      return aTime - bTime;
    });

    const targetWords = sorted.slice(0, SESSION_WORD_LIMIT);

    if (targetWords.length > 0) {
      const sessionWordRows: SessionWordInsert[] = targetWords.map((wordId) => ({
        session_id: sessionId,
        word_id: wordId,
        user_id: user.id,
      }));

      const { error: swError } = await supabase
        .from('session_words')
        .insert(sessionWordRows);

      if (swError) {
        console.error('[createSession] session_words insert failed:', {
          code: swError.code,
          message: swError.message,
        });
        // Non-fatal: session is already created — log and continue to redirect.
      } else {
        await supabase
          .from('sessions')
          .update({ words_assigned: targetWords.length })
          .eq('id', sessionId);
      }
    }
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

// ── Create a spaced-repetition review session ─────────────────────────────────
/**
 * Called from the /review page form. Queries word_mastery for due words,
 * creates a session with topic = '__review__', inserts session_words,
 * then redirects to the session route.
 *
 * Accepts FormData to satisfy the Next.js form-action contract (data unused).
 */
export async function createReviewSession(_formData: FormData): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect('/login');

  // Fetch due words: next_review_at <= now, state in review-eligible set
  const { data: dueMastery, error: dueError } = await supabase
    .from('word_mastery')
    .select('word_id')
    .eq('user_id', user.id)
    .in('state', ['needs_review', 'practicing', 'stable'])
    .lte('next_review_at', new Date().toISOString())
    .order('next_review_at', { ascending: true })
    .limit(SESSION_WORD_LIMIT)
    .returns<Pick<WordMasteryRow, 'word_id'>[]>();

  if (dueError) {
    console.error('[createReviewSession] word_mastery query failed:', dueError.message);
    redirect('/review?error=fetch');
  }

  if (!dueMastery || dueMastery.length === 0) {
    redirect('/review?error=none_due');
  }

  const wordIds = dueMastery.map((m) => m.word_id);

  // Fetch word text for topic_context (used by the review system prompt)
  const { data: wordRows } = await supabase
    .from('words')
    .select('id, word')
    .in('id', wordIds)
    .returns<Pick<WordRow, 'id' | 'word'>[]>();

  const wordList = (wordRows ?? []).map((w) => w.word).join(', ');

  let sessionId = '';

  try {
    const { data: session, error: insertError } = await supabase
      .from('sessions')
      .insert({
        user_id:       user.id,
        topic:         '__review__',
        topic_context: wordList,
        status:        'active',
      })
      .select('id')
      .single();

    if (insertError || !session) {
      console.error('[createReviewSession] session insert failed:', {
        code:    insertError?.code,
        message: insertError?.message,
      });
      redirect('/review?error=create');
    }

    sessionId = session.id;

    const sessionWordRows: SessionWordInsert[] = wordIds.map((wordId) => ({
      session_id: sessionId,
      word_id:    wordId,
      user_id:    user.id,
    }));

    const { error: swError } = await supabase
      .from('session_words')
      .insert(sessionWordRows);

    if (swError) {
      console.error('[createReviewSession] session_words insert failed:', swError.message);
      // Non-fatal: session created — log and proceed to redirect.
    } else {
      await supabase
        .from('sessions')
        .update({ words_assigned: wordIds.length })
        .eq('id', sessionId);
    }
  } catch (err) {
    if (isRedirectError(err)) throw err;
    console.error('[createReviewSession] Unexpected error:', err);
    redirect('/review?error=create');
  }

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
