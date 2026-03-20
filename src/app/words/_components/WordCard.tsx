'use client';

/**
 * src/app/words/_components/WordCard.tsx
 *
 * Client Component — renders a single word entry as a polished card.
 * Delete is handled via a bound Server Action form submission.
 */

import { useFormStatus } from 'react-dom';
import { deleteWord } from '@/app/actions/words';
import type { WordRow } from '@/lib/supabase/types';

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: WordRow['status'] }) {
  const cls =
    status === 'new'        ? 'badge-new'        :
    status === 'practicing' ? 'badge-practicing' :
                              'badge-mastered';

  const icon =
    status === 'new'        ? '○' :
    status === 'practicing' ? '◑' :
                              '●';

  const label =
    status === 'new'        ? 'New'        :
    status === 'practicing' ? 'Practicing' :
                              'Mastered';

  return (
    <span className={`${cls} category-tag flex items-center gap-1`}>
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

// ── Delete button reads pending state from form context ───────────────────────
function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-danger"
      disabled={pending}
      aria-label="Delete word"
    >
      {pending ? (
        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
      ) : (
        '✕'
      )}
      <span>{pending ? 'Removing…' : 'Remove'}</span>
    </button>
  );
}

// ── Main card component ───────────────────────────────────────────────────────
export default function WordCard({ word }: { word: WordRow }) {
  const deleteWithId = deleteWord.bind(null, word.id);

  return (
    <article className="card p-5 flex flex-col gap-3 animate-fade-up group">
      {/* ── Top row: word + status badge ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3
          className="font-display text-2xl leading-tight"
          style={{ color: 'var(--color-codex-text)' }}
        >
          {word.word}
        </h3>
        <StatusBadge status={word.status} />
      </div>

      {/* ── Definition ── */}
      {word.definition ? (
        <p
          className="text-sm leading-relaxed"
          style={{ color: 'var(--color-codex-text)', opacity: 0.85 }}
        >
          {word.definition}
        </p>
      ) : (
        <p
          className="text-sm italic"
          style={{ color: 'var(--color-codex-faint)' }}
        >
          No definition added
        </p>
      )}

      {/* ── Notes ── */}
      {word.notes && (
        <p
          className="text-sm italic px-3 py-2 rounded"
          style={{
            color: 'var(--color-codex-muted)',
            fontFamily: 'var(--font-display)',
            background: 'color-mix(in srgb, var(--color-codex-gold) 5%, transparent)',
            borderLeft: '2px solid color-mix(in srgb, var(--color-codex-gold) 40%, transparent)',
          }}
        >
          {word.notes}
        </p>
      )}

      {/* ── Footer: metadata + delete action ── */}
      <div
        className="flex items-center justify-between pt-3 mt-auto"
        style={{ borderTop: '1px solid var(--color-codex-border)' }}
      >
        <div
          className="flex items-center gap-3 text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
        >
          <span title="Times used in sessions" className="flex items-center gap-1">
            <span style={{ color: 'var(--color-codex-muted)' }}>↺</span>
            {word.times_used}×
          </span>
          <span title="Times shown" className="flex items-center gap-1">
            <span style={{ color: 'var(--color-codex-muted)' }}>◈</span>
            {word.times_shown}
          </span>
          {word.tags.length > 0 && (
            <span title="Tags" style={{ color: 'var(--color-codex-muted)' }}>
              #{word.tags.slice(0, 2).join(' #')}
            </span>
          )}
        </div>

        <form action={deleteWithId}>
          <DeleteButton />
        </form>
      </div>
    </article>
  );
}
