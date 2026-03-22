'use client';

/**
 * src/app/session/[id]/_components/DetectionToast.tsx
 *
 * A transient overlay that slides in to show which target words
 * were detected after a voice turn. Auto-dismisses after 2.5s.
 */

import { useEffect, useState } from 'react';

interface Props {
  words: string[];
  onDismiss: () => void;
}

/** Duration the toast is fully visible before starting to fade out. */
const VISIBLE_MS = 2200;
/** Duration of the fade-out animation (must match CSS). */
const FADEOUT_MS = 300;

export default function DetectionToast({ words, onDismiss }: Props) {
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    const visibleTimer = setTimeout(() => setDismissing(true), VISIBLE_MS);
    const removeTimer  = setTimeout(onDismiss, VISIBLE_MS + FADEOUT_MS);
    return () => {
      clearTimeout(visibleTimer);
      clearTimeout(removeTimer);
    };
  }, [onDismiss]);

  return (
    <div
      className={`detection-toast ${dismissing ? 'dismissing' : ''}`}
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.875rem',
        borderRadius: '4px',
        background: 'color-mix(in srgb, var(--color-status-mastered) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-status-mastered) 30%, transparent)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-status-mastered)',
          flexShrink: 0,
        }}
      >
        ✓ Detected
      </span>
      <span
        style={{
          fontSize: '0.8rem',
          color: 'var(--color-codex-text)',
          fontWeight: 500,
        }}
      >
        {words.join(', ')}
      </span>
    </div>
  );
}
