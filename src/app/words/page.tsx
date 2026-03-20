/**
 * src/app/words/page.tsx
 *
 * Protected Server Component — Word Bank.
 * Fetches the user's words from Supabase and renders:
 *   - Stats strip (total / by status)
 *   - Add-word form (expandable, client component)
 *   - Word list (grid on md+, single column on mobile)
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { WordRow } from '@/lib/supabase/types';
import AddWordForm from './_components/AddWordForm';
import WordCard from './_components/WordCard';

export default async function WordsPage() {
  const supabase = await createClient();

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  // ── Fetch word bank (RLS: only the authenticated user's rows) ───────────────
  const { data: words, error: wordsError } = await supabase
    .from('words')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<WordRow[]>();

  const safeWords = words ?? [];

  // ── Compute status counts ────────────────────────────────────────────────────
  const counts = {
    new:        safeWords.filter((w) => w.status === 'new').length,
    practicing: safeWords.filter((w) => w.status === 'practicing').length,
    mastered:   safeWords.filter((w) => w.status === 'mastered').length,
  };

  return (
    <div
      className="min-h-dvh px-4 py-8 md:px-6 md:py-12 max-w-3xl mx-auto w-full"
      style={{ color: 'var(--color-codex-text)' }}
    >
      {/* ── Top navigation ── */}
      <nav className="flex items-center justify-between mb-10 animate-fade-up">
        <Link
          href="/dashboard"
          className="btn-ghost"
        >
          ← Dashboard
        </Link>
        <Link
          href="/setup-session"
          className="btn-primary"
        >
          Begin Session →
        </Link>
      </nav>

      {/* ── Page header ── */}
      <header className="mb-8 animate-fade-up">
        <p
          className="text-xs uppercase tracking-widest mb-2"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          VocabVoice / Lexicon
        </p>
        <h1
          className="font-display text-4xl md:text-5xl leading-tight"
          style={{ color: 'var(--color-codex-text)' }}
        >
          Your Word Bank
        </h1>
        <p
          className="text-base mt-2"
          style={{ color: 'var(--color-codex-muted)' }}
        >
          Track the vocabulary you're building session by session.
        </p>
      </header>

      {/* ── Stats strip ── */}
      <div
        className="grid grid-cols-4 gap-px mb-8 overflow-hidden rounded animate-fade-up animate-fade-up-delay-1"
        style={{ border: '1px solid var(--color-codex-border)' }}
      >
        {(
          [
            { label: 'Total',      value: safeWords.length, color: 'var(--color-codex-text)' },
            { label: 'New',        value: counts.new,        color: 'var(--color-status-new)' },
            { label: 'Practicing', value: counts.practicing, color: 'var(--color-status-practicing)' },
            { label: 'Mastered',   value: counts.mastered,   color: 'var(--color-status-mastered)' },
          ] as const
        ).map(({ label, value, color }) => (
          <div
            key={label}
            className="flex flex-col items-center justify-center py-4 px-2"
            style={{ background: 'var(--color-codex-surface)' }}
          >
            <span
              className="text-2xl md:text-3xl font-bold tabular-nums leading-none"
              style={{ fontFamily: 'var(--font-mono)', color }}
            >
              {value}
            </span>
            <span
              className="text-xs uppercase tracking-widest mt-1.5"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Add word form ── */}
      <section className="mb-8">
        <AddWordForm />
      </section>

      <div className="divider mb-8" />

      {/* ── Word list / empty state ── */}
      <section>
        {wordsError ? (
          <div
            className="rounded p-4 text-sm"
            style={{
              color: '#F87171',
              background: 'color-mix(in srgb, #F87171 8%, transparent)',
              border: '1px solid color-mix(in srgb, #F87171 20%, transparent)',
            }}
          >
            <p className="font-semibold">Failed to load words</p>
            <p className="mt-1 text-xs opacity-70">{wordsError.message}</p>
          </div>
        ) : safeWords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-up">
            <p
              className="font-display text-6xl mb-4 opacity-15"
              style={{ color: 'var(--color-codex-gold)' }}
            >
              ∅
            </p>
            <p
              className="font-display text-2xl mb-2"
              style={{ color: 'var(--color-codex-text)' }}
            >
              Your lexicon is empty
            </p>
            <p
              className="text-base max-w-sm"
              style={{ color: 'var(--color-codex-muted)' }}
            >
              Expand the form above to add your first word. Build your vocabulary one entry at a time.
            </p>
          </div>
        ) : (
          <>
            <p
              className="text-sm uppercase tracking-widest mb-5"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
            >
              {safeWords.length} {safeWords.length === 1 ? 'entry' : 'entries'} — most recent first
            </p>
            {/* Mobile: single column — md+: 2-column grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {safeWords.map((word) => (
                <WordCard key={word.id} word={word} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
