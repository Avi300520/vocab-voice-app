/**
 * src/app/words/[wordId]/page.tsx
 *
 * Protected Server Component — Word Detail view.
 * Shows FSRS mastery metrics and the full semantic evaluation history
 * for a single word, so the learner can see exactly how they've used it.
 */

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type {
  WordRow,
  WordMasteryRow,
  SemanticEvaluationRow,
  EvaluationLabel,
} from '@/lib/supabase/types';

// ── Label metadata ────────────────────────────────────────────────────────────

const LABEL_META: Record<EvaluationLabel, { label: string; color: string; bg: string }> = {
  used_correct:           { label: 'Used correctly',         color: '#22D8A4', bg: 'color-mix(in srgb, #22D8A4 12%, transparent)' },
  used_partially_correct: { label: 'Used partially',         color: '#F4A922', bg: 'color-mix(in srgb, #F4A922 12%, transparent)' },
  used_incorrect:         { label: 'Used incorrectly',       color: '#F87171', bg: 'color-mix(in srgb, #F87171 12%, transparent)' },
  mentioned_not_used:     { label: 'Mentioned, not used',    color: '#7A9AB8', bg: 'color-mix(in srgb, #7A9AB8 10%, transparent)' },
  not_used_false_positive:{ label: 'False positive',         color: '#7A9AB8', bg: 'color-mix(in srgb, #7A9AB8 10%, transparent)' },
  ambiguous:              { label: 'Ambiguous',              color: '#7A9AB8', bg: 'color-mix(in srgb, #7A9AB8 10%, transparent)' },
};

const MASTERY_META: Record<string, { label: string; color: string }> = {
  passive:      { label: 'Passive',      color: 'var(--color-codex-muted)' },
  practicing:   { label: 'Practicing',   color: 'var(--color-codex-gold)' },
  stable:       { label: 'Stable',       color: 'var(--color-codex-teal)' },
  mastered:     { label: 'Mastered',     color: 'var(--color-status-mastered)' },
  needs_review: { label: 'Needs Review', color: '#F87171' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function stabilityLabel(stability: number): string {
  if (stability >= 15) return 'Mastered';
  if (stability >= 7)  return 'Stable';
  if (stability >= 2)  return 'Practicing';
  return 'Passive';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MasteryPanel({ mastery }: { mastery: WordMasteryRow }) {
  const meta = MASTERY_META[mastery.state] ?? MASTERY_META.passive;
  const stabilityPct = Math.min(100, (mastery.stability / 20) * 100);
  const difficultyPct = mastery.difficulty * 100;
  const total = mastery.success_count + mastery.fail_count;
  const successRate = total > 0 ? Math.round((mastery.success_count / total) * 100) : null;

  return (
    <section className="card p-5 animate-fade-up animate-fade-up-delay-1">
      <p
        className="text-xs uppercase tracking-widest mb-4"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
      >
        FSRS Mastery State
      </p>

      {/* State badge */}
      <div className="flex items-center gap-3 mb-5">
        <span
          className="category-tag"
          style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)` }}
        >
          {meta.label}
        </span>
        {mastery.next_review_at && (
          <span
            className="text-xs"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
          >
            Next review: {formatDate(mastery.next_review_at)}
          </span>
        )}
      </div>

      {/* Stability bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span
            className="text-xs uppercase tracking-widest"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            Stability
          </span>
          <span
            className="text-xs"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-text)' }}
          >
            {mastery.stability.toFixed(1)} — {stabilityLabel(mastery.stability)}
          </span>
        </div>
        <div
          className="h-1.5 w-full rounded-full overflow-hidden"
          style={{ background: 'var(--color-codex-surface-high)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${stabilityPct}%`,
              background: 'var(--color-status-mastered)',
            }}
          />
        </div>
      </div>

      {/* Difficulty bar */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-1">
          <span
            className="text-xs uppercase tracking-widest"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            Difficulty
          </span>
          <span
            className="text-xs"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-text)' }}
          >
            {(mastery.difficulty * 100).toFixed(0)}%
          </span>
        </div>
        <div
          className="h-1.5 w-full rounded-full overflow-hidden"
          style={{ background: 'var(--color-codex-surface-high)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${difficultyPct}%`,
              background: 'var(--color-codex-gold)',
            }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div
        className="grid grid-cols-3 gap-4 text-center pt-4"
        style={{ borderTop: '1px solid var(--color-codex-border)' }}
      >
        {[
          { label: 'Credited',   value: mastery.success_count },
          { label: 'Missed',     value: mastery.fail_count },
          { label: 'Hit rate',   value: successRate !== null ? `${successRate}%` : '—' },
        ].map(({ label, value }) => (
          <div key={label}>
            <p
              className="text-xl font-bold tabular-nums"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-text)' }}
            >
              {value}
            </p>
            <p
              className="text-xs uppercase tracking-widest mt-0.5"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
            >
              {label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceCard({
  evaluation,
  sessionTopic,
}: {
  evaluation: SemanticEvaluationRow;
  sessionTopic: string;
}) {
  const meta = LABEL_META[evaluation.label] ?? LABEL_META.ambiguous;

  return (
    <article
      className="card p-4 flex flex-col gap-3 animate-fade-up"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p
            className="text-xs uppercase tracking-widest mb-0.5"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            Turn {evaluation.turn_index} · {formatDate(evaluation.created_at)}
          </p>
          <p
            className="text-xs"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
          >
            Topic: {sessionTopic}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="category-tag text-xs"
            style={{ color: meta.color, background: meta.bg, border: `1px solid color-mix(in srgb, ${meta.color} 28%, transparent)` }}
          >
            {meta.label}
          </span>
          {evaluation.credited && (
            <span
              className="text-xs"
              style={{ color: 'var(--color-status-mastered)', fontFamily: 'var(--font-mono)' }}
            >
              ✓ Credited
            </span>
          )}
        </div>
      </div>

      {/* Evidence */}
      {evaluation.evidence_used && (
        <blockquote
          className="text-sm leading-relaxed italic px-3 py-2 rounded"
          style={{
            color: 'var(--color-codex-text)',
            fontFamily: 'var(--font-display)',
            background: 'color-mix(in srgb, var(--color-codex-gold) 5%, transparent)',
            borderLeft: '2px solid color-mix(in srgb, var(--color-codex-gold) 40%, transparent)',
          }}
        >
          "{evaluation.evidence_used}"
        </blockquote>
      )}

      {/* Diagnostic */}
      {evaluation.diagnostic && (
        <p className="text-sm" style={{ color: 'var(--color-codex-muted)' }}>
          {evaluation.diagnostic}
        </p>
      )}

      {/* Learner feedback */}
      {evaluation.learner_feedback && (
        <p
          className="text-xs px-2 py-1.5 rounded"
          style={{
            color: 'var(--color-codex-teal)',
            background: 'color-mix(in srgb, var(--color-codex-teal) 8%, transparent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          💡 {evaluation.learner_feedback}
        </p>
      )}

      {/* Confidence */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs uppercase tracking-widest"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
        >
          Confidence
        </span>
        <div
          className="flex-1 h-1 rounded-full overflow-hidden"
          style={{ background: 'var(--color-codex-surface-high)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.round(evaluation.confidence_score * 100)}%`,
              background: meta.color,
            }}
          />
        </div>
        <span
          className="text-xs tabular-nums"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
        >
          {Math.round(evaluation.confidence_score * 100)}%
        </span>
      </div>
    </article>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function WordDetailPage({
  params,
}: {
  params: Promise<{ wordId: string }>;
}) {
  const supabase = await createClient();
  const { wordId } = await params;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  // ── Parallel fetch: word + mastery + evaluations ───────────────────────────
  const [wordRes, masteryRes, evalsRes] = await Promise.all([
    supabase
      .from('words')
      .select('*')
      .eq('id', wordId)
      .eq('user_id', user.id)
      .single<WordRow>(),

    supabase
      .from('word_mastery')
      .select('*')
      .eq('word_id', wordId)
      .eq('user_id', user.id)
      .single<WordMasteryRow>(),

    supabase
      .from('semantic_evaluations')
      .select('*, sessions(topic)')
      .eq('word_id', wordId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .returns<(SemanticEvaluationRow & { sessions: { topic: string } | null })[]>(),
  ]);

  if (wordRes.error || !wordRes.data) notFound();

  const word        = wordRes.data;
  const mastery     = masteryRes.data ?? null;
  const evaluations = evalsRes.data ?? [];

  const statusMeta = {
    new:        { label: 'New',        color: 'var(--color-status-new)' },
    practicing: { label: 'Practicing', color: 'var(--color-status-practicing)' },
    mastered:   { label: 'Mastered',   color: 'var(--color-status-mastered)' },
  }[word.status];

  return (
    <div
      className="min-h-dvh px-4 py-8 md:px-6 md:py-12 max-w-2xl mx-auto w-full"
      style={{ color: 'var(--color-codex-text)' }}
    >
      {/* ── Nav ── */}
      <nav className="flex items-center gap-3 mb-10 animate-fade-up">
        <Link href="/words" className="btn-ghost">
          ← Word Bank
        </Link>
      </nav>

      {/* ── Word header ── */}
      <header className="mb-8 animate-fade-up">
        <p
          className="text-xs uppercase tracking-widest mb-2"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          VocabVoice / Lexicon / Detail
        </p>
        <div className="flex items-start gap-4 flex-wrap">
          <h1
            className="font-display text-5xl md:text-6xl leading-none"
            style={{ color: 'var(--color-codex-text)' }}
          >
            {word.word}
          </h1>
          <span
            className="category-tag mt-2"
            style={{ color: statusMeta.color, background: `color-mix(in srgb, ${statusMeta.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${statusMeta.color} 28%, transparent)` }}
          >
            {statusMeta.label}
          </span>
        </div>

        {word.definition && (
          <p
            className="text-base leading-relaxed mt-4 max-w-prose"
            style={{ color: 'var(--color-codex-muted)' }}
          >
            {word.definition}
          </p>
        )}

        {word.example && (
          <p
            className="text-sm italic mt-3 max-w-prose"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-codex-faint)' }}
          >
            "{word.example}"
          </p>
        )}

        <div
          className="flex items-center gap-4 mt-4 text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
        >
          <span>Added {formatDate(word.created_at)}</span>
          <span>Used in {word.times_used} session{word.times_used !== 1 ? 's' : ''}</span>
        </div>
      </header>

      <div className="divider mb-8" />

      {/* ── Mastery panel ── */}
      {mastery ? (
        <MasteryPanel mastery={mastery} />
      ) : (
        <section
          className="card p-5 mb-6 animate-fade-up animate-fade-up-delay-1"
        >
          <p
            className="text-xs uppercase tracking-widest mb-2"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            FSRS Mastery State
          </p>
          <p
            className="text-sm"
            style={{ color: 'var(--color-codex-faint)', fontFamily: 'var(--font-mono)' }}
          >
            No mastery data yet — use this word in a session to start tracking.
          </p>
        </section>
      )}

      <div className="divider my-8" />

      {/* ── Evidence history ── */}
      <section className="animate-fade-up animate-fade-up-delay-2">
        <p
          className="text-xs uppercase tracking-widest mb-4"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          Usage History · {evaluations.length} evaluation{evaluations.length !== 1 ? 's' : ''}
        </p>

        {evaluations.length === 0 ? (
          <div
            className="rounded p-6 text-center"
            style={{ background: 'var(--color-codex-surface)', border: '1px solid var(--color-codex-border)' }}
          >
            <p className="text-sm" style={{ color: 'var(--color-codex-faint)', fontFamily: 'var(--font-mono)' }}>
              No evaluations yet.
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--color-codex-faint)' }}>
              Use this word in a voice session — the AI will evaluate how you used it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {evaluations.map((evaluation) => (
              <EvidenceCard
                key={evaluation.id}
                evaluation={evaluation}
                sessionTopic={evaluation.sessions?.topic ?? 'Unknown session'}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
