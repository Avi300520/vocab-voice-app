'use server';

/**
 * src/app/actions/words.ts
 *
 * Server Actions for the user's word bank.
 * Security: user_id is ALWAYS sourced from the server session (auth.getUser()),
 * never from client-supplied form data. RLS policies provide a second layer.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type WordActionState = {
  error?: string;
  success?: boolean;
  word?: string;
} | null;

// ─── Add Word ─────────────────────────────────────────────────────────────────

export async function addWord(
  _prevState: WordActionState,
  formData: FormData,
): Promise<WordActionState> {
  const supabase = await createClient();

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  const word       = (formData.get('word')       as string)?.trim();
  const definition = (formData.get('definition') as string)?.trim() || null;
  const notes      = (formData.get('notes')      as string)?.trim() || null;

  if (!word) return { error: 'A word is required.' };
  if (word.length > 100) return { error: 'Word must be under 100 characters.' };

  const { error } = await supabase
    .from('words')
    .insert({
      user_id:    user.id,   // ← always from server session
      word,
      definition,
      notes,
    });

  if (error) {
    // Unique violation: (user_id, lower(word)) — from our words_user_word_unique index
    if (error.code === '23505') {
      return { error: `"${word}" already exists in your word bank.` };
    }
    return { error: `Database error: ${error.message}` };
  }

  revalidatePath('/words');
  return { success: true, word };
}

// ─── Delete Word ──────────────────────────────────────────────────────────────

export async function deleteWord(wordId: string): Promise<void> {
  const supabase = await createClient();

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  // Belt-and-suspenders: explicit user_id check in addition to RLS
  const { error } = await supabase
    .from('words')
    .delete()
    .eq('id', wordId)
    .eq('user_id', user.id);

  if (error) {
    // Silently log — UI will refresh via revalidatePath regardless
    console.error('[deleteWord]', error.message);
  }

  revalidatePath('/words');
}
