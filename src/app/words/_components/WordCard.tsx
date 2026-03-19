'use client';

/**
 * src/app/words/_components/WordCard.tsx
 *
 * Client Component — renders a single word entry.
 * Delete is handled via a bound Server Action form submission.
 * useFormStatus provides the pending state to disable the button during deletion.
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

  const label =
    status === 'new'        ? '○ New'        :
    status === 'practicing' ? '◑ Practicing' :
                              '● Mastered';

  return (
    <span
      className={`${cls} category-tag`}
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {label}
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
      {pending ? '…' : '✕ Remove'}
    </button>
  );
}

// ── Main card component ───────────────────────────────────────────────────────
export default function WordCard({ word }: { word: WordRow }) {
  const deleteWithId = deleteWord.bind(null, word.id);

  return (
    <article className="card p-4 flex flex-col gap-2 animate-fade-up">
      {/* ── Top row: word + status badge ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3
          className="font-display text-xl leading-tight"
          style={{ color: 'var(--color-codex-text)' }}
        >
          {word.word}
        </h3>
        <StatusBadge status={word.status} />
      </div>

      {/* ── Definition ── */}
      {word.definition && (
        <p
          className="text-sm leading-relaxed"
          style={{ color: 'var(--color-codex-muted)' }}
        >
          {word.definition}
        </p>
      )}

      {/* ── Notes ── */}
      {word.notes && (
        <p
          className="text-xs italic"
          style={{
            color: 'var(--color-codex-faint)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {word.notes}
        </p>
      )}

      {/* ── Footer: metadata + delete action ── */}
      <div
        className="flex items-center justify-between pt-2 mt-auto"
        style={{
          borderTop: '1px solid var(--color-codex-border)',
        }}
      >
        <div
          className="flex items-center gap-3 text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
        >
          <span title="Times used in sessions">↺ {word.times_used}×</span>
          <span title="Times shown">◈ {word.times_shown}</span>
          {word.tags.length > 0 && (
            <span title="Tags">
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
