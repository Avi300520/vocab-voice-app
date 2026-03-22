/**
 * src/app/dashboard/page.tsx
 *
 * Protected dashboard — Server Component.
 * Navigation hub for Word Bank and Session practice.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/app/actions/auth';
import type { ProfileRow, WordRow } from '@/lib/supabase/types';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; ended?: string }>;
}) {
  const supabase = await createClient();
  const params   = await searchParams;

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  // ── Fetch profile + word count in parallel ──────────────────────────────────
  const [profileResult, wordCountResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single<ProfileRow>(),
    supabase.from('words').select('id, status').returns<Pick<WordRow, 'id' | 'status'>[]>(),
  ]);

  const profile   = profileResult.data;
  const wordCount = wordCountResult.data?.length ?? 0;
  const mastered  = wordCountResult.data?.filter((w) => w.status === 'mastered').length ?? 0;

  return (
    <main
      className="min-h-dvh px-4 py-8 md:px-6 md:py-10 max-w-2xl mx-auto w-full"
      style={{ color: 'var(--color-codex-text)' }}
    >
      {/* ── Header ── */}
      <header className="flex items-start justify-between mb-8 animate-fade-up">
        <div>
          <p
            className="text-xs uppercase tracking-widest mb-1"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            VocabVoice
          </p>
          <h1
            className="font-display text-4xl md:text-5xl"
            style={{ color: 'var(--color-codex-text)' }}
          >
            {profile?.display_name ?? 'Welcome'}
          </h1>
        </div>
        <form action={signOut} className="mt-1">
          <button type="submit" className="btn-ghost">
            Sign Out
          </button>
        </form>
      </header>

      {/* ── Session ended banners ── */}
      {params.ended === 'completed' && (
        <div
          className="mb-6 p-3 rounded text-sm animate-fade-up"
          style={{
            color: 'var(--color-status-mastered)',
            background: 'color-mix(in srgb, var(--color-status-mastered) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-status-mastered) 22%, transparent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ✓ Session completed. Great practice.
        </div>
      )}
      {params.ended === 'abandoned' && (
        <div
          className="mb-6 p-3 rounded text-sm animate-fade-up"
          style={{
            color: 'var(--color-codex-muted)',
            background: 'color-mix(in srgb, var(--color-codex-muted) 6%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-codex-muted) 18%, transparent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Session ended early.
        </div>
      )}

      {/* ── Sprint 3 nav cards: mobile = stack, md = side by side ── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8 animate-fade-up animate-fade-up-delay-1">
        {/* Word Bank card */}
        <Link href="/words" className="card p-5 flex flex-col gap-2 group no-underline">
          <div className="flex items-center justify-between">
            <span
              className="category-tag"
              style={{
                background: 'color-mix(in srgb, var(--color-codex-teal) 15%, transparent)',
                color: 'var(--color-codex-teal)',
              }}
            >
              LEXICON
            </span>
            <span
              className="text-xs group-hover:translate-x-0.5 transition-transform"
              style={{ color: 'var(--color-codex-muted)' }}
            >
              →
            </span>
          </div>
          <h2
            className="font-display text-2xl"
            style={{ color: 'var(--color-codex-text)' }}
          >
            Word Bank
          </h2>
          <p className="text-xs" style={{ color: 'var(--color-codex-muted)' }}>
            {wordCount} {wordCount === 1 ? 'word' : 'words'} saved
            {mastered > 0 && ` · ${mastered} mastered`}
          </p>
        </Link>

        {/* Setup Session card */}
        <Link href="/setup-session" className="card p-5 flex flex-col gap-2 group no-underline">
          <div className="flex items-center justify-between">
            <span
              className="category-tag"
              style={{
                background: 'color-mix(in srgb, var(--color-codex-gold) 15%, transparent)',
                color: 'var(--color-codex-gold)',
              }}
            >
              SESSION
            </span>
            <span
              className="text-xs group-hover:translate-x-0.5 transition-transform"
              style={{ color: 'var(--color-codex-muted)' }}
            >
              →
            </span>
          </div>
          <h2
            className="font-display text-2xl"
            style={{ color: 'var(--color-codex-text)' }}
          >
            Begin Practice
          </h2>
          <p className="text-xs" style={{ color: 'var(--color-codex-muted)' }}>
            Choose a topic and start a voice session
          </p>
        </Link>
      </section>

      <div className="divider mb-8" />

      {/* ── Sprint 2 validation panel (retained for reference) ── */}
      <section
        className="card p-5 animate-fade-up animate-fade-up-delay-2"
      >
        <p
          className="text-xs uppercase tracking-widest mb-4"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          System — DB &amp; Auth Status
        </p>

        {profileResult.error ? (
          <p
            className="text-sm"
            style={{ fontFamily: 'var(--font-mono)', color: '#F87171' }}
          >
            ✗ Profile fetch failed: {profileResult.error.message}
          </p>
        ) : (
          <dl
            className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {(
              [
                ['Trigger',      '✓ on_auth_user_created fired'],
                ['RLS',          '✓ owner select policy passed'],
                ['display_name', profile?.display_name ?? '—'],
                ['target_lang',  profile?.target_lang  ?? '—'],
                ['proficiency',  profile?.proficiency  ?? '—'],
                ['uid',          user.id.slice(0, 16) + '…'],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt style={{ color: 'var(--color-codex-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {label}
                </dt>
                <dd
                  className="mt-0.5 truncate"
                  style={{
                    color: label === 'Trigger' || label === 'RLS'
                      ? 'var(--color-status-mastered)'
                      : 'var(--color-codex-text)',
                  }}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </main>
  );
}
