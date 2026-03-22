'use client';

/**
 * src/app/onboarding/diagnostic/_components/StartDiagnosticForm.tsx
 *
 * Client Component — form wrapper for startDiagnosticSession Server Action.
 * Shows a spinner during the action (session creation + redirect).
 */

import { useActionState } from 'react';
import { startDiagnosticSession } from '@/app/actions/onboarding';

export default function StartDiagnosticForm() {
  const [state, action, pending] = useActionState(startDiagnosticSession, { error: null });

  return (
    <form action={action} className="flex flex-col gap-3">
      {state?.error && (
        <p
          className="text-sm px-3 py-2 rounded"
          style={{
            color: '#F87171',
            background: 'color-mix(in srgb, #F87171 8%, transparent)',
            border: '1px solid color-mix(in srgb, #F87171 22%, transparent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ✗ {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn-primary flex items-center justify-center gap-2"
        style={{ height: '3rem', fontSize: '1rem' }}
      >
        {pending ? (
          <>
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <span>Starting…</span>
          </>
        ) : (
          'Begin Voice Assessment →'
        )}
      </button>
    </form>
  );
}
