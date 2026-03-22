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

interface DiagnosticReport {
  proficiency_level:           string;
  grammar_and_syntax_feedback: string;
  learning_path_recommendation: string;
  target_words:                WordRecommendation[];
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

  // ── Generate holistic diagnostic report via GPT-4o ───────────────────────
  const systemPrompt = `You are an expert English language assessor and vocabulary coach. Analyse the proficiency interview transcript and produce a holistic diagnostic report.

Return ONLY a single valid JSON object — no explanation, no preamble, no markdown fences — matching this exact schema:

{
  "proficiency_level": "One concise label, e.g. 'B2 Upper-Intermediate' or 'C1 Advanced', with a 1–2 sentence justification.",
  "grammar_and_syntax_feedback": "2–4 sentences identifying the learner's most notable grammatical patterns — both strengths and specific recurring errors observed in the transcript.",
  "learning_path_recommendation": "2–3 sentences of concrete, personalised advice on what to focus on next: skills, register, vocabulary domains, or practice habits.",
  "target_words": [
    {"word":"...","definition":"One clear sentence.","example":"One natural sentence using the word in professional context."}
  ]
}

Rules for target_words:
- Exactly 10 entries
- Match the learner's demonstrated level — not words they already use fluently
- Relevant to their professional domain, goals, and stated challenges
- Mix: precise academic vocabulary, domain-specific terms, and sophisticated connectors
- Prefer B2–C1 level unless the transcript shows C2 proficiency already
- Prefer words the learner attempted but used imprecisely, or words that would clearly lift their precision`;

  let report: DiagnosticReport;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role:    'user',
          content: `Here is the proficiency interview transcript:\n\n${transcriptText}\n\nGenerate the diagnostic report now.`,
        },
      ],
      max_tokens:  1200,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!raw) throw new Error('Empty response from LLM');

    // Strip accidental markdown fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    report = JSON.parse(cleaned) as DiagnosticReport;

    if (!report.target_words || !Array.isArray(report.target_words) || report.target_words.length === 0) {
      throw new Error('LLM returned invalid report structure');
    }

    // Validate and sanitise target_words entries
    report.target_words = report.target_words
      .filter((w) => typeof w.word === 'string' && w.word.trim())
      .slice(0, 10)
      .map((w) => ({
        word:       w.word.trim().toLowerCase(),
        definition: (w.definition ?? '').trim(),
        example:    (w.example    ?? '').trim(),
      }));

  } catch (err) {
    console.error('[diagnostic/finalize] LLM report generation failed:', err);
    return Response.json(
      { error: 'Failed to generate diagnostic report. Please try again.' },
      { status: 502 },
    );
  }

  // ── Insert words into the user's word bank (skip duplicates) ──────────────
  // Migration 011 adds UNIQUE(user_id, word) so ON CONFLICT resolves correctly.
  const inserts = report.target_words.map((w) => ({
    user_id:    user.id,
    word:       w.word,
    definition: w.definition || null,
    example:    w.example    || null,
    status:     'new' as const,
  }));

  const { error: insertError } = await supabase
    .from('words')
    .upsert(inserts, {
      onConflict:       'user_id,word',
      ignoreDuplicates: true,
    });

  if (insertError) {
    console.error('[diagnostic/finalize] Word insert failed:', insertError);
    // Non-fatal — still complete the session and return the report
  }

  // ── Mark session as completed ──────────────────────────────────────────────
  await supabase
    .from('sessions')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('user_id', user.id);

  return Response.json(report, { status: 200 });
}
