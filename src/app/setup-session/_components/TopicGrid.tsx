'use client';

/**
 * src/app/setup-session/_components/TopicGrid.tsx
 *
 * Each topic card is a <form action={formAction}> with hidden inputs.
 * Form-action submissions are automatically enrolled in a React transition by
 * the framework — no manual startTransition call is required, and
 * useActionState's isPending updates correctly without the
 * "called outside of a transition" warning.
 */

import { useActionState, useState } from 'react';
import { createSession } from '@/app/actions/sessions';
import { TOPICS, CATEGORY_COLORS, type Topic } from '../_data/topics';

// ── Depth indicator (1–5 filled dots) ────────────────────────────────────────
function DepthIndicator({ depth }: { depth: Topic['depth'] }) {
  return (
    <div className="flex items-center gap-1" title={`Vocabulary depth: ${depth}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="inline-block w-2 h-2 rounded-full"
          style={{
            background:
              i < depth ? 'var(--color-codex-gold)' : 'var(--color-codex-border)',
          }}
        />
      ))}
    </div>
  );
}

// ── Loading overlay rendered on top of the active card ────────────────────────
function CardSpinner() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-black/40 gap-2">
      <span
        className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-t-transparent"
        style={{ borderColor: 'var(--color-codex-gold)', borderTopColor: 'transparent' }}
      />
      <span
        className="text-xs uppercase tracking-widest"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-gold)' }}
      >
        Preparing...
      </span>
    </div>
  );
}

// ── Topic card wrapped in its own form ────────────────────────────────────────
function TopicCard({
  topic,
  idx,
  formAction,
  isPending,
  isLoading,
  onSubmit,
}: {
  topic: Topic;
  idx: number;
  formAction: (payload: FormData) => void;
  isPending: boolean;
  isLoading: boolean;
  onSubmit: () => void;
}) {
  const colors = CATEGORY_COLORS[topic.category];

  return (
    <form action={formAction}>
      <input type="hidden" name="topic" value={topic.title} />
      <input type="hidden" name="topic_context" value={topic.context} />
      <button
        type="submit"
        disabled={isPending}
        onClick={onSubmit}
        className={`topic-card text-left w-full animate-fade-up${isLoading ? ' selected' : ''}`}
        style={{ animationDelay: `${idx * 0.03}s` }}
        aria-busy={isLoading}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-3">
          <span
            className="category-tag"
            style={{ background: colors.bg, color: colors.text }}
          >
            {topic.category}
          </span>
          <DepthIndicator depth={topic.depth} />
        </div>

        {/* ── Title ── */}
        <h3
          className="font-display text-xl leading-snug mb-2"
          style={{ color: 'var(--color-codex-text)' }}
        >
          {topic.title}
        </h3>

        {/* ── Description ── */}
        <p
          className="text-sm leading-relaxed line-clamp-3 mb-3"
          style={{ color: 'var(--color-codex-muted)' }}
        >
          {topic.description}
        </p>

        {/* ── Key terms ── */}
        <div className="flex flex-wrap gap-1.5">
          {topic.keyTerms.slice(0, 3).map((term) => (
            <span key={term} className="key-term">
              {term}
            </span>
          ))}
        </div>

        {/* ── Per-card loading overlay ── */}
        {isLoading && <CardSpinner />}
      </button>
    </form>
  );
}

// ── Main grid ─────────────────────────────────────────────────────────────────
export default function TopicGrid() {
  const [state, formAction, isPending] = useActionState(createSession, {
    error: null,
  });

  // Track which card was clicked so only that card shows the spinner.
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // Only show the spinner while the action is actually pending.
  const activeLoadingId = isPending ? loadingId : null;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Action error banner ── */}
      {state.error && (
        <div
          className="p-3 rounded text-sm"
          role="alert"
          style={{
            color: '#F87171',
            background: 'color-mix(in srgb, #F87171 8%, transparent)',
            border: '1px solid color-mix(in srgb, #F87171 22%, transparent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {state.error}
        </div>
      )}

      {/* ── Grid: 1 col → 2 col sm → 3 col lg ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOPICS.map((topic, idx) => (
          <TopicCard
            key={topic.id}
            topic={topic}
            idx={idx}
            formAction={formAction}
            isPending={isPending}
            isLoading={activeLoadingId === topic.id}
            onSubmit={() => !isPending && setLoadingId(topic.id)}
          />
        ))}
      </div>

      {/* ── Global pending hint ── */}
      {isPending && (
        <p
          className="text-center text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
        >
          Preparing your session...
        </p>
      )}
    </div>
  );
}
