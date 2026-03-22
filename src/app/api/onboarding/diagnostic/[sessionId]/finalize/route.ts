/**
 * src/app/api/onboarding/diagnostic/[sessionId]/finalize/route.ts
 *
 * POST /api/onboarding/diagnostic/:sessionId/finalize
 *
 * Reads the diagnostic session transcript, calls GPT-4o to generate
 * 10 personalised target vocabulary words, inserts them into the words
 * table (skipping any duplicates), marks the session completed, and
 * returns the word list to the client.
 */

import type { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import type { SessionRow, SessionMessageRow } from '@/lib/supabase/types';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('[diagnostic/finalize] OPENAI_API_KEY is not set.');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────

interface WordRecommendation {
  word:       string;
  definition: string;
  example:    string;
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;

  // ── Validate session ───────────────────────────────────────────────────────
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single<SessionRow>();

  if (sessionError || !session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.topic !== '__diagnostic__') {
    return Response.json({ error: 'Not a diagnostic session' }, { status: 400 });
  }
  if (session.status !== 'active') {
    return Response.json({ error: 'Session already finalized' }, { status: 409 });
  }

  // ── Fetch transcript ───────────────────────────────────────────────────────
  const { data: messages, error: msgError } = await supabase
    .from('session_messages')
    .select('role, content, turn_index')
    .eq('session_id', sessionId)
    .order('turn_index', { ascending: true })
    .returns<Pick<SessionMessageRow, 'role' | 'content' | 'turn_index'>[]>();

  if (msgError) {
    console.error('[diagnostic/finalize] Could not fetch messages:', msgError);
    return Response.json({ error: 'Failed to read session transcript.' }, { status: 500 });
  }

  const userMessages = (messages ?? []).filter((m) => m.role === 'user');

  if (userMessages.length < 2) {
    return Response.json(
      { error: 'Transcript too short to generate recommendations. Please have at least 2 turns.' },
      { status: 422 },
    );
  }

  // ── Build transcript string for the LLM ───────────────────────────────────
  const transcriptText = (messages ?? [])
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'user' ? 'LEARNER' : 'ASSESSOR'}: ${m.content}`)
    .join('\n');

  // ── Generate word recommendations via GPT-4o ──────────────────────────────
  const systemPrompt = `You are an expert vocabulary coach for English language learners. Analyse the proficiency interview transcript and select exactly 10 English words for the learner to study.

Selection criteria:
- Match the learner's demonstrated level — not words they already use fluently
- Relevant to their professional domain, goals, and stated challenges
- Mix: precise academic vocabulary, domain-specific terms, and sophisticated connectors
- Prefer B2–C1 level unless the transcript shows C2 proficiency already
- Prefer words the learner attempted but used imprecisely, or words that would lift their precision

Return ONLY valid JSON — a single array of exactly 10 objects. No explanation, no preamble, no markdown fences:
[{"word":"...","definition":"One clear sentence.","example":"One natural sentence using the word in professional context."}]`;

  let recommendations: WordRecommendation[];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role:    'user',
          content: `Here is the proficiency interview transcript:\n\n${transcriptText}\n\nGenerate the 10 target vocabulary words now.`,
        },
      ],
      max_tokens:  800,
      temperature: 0.4, // Lower temperature for consistent, well-chosen words
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!raw) throw new Error('Empty response from LLM');

    // Strip accidental markdown fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    recommendations = JSON.parse(cleaned) as WordRecommendation[];

    if (!Array.isArray(recommendations) || recommendations.length === 0) {
      throw new Error('LLM returned non-array or empty array');
    }

    // Validate and sanitise entries
    recommendations = recommendations
      .filter((w) => typeof w.word === 'string' && w.word.trim())
      .slice(0, 10)
      .map((w) => ({
        word:       w.word.trim().toLowerCase(),
        definition: (w.definition ?? '').trim(),
        example:    (w.example    ?? '').trim(),
      }));

  } catch (err) {
    console.error('[diagnostic/finalize] LLM word generation failed:', err);
    return Response.json(
      { error: 'Failed to generate word recommendations. Please try again.' },
      { status: 502 },
    );
  }

  // ── Insert words into the user's word bank (skip duplicates) ──────────────
  const inserts = recommendations.map((w) => ({
    user_id:    user.id,
    word:       w.word,
    definition: w.definition || null,
    example:    w.example    || null,
    status:     'new' as const,
  }));

  const { error: insertError } = await supabase
    .from('words')
    .upsert(inserts, {
      onConflict:        'user_id,word',   // uses the existing unique index
      ignoreDuplicates:  true,
    });

  if (insertError) {
    console.error('[diagnostic/finalize] Word insert failed:', insertError);
    // Non-fatal — still complete the session and return the list
  }

  // ── Mark session as completed ──────────────────────────────────────────────
  await supabase
    .from('sessions')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('user_id', user.id);

  return Response.json({ words: recommendations }, { status: 200 });
}
