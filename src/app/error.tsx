'use client';

/**
 * src/app/error.tsx
 *
 * Root-level error boundary for the App Router.
 * Automatically captures unhandled exceptions to Sentry before
 * presenting a recovery UI to the user.
 *
 * Must be a Client Component — React error boundaries require it.
 */

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main
      className="min-h-dvh flex flex-col items-center justify-center px-4"
      style={{ color: 'var(--color-codex-text)' }}
    >
      <p
        className="text-xs uppercase tracking-widest mb-2"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
      >
        Unexpected Error
      </p>
      <h1
        className="font-display text-3xl mb-4"
        style={{ color: 'var(--color-codex-text)' }}
      >
        Something went wrong.
      </h1>
      {error.digest && (
        <p
          className="text-xs mb-6"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
        >
          Error ID: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        className="btn-primary"
      >
        Try again
      </button>
    </main>
  );
}
