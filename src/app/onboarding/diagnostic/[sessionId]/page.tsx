/**
 * src/app/onboarding/diagnostic/[sessionId]/page.tsx
 *
 * Protected Server Component — live voice diagnostic session.
 * Fetches the session record and delegates interaction to DiagnosticSession.
 */

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { SessionRow } from '@/lib/supabase/types';
import DiagnosticSession from './_components/DiagnosticSession';

export default async function DiagnosticSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const supabase = await createClient();
  const { sessionId } = await params;

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  // ── Fetch session ───────────────────────────────────────────────────────────
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single<SessionRow>();

  if (sessionError || !session) notFound();

  // Completed sessions: redirect to the word bank (assessment is done)
  if (session.status !== 'active') {
    redirect('/words');
  }

  return (
    <DiagnosticSession
      sessionId={sessionId}
      minTurns={4}
    />
  );
}
