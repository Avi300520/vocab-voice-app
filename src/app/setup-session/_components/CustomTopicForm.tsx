'use client';

/**
 * src/app/setup-session/_components/CustomTopicForm.tsx
 *
 * Prominent custom-topic input at the top of the setup page.
 * Uses useActionState so the server action's redirect and error return values
 * are both handled correctly by the framework.
 */

import { useActionState } from 'react';
import { createSession } from '@/app/actions/sessions';

export default function CustomTopicForm() {
  const [state, formAction, isPending] = useActionState(createSession, {
    error: null,
  });

  return (
    <div
      className="rounded-xl p-5 mb-6 animate-fade-up"
      style={{
        background: 'var(--color-codex-surface)',
        border: '1px solid color-mix(in srgb, var(--color-codex-gold) 35%, var(--color-codex-border))',
      }}
    >
      {/* ── Label ── */}
      <p
        className="text-xs uppercase tracking-widest mb-3"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-gold)' }}
      >
        ✦ &nbsp;Your own topic
      </p>

      {/* ── Form ── */}
      <form action={formAction} className="flex flex-col sm:flex-row gap-3">
        {/* topic_context mirrors the topic for custom entries */}
        <input type="hidden" name="topic_context" value="" />

        <input
          type="text"
          name="topic"
          className="field flex-1 text-base"
          placeholder="e.g. The geopolitics of rare-earth minerals…"
          maxLength={200}
          required
          disabled={isPending}
          autoComplete="off"
        />

        <button
          type="submit"
          disabled={isPending}
          className="btn-primary shrink-0"
          style={{
            padding: '0.75rem 1.5rem',
            fontSize: '0.78rem',
            letterSpacing: '0.12em',
            minWidth: '10rem',
          }}
        >
          {isPending ? (
            <span className="flex items-center justify-center gap-2">
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent"
              />
              Starting…
            </span>
          ) : (
            <>▶&nbsp;&nbsp;Start Session</>
          )}
        </button>
      </form>

      {/* ── Error feedback ── */}
      {state.error && (
        <p
          className="mt-3 text-sm"
          role="alert"
          style={{ fontFamily: 'var(--font-mono)', color: '#F87171' }}
        >
          ✗ &nbsp;{state.error}
        </p>
      )}
    </div>
  );
}
