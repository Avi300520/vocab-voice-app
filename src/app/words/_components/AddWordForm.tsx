'use client';

/**
 * src/app/words/_components/AddWordForm.tsx
 *
 * Client Component — expandable form to add a new word to the word bank.
 * Uses React 19 useActionState for inline feedback without page reload.
 */

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { addWord, type WordActionState } from '@/app/actions/words';

// ── Submit button reads pending state from form context ───────────────────────
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? (
        <>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
          Adding…
        </>
      ) : (
        '+ Add Word'
      )}
    </button>
  );
}

// ── Main form component ────────────────────────────────────────────────────────
export default function AddWordForm() {
  const [state, formAction] = useActionState<WordActionState, FormData>(
    addWord,
    null,
  );
  const [expanded, setExpanded] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);

  // Reset form fields and collapse on successful add
  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      setExpanded(false);
    }
  }, [state]);

  // Auto-focus word field when form expands
  useEffect(() => {
    if (expanded) {
      setTimeout(() => wordInputRef.current?.focus(), 50);
    }
  }, [expanded]);

  return (
    <div className="card p-4 md:p-5 animate-fade-up animate-fade-up-delay-1">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between">
        <div>
          <p
            className="text-xs uppercase tracking-widest"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            Word Bank
          </p>
          <h2
            className="font-display text-2xl md:text-3xl mt-0.5"
            style={{ color: 'var(--color-codex-text)' }}
          >
            Add New Word
          </h2>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse form' : 'Expand form'}
        >
          {expanded ? '↑ Collapse' : '+ Expand'}
        </button>
      </div>

      {/* ── Expandable form ── */}
      {expanded && (
        <form
          ref={formRef}
          action={formAction}
          className="mt-4 flex flex-col gap-3"
          noValidate
        >
          {/* ── Word (required) ── */}
          <div>
            <label
              htmlFor="word"
              className="block text-xs uppercase tracking-widest mb-1.5"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
            >
              Word <span style={{ color: 'var(--color-codex-gold)' }}>*</span>
            </label>
            <input
              ref={wordInputRef}
              id="word"
              name="word"
              type="text"
              className="field"
              placeholder="e.g. sycophant, ephemeral, perfidious…"
              autoComplete="off"
              maxLength={100}
              required
            />
          </div>

          {/* ── Definition + Notes — stacked on mobile, side-by-side on md+ ── */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <label
                htmlFor="definition"
                className="block text-xs uppercase tracking-widest mb-1.5"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
              >
                Definition <span style={{ color: 'var(--color-codex-faint)' }}>(optional)</span>
              </label>
              <input
                id="definition"
                name="definition"
                type="text"
                className="field"
                placeholder="Brief meaning…"
                autoComplete="off"
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor="notes"
                className="block text-xs uppercase tracking-widest mb-1.5"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
              >
                Notes <span style={{ color: 'var(--color-codex-faint)' }}>(optional)</span>
              </label>
              <input
                id="notes"
                name="notes"
                type="text"
                className="field"
                placeholder="Memory aid, context…"
                autoComplete="off"
              />
            </div>
          </div>

          {/* ── Error feedback ── */}
          {state?.error && (
            <p
              className="text-xs px-3 py-2 rounded"
              style={{
                color: '#F87171',
                background: 'color-mix(in srgb, #F87171 10%, transparent)',
                border: '1px solid color-mix(in srgb, #F87171 25%, transparent)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              ✗ {state.error}
            </p>
          )}

          {/* ── Success flash ── */}
          {state?.success && state.word && (
            <p
              className="text-xs px-3 py-2 rounded"
              style={{
                color: 'var(--color-status-mastered)',
                background: 'color-mix(in srgb, var(--color-status-mastered) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-status-mastered) 25%, transparent)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              ✓ &ldquo;{state.word}&rdquo; added to your bank
            </p>
          )}

          {/* ── Actions ── */}
          <div className="flex items-center gap-3 pt-1">
            <SubmitButton />
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { formRef.current?.reset(); setExpanded(false); }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
