'use server';

/**
 * src/app/actions/profile.ts
 *
 * Server Actions for user profile management.
 * Uses useActionState pattern — returns a result object instead of redirecting,
 * so the Client Component can show inline success/error feedback.
 */

import { createClient } from '@/lib/supabase/server';

export interface ProfileActionState {
  error: string | null;
  success: boolean;
}

export async function updateProfile(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Not authenticated.', success: false };
  }

  const displayName = (formData.get('display_name') as string).trim();
  const proficiency = formData.get('proficiency') as string;

  if (!displayName) {
    return { error: 'Display name is required.', success: false };
  }

  const validProficiencies = ['intermediate', 'advanced', 'native'];
  if (!validProficiencies.includes(proficiency)) {
    return { error: 'Invalid proficiency level.', success: false };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName, proficiency: proficiency as 'intermediate' | 'advanced' | 'native' })
    .eq('id', user.id);

  if (error) {
    return { error: error.message, success: false };
  }

  return { error: null, success: true };
}
