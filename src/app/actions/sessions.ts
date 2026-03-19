'use server';

/**
 * src/app/actions/sessions.ts
 *
 * Server Action to create a new practice session row in the database.
 * The voice loop will be wired to the created session in Sprint 4.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function createSession(formData: FormData): Promise<never> {
  const supabase = await createClient();

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  const topic        = (formData.get('topic')         as string)?.trim();
  const topicContext = (formData.get('topic_context') as string)?.trim() || null;

  if (!topic) redirect('/setup-session?error=Please+select+a+topic.');

  const { data: session, error } = await supabase
    .from('sessions')
    .insert({
      user_id:       user.id,
      topic,
      topic_context: topicContext,
      status:        'active',
    })
    .select('id')
    .single();

  if (error || !session) {
    redirect(`/setup-session?error=${encodeURIComponent(error?.message ?? 'Failed to create session.')}`);
  }

  // Sprint 4 will build /session/[id]. Until then, redirect to dashboard.
  redirect(`/dashboard?session=${session.id}`);
}
