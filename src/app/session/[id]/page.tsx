/**
 * src/app/session/[id]/page.tsx
 *
 * Protected Server Component — Active Voice Session.
 * Fetches the session record + user's word bank, then delegates
 * all interaction to the <VoiceSession> client component.
 */

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { SessionRow, WordRow } from '@/lib/supabase/types';
import VoiceSession from './_components/VoiceSession';

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { id: sessionId } = await params;

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  // ── Fetch session (RLS ensures ownership) ───────────────────────────────────
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single<SessionRow>();

  if (sessionError || !session) notFound();

  // Redirect completed/abandoned sessions back to dashboard
  if (session.status !== 'active') {
    redirect(`/dashboard?ended=${session.status}`);
  }

  // ── Fetch user's word bank ───────────────────────────────────────────────────
  const { data: words } = await supabase
    .from('words')
    .select('*')
    .order('status', { ascending: true }) // new → practicing → mastered
    .returns<WordRow[]>();

  const wordBank = words ?? [];

  return (
    <VoiceSession
      sessionId={sessionId}
      topic={session.topic}
      topicContext={session.topic_context ?? undefined}
      wordBank={wordBank}
      initialTurnCount={session.turn_count ?? 0}
    />
  );
}
