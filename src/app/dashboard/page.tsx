/**
 * src/app/dashboard/page.tsx
 *
 * Protected dashboard — Server Component.
 * Sprint 11: full command-centre with vocabulary status, daily goal,
 * review alert, and recent-sessions list.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/app/actions/auth';
import type {
  ProfileRow,
  WordRow,
  WordMasteryRow,
  MasteryState,
  SessionRow,
  SemanticEvaluationRow,
} from '@/lib/supabase/types';

// ── Constants ─────────────────────────────────────────────────────────────────

const DAILY_GOAL = 10;

// Four primary mastery states displayed in Vocabulary Status.
// needs_review is handled separately as the Review alert (Task 11.3).
const VOCAB_STATES: { state: MasteryState; label: string; color: string }[] = [
  { state: 'passive',    label: 'Passive',    color: 'var(--color-codex-muted)' },
  { state: 'practicing', label: 'Practicing', color: 'var(--color-codex-gold)' },
  { state: 'stable',     label: 'Stable',     color: 'var(--color-codex-teal)' },
  { state: 'mastered',   label: 'Mastered',   color: 'var(--color-status-mastered)' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTopic(topic: string): string {
  if (topic === '__review__') return 'Review';
  return topic.charAt(0).toUpperCase() + topic.slice(1);
}

function formatDuration(
  durationSec: number | null,
  startedAt: string,
  endedAt: string | null,
): string {
  const sec =
    durationSec ??
    (endedAt
      ? Math.floor(
          (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
        )
      : null);
  if (sec === null || sec < 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

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

  // ── Today at midnight UTC (for daily goal window) ────────────────────────
  const todayMidnight = new Date();
  todayMidnight.setUTCHours(0, 0, 0, 0);

  // ── Wave 1: all independent fetches in parallel ──────────────────────────
  const [
    profileResult,
    wordCountResult,
    masteryResult,
    dailyWordsResult,
    recentSessionsResult,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single<ProfileRow>(),

    supabase
      .from('words')
      .select('id, status')
      .returns<Pick<WordRow, 'id' | 'status'>[]>(),

    supabase
      .from('word_mastery')
      .select('state')
      .eq('user_id', user.id)
      .returns<Pick<WordMasteryRow, 'state'>[]>(),

    // Count session_words marked used today (for daily goal)
    supabase
      .from('session_words')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('used', true)
      .gte('used_at', todayMidnight.toISOString()),

    // Last 5 completed/abandoned sessions (excluding diagnostic)
    supabase
      .from('sessions')
      .select('id, topic, status, started_at, ended_at, duration_sec')
      .eq('user_id', user.id)
      .neq('topic', '__diagnostic__')
      .in('status', ['completed', 'abandoned'])
      .order('started_at', { ascending: false })
      .limit(5)
      .returns<
        Pick<SessionRow, 'id' | 'topic' | 'status' | 'started_at' | 'ended_at' | 'duration_sec'>[]
      >(),
  ]);

  const profile        = profileResult.data;
  const wordCount      = wordCountResult.data?.length ?? 0;
  const masteryRows    = masteryResult.data ?? [];
  const dailyCount     = dailyWordsResult.count ?? 0;
  const recentSessions = recentSessionsResult.data ?? [];

  // ── Onboarding gate ──────────────────────────────────────────────────────
  if (profile?.onboarding_completed === false) {
    redirect('/onboarding/diagnostic');
  }

  // ── Wave 2: credited evaluation counts for the recent sessions ───────────
  // Sequential — depends on session IDs from wave 1. Single query, no N+1.
  const creditedBySession = new Map<string, number>();
  const sessionIds = recentSessions.map((s) => s.id);

  if (sessionIds.length > 0) {
    const { data: evalsData } = await supabase
      .from('semantic_evaluations')
      .select('session_id')
      .in('session_id', sessionIds)
      .eq('credited', true)
      .returns<Pick<SemanticEvaluationRow, 'session_id'>[]>();

    (evalsData ?? []).forEach(({ session_id }) => {
      creditedBySession.set(session_id, (creditedBySession.get(session_id) ?? 0) + 1);
    });
  }

  // ── Mastery counts ────────────────────────────────────────────────────────
  const masteryCounts = VOCAB_STATES.reduce(
    (acc, { state }) => {
      acc[state] = masteryRows.filter((r) => r.state === state).length;
      return acc;
    },
    {} as Record<MasteryState, number>,
  );

  // needs_review is outside VOCAB_STATES — count it explicitly
  const reviewCount     = masteryRows.filter((r) => r.state === 'needs_review').length;
  const masteredCount   = masteryCounts.mastered ?? 0;
  const hasReviewWords  = reviewCount > 0;
  const practicingCount = (masteryCounts.practicing ?? 0) + reviewCount;
  const totalEvaluated  = masteryRows.length;

  // ── Daily goal ────────────────────────────────────────────────────────────
  const dailyPct = Math.min(100, Math.round((dailyCount / DAILY_GOAL) * 100));

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

      {/* ── Task 11.3: Due for Review alert ── */}
      {hasReviewWords && (
        <div
          className="mb-6 p-4 rounded flex items-center justify-between gap-4 animate-fade-up"
          style={{
            background: 'color-mix(in srgb, #F87171 8%, transparent)',
            border:     '1px solid color-mix(in srgb, #F87171 30%, transparent)',
          }}
        >
          <div>
            <p
              className="text-xs uppercase tracking-widest mb-0.5"
              style={{ fontFamily: 'var(--font-mono)', color: '#F87171' }}
            >
              Review Due
            </p>
            <p className="text-sm" style={{ color: 'var(--color-codex-text)' }}>
              {reviewCount} {reviewCount === 1 ? 'word needs' : 'words need'} attention
              before {reviewCount === 1 ? 'it fades' : 'they fade'}.
            </p>
          </div>
          <Link
            href="/review"
            className="btn-primary no-underline shrink-0"
            style={{ whiteSpace: 'nowrap' }}
          >
            Review Now →
          </Link>
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
          <h2 className="font-display text-2xl" style={{ color: 'var(--color-codex-text)' }}>
            Word Bank
          </h2>
          <p className="text-xs" style={{ color: 'var(--color-codex-muted)' }}>
            {wordCount} {wordCount === 1 ? 'word' : 'words'} saved
            {masteredCount > 0 && ` · ${masteredCount} mastered`}
          </p>
        </Link>

        {/* Practice card */}
        <Link href="/setup-session" className="card p-5 flex flex-col gap-2 group no-underline">
          <div className="flex items-center justify-between">
            <span
              className="category-tag"
              style={{
                background: 'color-mix(in srgb, var(--color-codex-gold) 15%, transparent)',
                color: 'var(--color-codex-gold)',
              }}
            >
              SESSION
            </span>
            <span
              className="text-xs group-hover:translate-x-0.5 transition-transform"
              style={{ color: 'var(--color-codex-muted)' }}
            >
              →
            </span>
          </div>
          <h2 className="font-display text-2xl" style={{ color: 'var(--color-codex-text)' }}>
            Begin Practice
          </h2>
          <p className="text-xs" style={{ color: 'var(--color-codex-muted)' }}>
            Choose a topic and start a voice session
          </p>
        </Link>
      </section>

      <div className="divider mb-6" />

      {/* ── Task 11.2: Daily Goal ── */}
      <section className="card p-5 mb-4 animate-fade-up animate-fade-up-delay-2">
        <div className="flex items-center justify-between mb-3">
          <p
            className="text-xs uppercase tracking-widest"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            Daily Goal
          </p>
          <span
            className="text-xs tabular-nums"
            style={{
              fontFamily: 'var(--font-mono)',
              color: dailyCount >= DAILY_GOAL
                ? 'var(--color-status-mastered)'
                : 'var(--color-codex-muted)',
            }}
          >
            {dailyCount} / {DAILY_GOAL} words
          </span>
        </div>
        <div
          className="h-2 w-full rounded-full overflow-hidden"
          style={{ background: 'var(--color-codex-surface-high)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width:      `${dailyPct}%`,
              background: dailyCount >= DAILY_GOAL
                ? 'var(--color-status-mastered)'
                : 'var(--color-codex-gold)',
            }}
          />
        </div>
        {dailyCount >= DAILY_GOAL && (
          <p
            className="text-xs mt-2"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-status-mastered)' }}
          >
            ✓ Goal reached today
          </p>
        )}
      </section>

      {/* ── Task 11.1: Vocabulary Status ── */}
      <section className="card p-5 mb-4 animate-fade-up animate-fade-up-delay-2">
        <p
          className="text-xs uppercase tracking-widest mb-5"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          Vocabulary Status
        </p>

        {totalEvaluated === 0 ? (
          <p
            className="text-sm"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
          >
            No mastery data yet — complete a session to start tracking.
          </p>
        ) : (
          <>
            {/* Stacked distribution bar across all states */}
            <div className="flex h-2 w-full rounded-full overflow-hidden mb-5">
              {VOCAB_STATES.map(({ state, color }) => {
                const count = masteryCounts[state] ?? 0;
                const pct   = (count / totalEvaluated) * 100;
                if (pct === 0) return null;
                return (
                  <div
                    key={state}
                    className="h-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: color }}
                  />
                );
              })}
              {/* needs_review segment */}
              {reviewCount > 0 && (
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width:      `${(reviewCount / totalEvaluated) * 100}%`,
                    background: '#F87171',
                  }}
                />
              )}
            </div>

            {/* Per-state rows */}
            <div className="flex flex-col gap-3">
              {VOCAB_STATES.map(({ state, label, color }) => {
                const count = masteryCounts[state] ?? 0;
                const pct   = (count / totalEvaluated) * 100;
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
            </div>

            <p
              className="text-xs mt-4"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
            >
              {totalEvaluated} of {wordCount} {wordCount !== 1 ? 'words' : 'word'} evaluated
              {practicingCount > 0 && ` · ${practicingCount} in active rotation`}
            </p>
          </>
        )}
      </section>

      {/* ── Task 11.4: Recent Sessions ── */}
      {recentSessions.length > 0 && (
        <section className="card p-5 mb-4 animate-fade-up animate-fade-up-delay-3">
          <p
            className="text-xs uppercase tracking-widest mb-4"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            Recent Sessions
          </p>
          <div className="flex flex-col">
            {recentSessions.map((session, i) => {
              const credited  = creditedBySession.get(session.id) ?? 0;
              const duration  = formatDuration(session.duration_sec, session.started_at, session.ended_at);
              const abandoned = session.status === 'abandoned';
              const isLast    = i === recentSessions.length - 1;
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between py-3"
                  style={isLast ? undefined : { borderBottom: '1px solid var(--color-codex-border)' }}
                >
                  <div className="flex flex-col gap-0.5">
                    <span
                      className="text-sm"
                      style={{
                        color: abandoned
                          ? 'var(--color-codex-muted)'
                          : 'var(--color-codex-text)',
                      }}
                    >
                      {formatTopic(session.topic)}
                    </span>
                    <span
                      className="text-xs"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
                    >
                      {duration}{abandoned && ' · ended early'}
                    </span>
                  </div>
                  <span
                    className="text-xs tabular-nums shrink-0"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: credited > 0
                        ? 'var(--color-codex-teal)'
                        : 'var(--color-codex-faint)',
                    }}
                  >
                    {credited > 0 ? `+${credited} words` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
