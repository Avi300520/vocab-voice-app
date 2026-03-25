/**
 * src/app/review/page.tsx
 *
 * Protected review page — Server Component.
 * Shows due-word count and a form that triggers createReviewSession.
 * Handles ?error= query params set by createReviewSession on failure.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createReviewSession } from '@/app/actions/sessions';
import type { WordMasteryRow } from '@/lib/supabase/types';

const ERROR_MESSAGES: Record<string, string> = {
  fetch:    'Could not load your word list. Please try again.',
  none_due: 'No words are due for review right now.',
  create:   'Failed to create review session. Please try again.',
};

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const params   = await searchParams;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  // Count words due for review: next_review_at <= now, in a review-eligible state
  const { data: dueMastery } = await supabase
    .from('word_mastery')
    .select('word_id')
    .eq('user_id', user.id)
    .in('state', ['needs_review', 'practicing', 'stable'])
    .lte('next_review_at', new Date().toISOString())
    .returns<Pick<WordMasteryRow, 'word_id'>[]>();

  const dueCount   = dueMastery?.length ?? 0;
  const hasDueWords = dueCount > 0;
  const errorMsg   = params.error ? (ERROR_MESSAGES[params.error] ?? 'Something went wrong.') : null;

  return (
    <main
      className="min-h-dvh px-4 py-8 md:px-6 md:py-10 max-w-2xl mx-auto w-full"
      style={{ color: 'var(--color-codex-text)' }}
    >
      {/* ── Header ── */}
      <header className="mb-8 animate-fade-up">
        <p
          className="text-xs uppercase tracking-widest mb-1"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          Spaced Repetition
        </p>
        <h1
          className="font-display text-4xl md:text-5xl"
          style={{ color: 'var(--color-codex-text)' }}
        >
          Review Session
        </h1>
      </header>

      {/* ── Error banner ── */}
      {errorMsg && (
        <div
          className="mb-6 p-3 rounded text-sm animate-fade-up"
          style={{
            color:      '#F87171',
            background: 'color-mix(in srgb, #F87171 8%, transparent)',
            border:     '1px solid color-mix(in srgb, #F87171 22%, transparent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* ── Status card ── */}
      <section className="card p-6 animate-fade-up animate-fade-up-delay-1">
        {hasDueWords ? (
          <>
            <p
              className="text-xs uppercase tracking-widest mb-2"
              style={{ fontFamily: 'var(--font-mono)', color: '#F87171' }}
            >
              Review Due
            </p>
            <p
              className="font-display text-3xl mb-2"
              style={{ color: 'var(--color-codex-text)' }}
            >
              {dueCount} {dueCount === 1 ? 'word' : 'words'} ready
            </p>
            <p
              className="text-sm mb-6"
              style={{ color: 'var(--color-codex-muted)' }}
            >
              These words are scheduled for review today. Use them naturally in conversation
              to reinforce long-term retention.
            </p>
            <form action={createReviewSession}>
              <button type="submit" className="btn-primary">
                Start Review →
              </button>
            </form>
          </>
        ) : (
          <>
            <p
              className="text-xs uppercase tracking-widest mb-2"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-teal)' }}
            >
              All Caught Up
            </p>
            <p
              className="font-display text-3xl mb-2"
              style={{ color: 'var(--color-codex-text)' }}
            >
              Nothing due
            </p>
            <p
              className="text-sm"
              style={{ color: 'var(--color-codex-muted)' }}
            >
              No words are scheduled for review right now. Check back later or start a
              practice session to add new words to your rotation.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
