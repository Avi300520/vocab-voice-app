/**
 * src/app/dashboard/page.tsx
 *
 * Protected dashboard — Server Component.
 * Navigation hub for Word Bank, Session practice, and mastery overview.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/app/actions/auth';
import type { ProfileRow, WordRow, WordMasteryRow, MasteryState } from '@/lib/supabase/types';

// ── Mastery state display metadata ────────────────────────────────────────────

const MASTERY_STATES: { state: MasteryState; label: string; color: string }[] = [
  { state: 'needs_review', label: 'Needs Review', color: '#F87171' },
  { state: 'practicing',   label: 'Practicing',   color: 'var(--color-codex-gold)' },
  { state: 'passive',      label: 'Passive',      color: 'var(--color-codex-muted)' },
  { state: 'stable',       label: 'Stable',       color: 'var(--color-codex-teal)' },
  { state: 'mastered',     label: 'Mastered',     color: 'var(--color-status-mastered)' },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; ended?: string }>;
}) {
  const supabase = await createClient();
  const params   = await searchParams;

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  // ── Parallel fetch: profile + words + mastery ────────────────────────────────
  const [profileResult, wordCountResult, masteryResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single<ProfileRow>(),
    supabase.from('words').select('id, status').returns<Pick<WordRow, 'id' | 'status'>[]>(),
    supabase
      .from('word_mastery')
      .select('state')
      .eq('user_id', user.id)
      .returns<Pick<WordMasteryRow, 'state'>[]>(),
  ]);

  const profile    = profileResult.data;
  const wordCount  = wordCountResult.data?.length ?? 0;
  const masteryRows = masteryResult.data ?? [];

  // ── Compute mastery state counts ─────────────────────────────────────────────
  const masteryCounts = MASTERY_STATES.reduce(
    (acc, { state }) => {
      acc[state] = masteryRows.filter((r) => r.state === state).length;
      return acc;
    },
    {} as Record<MasteryState, number>,
  );

  const reviewCount   = masteryCounts.needs_review ?? 0;
  const masteredCount = masteryCounts.mastered ?? 0;
  const hasReviewWords = reviewCount > 0;
  const practicingCount = (masteryCounts.practicing ?? 0) + reviewCount;

  return (
    <main
      className="min-h-dvh px-4 py-8 md:px-6 md:py-10 max-w-2xl mx-auto w-full"
      style={{ color: 'var(--color-codex-text)' }}
    >
      {/* ── Header ── */}
      <header className="flex items-start justify-between mb-8 animate-fade-up">
        <div>
          <p
            className="text-xs uppercase tracking-widest mb-1"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            VocabVoice
          </p>
          <h1
            className="font-display text-4xl md:text-5xl"
            style={{ color: 'var(--color-codex-text)' }}
          >
            {profile?.display_name ?? 'Welcome'}
          </h1>
        </div>
        <form action={signOut} className="mt-1">
          <button type="submit" className="btn-ghost">
            Sign Out
          </button>
        </form>
      </header>

      {/* ── Session ended banners ── */}
      {params.ended === 'completed' && (
        <div
          className="mb-6 p-3 rounded text-sm animate-fade-up"
          style={{
            color:      'var(--color-status-mastered)',
            background: 'color-mix(in srgb, var(--color-status-mastered) 8%, transparent)',
            border:     '1px solid color-mix(in srgb, var(--color-status-mastered) 22%, transparent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ✓ Session completed. Great practice.
        </div>
      )}
      {params.ended === 'abandoned' && (
        <div
          className="mb-6 p-3 rounded text-sm animate-fade-up"
          style={{
            color:      'var(--color-codex-muted)',
            background: 'color-mix(in srgb, var(--color-codex-muted) 6%, transparent)',
            border:     '1px solid color-mix(in srgb, var(--color-codex-muted) 18%, transparent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Session ended early.
        </div>
      )}

      {/* ── Nav cards ── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8 animate-fade-up animate-fade-up-delay-1">
        {/* Word Bank card */}
        <Link href="/words" className="card p-5 flex flex-col gap-2 group no-underline">
          <div className="flex items-center justify-between">
            <span
              className="category-tag"
              style={{
                background: 'color-mix(in srgb, var(--color-codex-teal) 15%, transparent)',
                color: 'var(--color-codex-teal)',
              }}
            >
              LEXICON
            </span>
            <span
              className="text-xs group-hover:translate-x-0.5 transition-transform"
              style={{ color: 'var(--color-codex-muted)' }}
            >
              →
            </span>
          </div>
          <h2
            className="font-display text-2xl"
            style={{ color: 'var(--color-codex-text)' }}
          >
            Word Bank
          </h2>
          <p className="text-xs" style={{ color: 'var(--color-codex-muted)' }}>
            {wordCount} {wordCount === 1 ? 'word' : 'words'} saved
            {masteredCount > 0 && ` · ${masteredCount} mastered`}
          </p>
        </Link>

        {/* Practice card */}
        <Link
          href={hasReviewWords ? '/setup-session?priority=review' : '/setup-session'}
          className="card p-5 flex flex-col gap-2 group no-underline"
        >
          <div className="flex items-center justify-between">
            <span
              className="category-tag"
              style={{
                background: hasReviewWords
                  ? 'color-mix(in srgb, #F87171 14%, transparent)'
                  : 'color-mix(in srgb, var(--color-codex-gold) 15%, transparent)',
                color: hasReviewWords ? '#F87171' : 'var(--color-codex-gold)',
              }}
            >
              {hasReviewWords ? 'REVIEW DUE' : 'SESSION'}
            </span>
            <span
              className="text-xs group-hover:translate-x-0.5 transition-transform"
              style={{ color: 'var(--color-codex-muted)' }}
            >
              →
            </span>
          </div>
          <h2
            className="font-display text-2xl"
            style={{ color: 'var(--color-codex-text)' }}
          >
            {hasReviewWords ? 'Review Words' : 'Begin Practice'}
          </h2>
          <p className="text-xs" style={{ color: 'var(--color-codex-muted)' }}>
            {hasReviewWords
              ? `${reviewCount} word${reviewCount !== 1 ? 's' : ''} need attention`
              : 'Choose a topic and start a voice session'}
          </p>
        </Link>
      </section>

      <div className="divider mb-8" />

      {/* ── Mastery breakdown ── */}
      <section className="card p-5 animate-fade-up animate-fade-up-delay-2">
        <p
          className="text-xs uppercase tracking-widest mb-5"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          Vocabulary — FSRS Mastery State
        </p>

        {masteryRows.length === 0 ? (
          <p
            className="text-sm"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
          >
            No mastery data yet — complete a session to start tracking.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {MASTERY_STATES.map(({ state, label, color }) => {
              const count = masteryCounts[state] ?? 0;
              const pct = masteryRows.length > 0 ? (count / masteryRows.length) * 100 : 0;
              return (
                <div key={state}>
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-xs uppercase tracking-widest"
                      style={{ fontFamily: 'var(--font-mono)', color }}
                    >
                      {label}
                    </span>
                    <span
                      className="text-xs tabular-nums"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
                    >
                      {count}
                    </span>
                  </div>
                  <div
                    className="h-1 w-full rounded-full overflow-hidden"
                    style={{ background: 'var(--color-codex-surface-high)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                </div>
              );
            })}

            <p
              className="text-xs mt-1"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
            >
              {masteryRows.length} of {wordCount} word{wordCount !== 1 ? 's' : ''} evaluated
              {practicingCount > 0 && ` · ${practicingCount} in active rotation`}
            </p>
          </div>
        )}
      </section>

      {/* ── Onboarding shortcut (only shown when word bank is empty) ── */}
      {wordCount === 0 && (
        <section
          className="card p-5 mt-4 animate-fade-up animate-fade-up-delay-3"
          style={{ borderColor: 'color-mix(in srgb, var(--color-codex-teal) 35%, var(--color-codex-border))' }}
        >
          <p
            className="text-xs uppercase tracking-widest mb-2"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-teal)' }}
          >
            Get started
          </p>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--color-codex-muted)' }}
          >
            Your word bank is empty. Take a 2-minute voice assessment to get a personalised vocabulary list.
          </p>
          <Link href="/onboarding/diagnostic" className="btn-primary no-underline">
            Start Voice Assessment →
          </Link>
        </section>
      )}
    </main>
  );
}
