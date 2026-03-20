/**
 * src/app/setup-session/page.tsx
 *
 * Protected Server Component — Session Setup / Topic Selection.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import CustomTopicForm from './_components/CustomTopicForm';
import TopicGrid from './_components/TopicGrid';

export default async function SetupSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
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
        className="text-sm leading-relaxed mb-6 max-w-xl animate-fade-up animate-fade-up-delay-1"
        style={{ color: 'var(--color-codex-muted)' }}
      >
        Pick a broad category below, or type any intellectual topic you want to
        explore — the AI will weave your target words naturally into the discussion.
      </p>

      {/* ── URL-level error banner (e.g. legacy redirects) ── */}
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

      {/* ── Custom topic input — prominent, top of page ── */}
      <CustomTopicForm />

      <div className="divider mb-6" />

      <p
        className="text-xs uppercase tracking-widest mb-4"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
      >
        — or choose a category
      </p>

      {/* ── Interactive topic grid (Client Component) ── */}
      <TopicGrid />
    </div>
  );
}
