/**
 * src/app/setup-session/page.tsx
 *
 * Protected Server Component — Session Setup / Topic Selection.
 * Renders the curated intellectual topic grid.
 * Actual session creation is handled by the createSession Server Action.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import TopicGrid from './_components/TopicGrid';

export default async function SetupSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const params   = await searchParams;

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  return (
    <div
      className="min-h-dvh px-4 py-8 md:px-6 md:py-10 max-w-5xl mx-auto w-full"
      style={{ color: 'var(--color-codex-text)' }}
    >
      {/* ── Top navigation ── */}
      <nav className="flex items-center justify-between mb-8 animate-fade-up">
        <Link href="/dashboard" className="btn-ghost">
          ← Dashboard
        </Link>
        <Link href="/words" className="btn-ghost">
          ✦ Word Bank
        </Link>
      </nav>

      {/* ── Page header ── */}
      <header className="mb-2 animate-fade-up">
        <p
          className="text-xs uppercase tracking-widest mb-1"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          VocabVoice / Session
        </p>
        <h1
          className="font-display text-4xl md:text-5xl leading-tight"
          style={{ color: 'var(--color-codex-text)' }}
        >
          Choose Your Topic
        </h1>
      </header>

      {/* ── Subtitle ── */}
      <p
        className="text-sm leading-relaxed mb-2 max-w-xl animate-fade-up animate-fade-up-delay-1"
        style={{ color: 'var(--color-codex-muted)' }}
      >
        Every topic is chosen for analytical depth. Select one that will stretch
        your vocabulary — the AI will weave your target words naturally into the discourse.
      </p>

      {/* ── "No small talk" notice ── */}
      <div
        className="inline-flex items-center gap-2 px-3 py-1.5 mb-8 rounded-sm animate-fade-up animate-fade-up-delay-2"
        style={{
          background: 'color-mix(in srgb, var(--color-codex-gold) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-codex-gold) 20%, transparent)',
        }}
      >
        <span
          className="text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-gold)' }}
        >
          ⊘ &nbsp;No ordering coffee. No tourist directions. No weather chitchat.
        </span>
      </div>

      {/* ── Error banner ── */}
      {params.error && (
        <div
          className="mb-6 p-3 rounded text-sm animate-fade-up"
          style={{
            color: '#F87171',
            background: 'color-mix(in srgb, #F87171 8%, transparent)',
            border: '1px solid color-mix(in srgb, #F87171 22%, transparent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ✗ {decodeURIComponent(params.error)}
        </div>
      )}

      <div className="divider mb-8" />

      {/* ── Interactive topic grid (Client Component) ── */}
      <TopicGrid />
    </div>
  );
}
