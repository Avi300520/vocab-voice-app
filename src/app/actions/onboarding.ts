'use server';

/**
 * src/app/actions/onboarding.ts
 *
 * Server Actions for the voice-based onboarding diagnostic flow.
 */

import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { createClient } from '@/lib/supabase/server';

export type StartDiagnosticState = { error: string | null };

/**
 * Creates a new diagnostic session and redirects to the live assessment screen.
 * Designed for use with React's `useActionState` hook.
 */
export async function startDiagnosticSession(
  _prev: StartDiagnosticState,
  _formData: FormData,
): Promise<StartDiagnosticState> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  let sessionId = '';

  try {
    const { data: session, error: insertError } = await supabase
      .from('sessions')
      .insert({
        user_id:       user.id,
        topic:         '__diagnostic__',
        topic_context: 'Voice proficiency diagnostic — assesses vocabulary depth through professional conversation.',
        status:        'active',
        metadata:      { diagnostic: true },
      })
      .select('id')
      .single();

    if (insertError || !session) {
      console.error('[startDiagnosticSession] DB insert failed:', insertError);
      return {
        error: insertError?.message ?? 'Failed to create diagnostic session.',
      };
    }

    sessionId = session.id;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    console.error('[startDiagnosticSession] Unexpected error:', err);
    return { error: 'Unexpected server error. Please try again.' };
  }

  redirect(`/onboarding/diagnostic/${sessionId}`);
}
