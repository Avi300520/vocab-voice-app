/**
 * src/app/api/onboarding/diagnostic/[sessionId]/turn/route.ts
 *
 * POST /api/onboarding/diagnostic/:sessionId/turn
 *
 * Identical pipeline to the regular session turn route, but uses an
 * assessor system prompt designed to evaluate spoken proficiency through
 * professional conversation. No word-bank detection is performed.
 */

import type { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import type { SessionRow } from '@/lib/supabase/types';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('[diagnostic/turn] OPENAI_API_KEY is not set.');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Assessor system prompt ────────────────────────────────────────────────────

const ASSESSOR_SYSTEM_PROMPT = `You are an expert English language assessor conducting a spoken proficiency interview.

Your role is to have a natural, intellectually engaging conversation that reveals the learner's English vocabulary depth and fluency. Explore their professional background, domain expertise, daily challenges, and long-term goals.

RULES — never break these:
1. Maximum 2–3 sentences per response. This is a voice conversation — brevity is mandatory.
2. Ask exactly one clear, open-ended question per turn that encourages elaboration.
3. Be warm, professionally curious, and genuinely interested in their background.
4. Focus on topics that naturally require nuanced, domain-specific vocabulary.
5. If the response is very brief or unclear, gently ask them to expand.
6. Plain prose only — no bullet points, no markdown, no formatting.
7. Do not comment on grammar or vocabulary errors; simply model correct usage naturally.`;

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
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
  if (session.status !== 'active') {
    return Response.json({ error: `Session is ${session.status}` }, { status: 409 });
  }
  // Guard: must be a diagnostic session
  if (session.topic !== '__diagnostic__') {
    return Response.json({ error: 'Not a diagnostic session' }, { status: 400 });
  }

  // ── Parse audio ───────────────────────────────────────────────────────────
  let audioFile: File;
  try {
    const formData = await request.formData();
    const raw = formData.get('audio');
    if (!raw || !(raw instanceof File)) {
      return Response.json({ error: 'Missing audio field' }, { status: 400 });
    }
    audioFile = raw;
  } catch {
    return Response.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  // ── STT: Whisper ──────────────────────────────────────────────────────────
  let transcript: string;
  try {
    const result = await openai.audio.transcriptions.create({
      file:  audioFile,
      model: 'whisper-1',
      response_format: 'json',
    });
    transcript = result.text.trim();
    if (!transcript) {
      return Response.json({ error: 'Could not transcribe audio.' }, { status: 422 });
    }
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 400) {
      return Response.json({ error: 'Recording too short — hold the button for at least 1 second.' }, { status: 422 });
    }
    console.error('[diagnostic/turn] Whisper error:', err);
    return Response.json({ error: 'Speech-to-text failed.' }, { status: 502 });
  }

  // ── Fetch history ─────────────────────────────────────────────────────────
  const { data: priorMessages } = await supabase
    .from('session_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('turn_index', { ascending: true });

  // ── LLM: gpt-4o-mini ─────────────────────────────────────────────────────
  let replyText: string;
  try {
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = (priorMessages ?? []).map((m) => ({
      role:    m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ASSESSOR_SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: transcript },
      ],
      max_tokens:  180,
      temperature: 0.7,
    });

    replyText = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!replyText) {
      return Response.json({ error: 'AI returned empty response.' }, { status: 502 });
    }
  } catch (err) {
    console.error('[diagnostic/turn] LLM error:', err);
    return Response.json({ error: 'AI response failed.' }, { status: 502 });
  }

  // ── TTS + DB persist (parallel) ───────────────────────────────────────────
  const [audioBase64, rpcResult] = await Promise.all([
    openai.audio.speech.create({
      model:           'tts-1',
      voice:           'alloy',
      input:           replyText,
      response_format: 'mp3',
    })
      .then((r) => r.arrayBuffer())
      .then((buf) => Buffer.from(buf).toString('base64'))
      .catch((err) => {
        console.error('[diagnostic/turn] TTS error (non-fatal):', err);
        return null;
      }),

    supabase.rpc('insert_session_turn', {
      p_session_id:     sessionId,
      p_user_id:        user.id,
      p_transcript:     transcript,
      p_reply_text:     replyText,
      p_detected_words: [],  // No word detection in diagnostic sessions
    }),
  ]);

  const { data: turnIndex, error: persistError } = rpcResult;
  if (persistError || turnIndex === null) {
    console.error('[diagnostic/turn] DB persist failed:', persistError);
    return Response.json({ error: 'Failed to save turn.' }, { status: 500 });
  }

  return Response.json({
    turn_index:  turnIndex,
    transcript,
    reply_text:  replyText,
    audio_url:   audioBase64 ? `data:audio/mpeg;base64,${audioBase64}` : null,
  });
}
