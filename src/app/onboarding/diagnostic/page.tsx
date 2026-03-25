/**
 * src/app/onboarding/diagnostic/page.tsx
 *
 * Protected Server Component — Diagnostic Onboarding landing page.
 * Explains the voice assessment and starts it via a Server Action form.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import StartDiagnosticForm from './_components/StartDiagnosticForm';

export default async function DiagnosticLandingPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  return (
    <main
      className="min-h-dvh px-4 py-12 md:px-6 max-w-xl mx-auto w-full flex flex-col justify-center"
      style={{ color: 'var(--color-codex-text)' }}
    >
      {/* ── Eyebrow ── */}
      <p
        className="text-xs uppercase tracking-widest mb-3 animate-fade-up"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
      >
        VocabVoice / Onboarding
      </p>

      {/* ── Headline ── */}
      <h1
        className="font-display text-4xl md:text-5xl leading-tight mb-4 animate-fade-up"
        style={{ color: 'var(--color-codex-text)' }}
      >
        Voice Proficiency<br />Assessment
      </h1>

      {/* ── Description ── */}
      <p
        className="text-base leading-relaxed mb-8 animate-fade-up animate-fade-up-delay-1"
        style={{ color: 'var(--color-codex-muted)' }}
      >
        Talk for 2–3 minutes about your professional background, goals, and areas
        of expertise. The AI listens to your vocabulary choices and generates a
        personalised word list matched to your exact proficiency level.
      </p>

      {/* ── What to expect ── */}
      <div
        className="card p-5 mb-8 animate-fade-up animate-fade-up-delay-1"
      >
        <p
          className="text-xs uppercase tracking-widest mb-3"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          How it works
        </p>
        <ol className="flex flex-col gap-3 text-sm" style={{ color: 'var(--color-codex-text)' }}>
          {[
            ['Hold to speak', 'Press and hold the mic button to record. Release to send.'],
            ['Natural conversation', 'Answer the AI\'s questions about your work and goals. Aim for 4–8 turns.'],
            ['Get your words', 'Click "Finish Assessment" — the AI generates 10 target words tailored to you.'],
          ].map(([title, desc]) => (
            <li key={title} className="flex gap-3">
              <span
                className="mt-0.5 shrink-0"
                style={{ color: 'var(--color-codex-teal)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}
              >
                ◆
              </span>
              <span>
                <span style={{ fontWeight: 600 }}>{title}</span>
                <span style={{ color: 'var(--color-codex-muted)' }}> — {desc}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Start form (Server Action) ── */}
      <div className="animate-fade-up animate-fade-up-delay-2">
        <StartDiagnosticForm />
      </div>
    </main>
  );
}
