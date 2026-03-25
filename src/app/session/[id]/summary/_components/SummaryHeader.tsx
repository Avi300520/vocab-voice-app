'use client';

/**
 * src/app/session/[id]/summary/_components/SummaryHeader.tsx
 *
 * Displays session metadata: topic, status badge, turn count, duration, date.
 *
 * Client Component so we can auto-focus the heading on mount — essential for
 * screen reader users who arrive via a redirect from the live session.
 * Without this, focus stays on the body and the SR announces nothing useful.
 */

import { useEffect, useRef } from 'react';
import type { SessionRow } from '@/lib/supabase/types';

interface Props {
  session: SessionRow;
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return '—';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SummaryHeader({ session }: Props) {
  const isCompleted = session.status === 'completed';
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Auto-focus the heading on mount so screen readers announce the summary
  // immediately when the user is redirected here from the live session page.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <header className="animate-fade-up">
      {/* Status badge + date */}
      <div className="flex items-center gap-3 mb-3">
        <span
          className="category-tag"
          style={{
            background: isCompleted
              ? 'color-mix(in srgb, var(--color-status-mastered) 15%, transparent)'
              : 'color-mix(in srgb, var(--color-codex-muted) 15%, transparent)',
            color: isCompleted
              ? 'var(--color-status-mastered)'
              : 'var(--color-codex-muted)',
          }}
        >
          {isCompleted ? 'COMPLETED' : 'ENDED EARLY'}
        </span>
        <span
          className="text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
        >
          {formatDate(session.started_at)}
        </span>
      </div>

      {/* Topic — tabIndex={-1} allows programmatic focus without a visible tab stop */}
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-3xl md:text-4xl mb-4 focus:outline-none"
        style={{ color: 'var(--color-codex-text)' }}
      >
        {session.topic}
      </h1>

      {/* Stats row */}
      <div
        className="flex items-center gap-6 text-xs"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
      >
        <span>{session.turn_count} {session.turn_count === 1 ? 'turn' : 'turns'}</span>
        <span>{formatDuration(session.started_at, session.ended_at)}</span>
        {session.words_assigned > 0 && (
          <span>{session.words_used}/{session.words_assigned} words used</span>
        )}
      </div>
    </header>
  );
}
