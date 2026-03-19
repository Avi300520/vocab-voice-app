'use client';

/**
 * src/app/setup-session/_components/TopicGrid.tsx
 *
 * Client Component — interactive topic selection grid.
 * Manages selected topic state locally; submits to the createSession
 * Server Action via a hidden form when "Begin Session" is clicked.
 */

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createSession } from '@/app/actions/sessions';
import { TOPICS, CATEGORY_COLORS, type Topic } from '../_data/topics';

// ── Depth indicator (1–5 filled dots) ────────────────────────────────────────
function DepthIndicator({ depth }: { depth: Topic['depth'] }) {
  return (
    <div className="flex items-center gap-0.5" title={`Vocabulary depth: ${depth}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{
            background: i < depth
              ? 'var(--color-codex-gold)'
              : 'var(--color-codex-border)',
          }}
        />
      ))}
    </div>
  );
}

// ── Begin session submit button ───────────────────────────────────────────────
function BeginButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-primary w-full"
      disabled={disabled || pending}
      style={{ padding: '0.875rem', fontSize: '0.75rem', letterSpacing: '0.14em' }}
    >
      {pending ? (
        <>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
          Creating Session…
        </>
      ) : (
        '▶  Begin Voice Session'
      )}
    </button>
  );
}

// ── Main grid component ───────────────────────────────────────────────────────
export default function TopicGrid() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customTopic, setCustomTopic] = useState('');

  const selected = TOPICS.find((t) => t.id === selectedId) ?? null;
  const effectiveTopic   = selectedId === '__custom__' ? customTopic.trim() : selected?.title   ?? '';
  const effectiveContext = selectedId === '__custom__' ? customTopic.trim() : selected?.context ?? '';
  const canBegin = effectiveTopic.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Topic grid: 1 col mobile → 2 col sm → 3 col lg ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {TOPICS.map((topic, idx) => {
          const isSelected = selectedId === topic.id;
          const colors = CATEGORY_COLORS[topic.category];

          return (
            <button
              key={topic.id}
              type="button"
              onClick={() => setSelectedId(isSelected ? null : topic.id)}
              className={`topic-card text-left${isSelected ? ' selected' : ''} animate-fade-up`}
              style={{ animationDelay: `${idx * 0.04}s` }}
              aria-pressed={isSelected}
            >
              {/* ── Card header: category + depth ── */}
              <div className="flex items-center justify-between mb-2.5">
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
                className="font-display text-lg leading-snug mb-2"
                style={{ color: 'var(--color-codex-text)' }}
              >
                {topic.title}
              </h3>

              {/* ── Description ── */}
              <p
                className="text-xs leading-relaxed line-clamp-3"
                style={{ color: 'var(--color-codex-muted)' }}
              >
                {topic.description}
              </p>

              {/* ── Key terms ── */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {topic.keyTerms.slice(0, 3).map((term) => (
                  <span
                    key={term}
                    className="text-xs px-1.5 py-0.5 rounded-sm"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.55rem',
                      color: 'var(--color-codex-faint)',
                      background: 'var(--color-codex-bg)',
                      border: '1px solid var(--color-codex-border)',
                    }}
                  >
                    {term}
                  </span>
                ))}
              </div>

              {/* ── Selection checkmark ── */}
              {isSelected && (
                <div
                  className="absolute top-3 right-3 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold"
                  style={{
                    background: 'var(--color-codex-gold)',
                    color: 'var(--color-codex-bg)',
                  }}
                >
                  ✓
                </div>
              )}
            </button>
          );
        })}

        {/* ── Custom topic card ── */}
        <button
          type="button"
          onClick={() => setSelectedId(selectedId === '__custom__' ? null : '__custom__')}
          className={`topic-card text-left${selectedId === '__custom__' ? ' selected' : ''} animate-fade-up`}
          style={{ animationDelay: `${TOPICS.length * 0.04}s` }}
          aria-pressed={selectedId === '__custom__'}
        >
          <div className="flex items-center justify-between mb-2.5">
            <span
              className="category-tag"
              style={{
                background: 'color-mix(in srgb, var(--color-codex-text) 10%, transparent)',
                color: 'var(--color-codex-text)',
              }}
            >
              CUSTOM
            </span>
          </div>
          <h3
            className="font-display text-lg leading-snug mb-2"
            style={{ color: 'var(--color-codex-text)' }}
          >
            Define Your Own Topic
          </h3>
          <p
            className="text-xs leading-relaxed"
            style={{ color: 'var(--color-codex-muted)' }}
          >
            Any subject that demands analytical depth and advanced vocabulary. Enter your topic below.
          </p>
          {selectedId === '__custom__' && (
            <div
              className="absolute top-3 right-3 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold"
              style={{
                background: 'var(--color-codex-gold)',
                color: 'var(--color-codex-bg)',
              }}
            >
              ✓
            </div>
          )}
        </button>
      </div>

      {/* ── Custom topic input ── */}
      {selectedId === '__custom__' && (
        <div className="card p-4 animate-fade-up">
          <label
            htmlFor="custom-topic"
            className="block text-xs uppercase tracking-widest mb-2"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            Your Topic
          </label>
          <input
            id="custom-topic"
            type="text"
            className="field"
            placeholder="e.g. The neuroscience of working memory consolidation…"
            value={customTopic}
            onChange={(e) => setCustomTopic(e.target.value)}
            autoFocus
            maxLength={200}
          />
        </div>
      )}

      {/* ── Selection summary ── */}
      {selected && selectedId !== '__custom__' && (
        <div
          className="card p-4 animate-fade-up"
          style={{ borderColor: 'color-mix(in srgb, var(--color-codex-gold) 40%, var(--color-codex-border))' }}
        >
          <p
            className="text-xs uppercase tracking-widest mb-1"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-gold)' }}
          >
            Selected Topic
          </p>
          <p
            className="font-display text-xl"
            style={{ color: 'var(--color-codex-text)' }}
          >
            {selected.title}
          </p>
          <p
            className="text-xs mt-1.5 flex flex-wrap gap-1.5"
            style={{ color: 'var(--color-codex-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {selected.keyTerms.map((t) => (
              <span key={t}>· {t}</span>
            ))}
          </p>
        </div>
      )}

      {/* ── Hidden form: submits to createSession server action ── */}
      <form action={createSession} className="flex flex-col gap-3">
        <input type="hidden" name="topic"         value={effectiveTopic} />
        <input type="hidden" name="topic_context" value={effectiveContext} />
        <BeginButton disabled={!canBegin} />
        {!canBegin && (
          <p
            className="text-center text-xs"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
          >
            ↑ Select a topic above to continue
          </p>
        )}
      </form>
    </div>
  );
}
