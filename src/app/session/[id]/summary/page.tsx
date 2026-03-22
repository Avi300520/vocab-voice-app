/**
 * src/app/session/[id]/summary/page.tsx
 *
 * Post-session summary — Server Component.
 * Shows evaluation results, full transcript with highlighted words,
 * and navigation actions after a session is completed or abandoned.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionSummaryData } from '@/app/actions/sessions';
import SummaryHeader from './_components/SummaryHeader';
import EvaluationResults from './_components/EvaluationResults';
import TranscriptReview from './_components/TranscriptReview';
import SummaryActions from './_components/SummaryActions';

export default async function SessionSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = await params;
  const supabase = await createClient();

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  // ── Fetch summary data ──────────────────────────────────────────────────────
  const data = await getSessionSummaryData(sessionId);

  if (!data) {
    redirect('/dashboard');
  }

  // If session is still active, redirect back to the live session
  if (data.session.status === 'active') {
    redirect(`/session/${sessionId}`);
  }

  return (
    <main
      className="min-h-dvh px-4 py-8 md:px-6 md:py-10 max-w-2xl mx-auto w-full"
      style={{ color: 'var(--color-codex-text)' }}
    >
      {/* Header: topic, status, stats */}
      <SummaryHeader session={data.session} />

      <div className="divider my-6" />

      {/* Evaluation results: aggregate bar + per-word cards */}
      <EvaluationResults
        evaluations={data.evaluations}
        sessionWords={data.sessionWords}
      />

      <div className="divider my-6" />

      {/* Full transcript with detected word highlights */}
      <TranscriptReview messages={data.messages} />

      <div className="divider my-6" />

      {/* Navigation actions */}
      <SummaryActions topic={data.session.topic} />
    </main>
  );
}
