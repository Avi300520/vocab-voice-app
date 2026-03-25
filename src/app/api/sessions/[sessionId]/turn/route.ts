/**
 * src/app/api/sessions/[sessionId]/turn/route.ts
 *
 * POST /api/sessions/:sessionId/turn
 *
 * Sprint 5A — Real conversational pipeline.
 *
 * Pipeline:
 *   1. Auth + session ownership verification
 *   2. [STT]  Audio blob  -> transcript text       (OpenAI Whisper whisper-1)
 *   3. [CTX]  Fetch prior session_messages          (Supabase)
 *   4. [LLM]  transcript + history -> AI reply      (OpenAI gpt-4o-mini)
 *   5. [WORD] Naive word detection                   (lemmatizer: Sprint 5B)
 *   6. [TTS]  reply text -> audio/mpeg                (OpenAI tts-1 / alloy)
 *   7. Persist both turns atomically via DB RPC      (Supabase) ← runs in parallel with 6
 *   8. Return TurnResponse JSON
 *
 * NOT in this sprint:
 *   - TTS (audio_url is always null here)
 *   - Semantic lemmatization / word scoring
 *
 * ── turn_index strategy ───────────────────────────────────────────────────────
 * turn_index is now assigned entirely inside the database by the
 * `insert_session_turn` PL/pgSQL function (migration 002).
 *
 * The function acquires a FOR UPDATE lock on the sessions row before computing
 * MAX(turn_index)+1, so no two concurrent requests for the same session can
 * observe the same MAX value.  Requests for different sessions are unaffected.
 *
 * This route no longer calculates or supplies turn_index at all.
 */

import type { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import type { SessionRow, WordRow } from '@/lib/supabase/types';

// ── OpenAI client (singleton per cold-start) ──────────────────────────────────
// Throws at import time if OPENAI_API_KEY is absent so the error is visible
// immediately in server logs rather than silently failing on the first request.
if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    '[turn/route] OPENAI_API_KEY is not set. ' +
    'Add it to .env.local: OPENAI_API_KEY=sk-...',
  );
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Production guardrails ──────────────────────────────────────────────────────
/** Hard ceiling on LLM output tokens — prevents runaway completions. */
const MAX_REPLY_TOKENS = 500;
/** Sessions are capped at this many turns; prompts the user to start fresh. */
const SESSION_TURN_CAP = 20;
/** Per-user hourly message budget across all sessions. */
const HOURLY_RATE_LIMIT = 60;

// ── Response shape shared with the VoiceSession client ───────────────────────
export interface TurnResponse {
  turn_index:     number;
  transcript:     string;        // User words (from Whisper)
  reply_text:     string;        // AI reply   (from gpt-4o-mini)
  audio_url:      string | null; // TTS audio URL — null until Sprint 5B
  detected_words: string[];      // Word bank matches in transcript
}

// ── System prompt factory ─────────────────────────────────────────────────────
function buildSystemPrompt(topic: string, topicContext: string | null): string {
  // Review sessions: topic_context holds the comma-separated word list.
  // The AI must organically weave those words into conversation without
  // announcing them as "target words".
  if (topic === '__review__') {
    const wordList = topicContext ?? '';
    return (
      `You are a razor-sharp intellectual sparring partner engaged in a voice conversation about ideas, current events, or professional topics of your choosing.\n` +
      `\n` +
      `HIDDEN MISSION: The learner needs to actively use each of the following words in natural speech: ${wordList}.\n` +
      `Do NOT reveal this list. Do NOT say "today's words are…" or anything similar.\n` +
      `Instead, steer the conversation toward subjects where these words arise naturally — pose questions or statements that make it almost irresistible for the learner to reach for precisely these words.\n` +
      `If the learner uses one of these words correctly, acknowledge the point briefly without drawing attention to the word itself, then advance the discussion.\n` +
      `\n` +
      `RULES — never break these:\n` +
      `1. Your ENTIRE response must be 2-3 sentences maximum. Brevity is non-negotiable for voice.\n` +
      `2. End with exactly one probing question that nudges the learner toward vocabulary on the list.\n` +
      `3. Never compliment the user just to be polite. Reserve praise for genuinely precise language or sharp reasoning.\n` +
      `4. Write in plain prose: no bullet points, no markdown, no headers. This is spoken dialogue.`
    );
  }

  const contextLine = topicContext ? `\nCONTEXT: ${topicContext}` : '';
  return (
    `You are a razor-sharp intellectual sparring partner engaged in a voice conversation.\n` +
    `\n` +
    `TOPIC: "${topic}"${contextLine}\n` +
    `\n` +
    `RULES — never break these:\n` +
    `1. Your ENTIRE response must be 2-3 sentences maximum. Never exceed this. Brevity is non-negotiable for voice.\n` +
    `2. Challenge the user's reasoning directly. If an argument is weak, name the weakness.\n` +
    `3. End with exactly one probing question that forces deeper thinking.\n` +
    `4. Never compliment the user just to be polite. Reserve any praise for genuinely incisive insights only.\n` +
    `5. Never discuss daily routines, weather, food, greetings, or any small talk whatsoever.\n` +
    `6. You may disagree with the user's entire premise — state your position and defend it concisely.\n` +
    `7. Write in plain prose: no bullet points, no markdown, no headers. This is spoken dialogue.`
  );
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  // ── 1. Auth guard ──────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;

  // ── 2. Validate session ownership and status ───────────────────────────────
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
    return Response.json(
      { error: `Session is ${session.status}, not active` },
      { status: 409 },
    );
  }

  // ── 3a. Session turn cap ────────────────────────────────────────────────────
  // Enforced after status check so abandoned/completed sessions are caught first.
  if (session.turn_count >= SESSION_TURN_CAP) {
    return Response.json(
      {
        error:
          `This session has reached the ${SESSION_TURN_CAP}-turn limit. ` +
          'Click "Complete Session" to save your progress, then start a new session.',
      },
      { status: 409 },
    );
  }

  // ── 3b. Per-user hourly rate limit ─────────────────────────────────────────
  // Fails fast before any OpenAI work so abusive requests cost nothing.
  const { data: limitExceeded, error: rateLimitError } = await supabase.rpc(
    'check_user_rate_limit',
    { p_user_id: user.id, p_limit: HOURLY_RATE_LIMIT },
  );

  if (rateLimitError) {
    // Non-fatal: if the RPC errors we log and allow the request through rather
    // than blocking legitimate users due to an infra hiccup.
    console.warn('[turn/route] Rate-limit RPC error (allowing request):', rateLimitError.message);
  } else if (limitExceeded) {
    return Response.json(
      {
        error:
          `You have reached the limit of ${HOURLY_RATE_LIMIT} voice turns per hour. ` +
          'Please wait a few minutes before continuing.',
      },
      { status: 429 },
    );
  }

  // ── 3. Parse multipart form data (audio blob) ──────────────────────────────
  let audioFile: File;
  try {
    const formData = await request.formData();
    const raw = formData.get('audio');
    if (!raw || !(raw instanceof File)) {
      return Response.json(
        { error: 'Missing or invalid audio field in form data' },
        { status: 400 },
      );
    }
    audioFile = raw;
  } catch {
    return Response.json(
      { error: 'Invalid request body — expected multipart/form-data' },
      { status: 400 },
    );
  }

  // ── 4. STT: Whisper whisper-1 ──────────────────────────────────────────────
  // The native File object (from FormData) satisfies the SDK's Uploadable type
  // directly — no toFile() wrapper needed.
  let transcript: string;
  let wordTimestamps: Record<string, unknown>[] = [];
  try {
    const transcription = await openai.audio.transcriptions.create({
      file:  audioFile,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
    });
    transcript = transcription.text.trim();
    wordTimestamps = (transcription.words ?? []) as unknown as Record<string, unknown>[];

    if (!transcript) {
      return Response.json(
        { error: 'Could not transcribe audio — is the recording audible?' },
        { status: 422 },
      );
    }
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 400) {
        // Most common cause: audio blob is too short (Whisper requires >= 0.1 s).
        // The 1-second frontend guard should prevent this reaching the server, but
        // this is the belt-and-suspenders fallback.
        console.warn('[turn/route] Whisper rejected audio (400 — too short):', err.message);
        return Response.json(
          { error: 'Recording was too short — hold the button for at least 1 second.' },
          { status: 422 },
        );
      }
      console.error('[turn/route] Whisper STT failed:', `[${err.status}] ${err.message}`);
    } else {
      console.error('[turn/route] Whisper STT failed (unexpected):', String(err));
    }
    return Response.json(
      { error: 'Speech-to-text failed. Please try again.' },
      { status: 502 },
    );
  }

  // ── 5. Fetch conversation history for LLM context ─────────────────────────
  // We no longer derive turn_index here — the DB function handles that.
  // The rows are ordered ascending so history arrives in chronological order.
  const { data: priorMessages, error: historyError } = await supabase
    .from('session_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('turn_index', { ascending: true });

  if (historyError) {
    // Non-fatal — worst case the LLM replies without full context.
    console.warn('[turn/route] Could not fetch session history:', historyError.message);
  }

  // ── 6. LLM: gpt-4o-mini ───────────────────────────────────────────────────
  let replyText: string;
  try {
    const systemPrompt = buildSystemPrompt(session.topic, session.topic_context);

    const history: OpenAI.Chat.ChatCompletionMessageParam[] = (priorMessages ?? []).map((m) => ({
      role:    m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: transcript },
      ],
      max_tokens:  MAX_REPLY_TOKENS, // hard production ceiling — prompt engineering targets ~3 sentences (~220 tokens)
      temperature: 0.8,              // punchy but not erratic
    });

    replyText = completion.choices[0]?.message?.content?.trim() ?? '';

    if (!replyText) {
      console.error(
        '[turn/route] gpt-4o-mini returned empty content. finish_reason:',
        completion.choices[0]?.finish_reason,
      );
      return Response.json(
        { error: 'AI returned an empty response. Please try again.' },
        { status: 502 },
      );
    }
  } catch (err) {
    const detail = err instanceof OpenAI.APIError
      ? `[${err.status}] ${err.message}`
      : String(err);
    console.error('[turn/route] Chat completion failed:', detail);
    return Response.json(
      { error: 'AI response generation failed. Please try again.' },
      { status: 502 },
    );
  }

  // ── 7. Naive word detection (Sprint 5B: replace with proper lemmatizer) ────
  const { data: words } = await supabase
    .from('words')
    .select('id, word, status')
    .eq('user_id', user.id)
    .returns<Pick<WordRow, 'id' | 'word' | 'status'>[]>();

  const detectedWords = naiveDetectWords(transcript, words ?? []);

  // ── 8. TTS + DB persist — run in parallel to minimise total latency ────────
  //
  // These two operations are completely independent of each other, so we fire
  // them simultaneously with Promise.all and wait for both to settle.
  //
  // TTS (tts-1 / alloy)
  //   • Non-fatal — a TTS error still returns the text reply.
  //   • Returns a base64-encoded mp3 string (null on failure).
  //   • The SDK's speech.create() returns a Response-like object; we read the
  //     binary body with .arrayBuffer() then base64-encode it for JSON transport.
  //   • The client constructs a data URL and plays it via HTMLAudioElement.
  //
  // DB persist (insert_session_turn)
  //   • Fatal — if this fails we return 500 before touching the response.
  //   • The function holds a FOR UPDATE lock on sessions for its transaction so
  //     no concurrent request can steal the same turn_index.
  const [audioBase64, rpcResult] = await Promise.all([

    // ── TTS ──────────────────────────────────────────────────────────────────
    openai.audio.speech.create({
      model:           'tts-1',
      voice:           'alloy',
      input:           replyText,
      response_format: 'mp3',
    })
      .then((r)   => r.arrayBuffer())
      .then((buf) => Buffer.from(buf).toString('base64'))
      .catch((err) => {
        const detail = err instanceof OpenAI.APIError
          ? `[${err.status}] ${err.message}`
          : String(err);
        console.error('[turn/route] TTS generation failed (non-fatal):', detail);
        return null; // audio_url will be null; client shows text-only
      }),

    // ── DB persist ───────────────────────────────────────────────────────────
    supabase.rpc('insert_session_turn', {
      p_session_id:      sessionId,
      p_user_id:         user.id,
      p_transcript:      transcript,
      p_reply_text:      replyText,
      p_detected_words:  detectedWords,
      p_word_timestamps: wordTimestamps,
    }),
  ]);

  // ── 9. Check DB result (fatal) ─────────────────────────────────────────────
  const { data: turnIndex, error: persistError } = rpcResult;

  if (persistError || turnIndex === null) {
    console.error('[turn/route] insert_session_turn RPC failed:', {
      code:    persistError?.code,
      message: persistError?.message,
      hint:    persistError?.hint,
      details: persistError?.details,
    });
    return Response.json(
      { error: 'Failed to save the conversation turn. Please try again.' },
      { status: 500 },
    );
  }

  // ── 10. Return structured TurnResponse ────────────────────────────────────
  return Response.json(
    {
      turn_index:     turnIndex,
      transcript,
      reply_text:     replyText,
      // Base64-encoded mp3 wrapped in a data URL so the client can pass it
      // directly to new Audio().  Null when TTS failed — client falls back to
      // text-only display (session is not interrupted).
      audio_url:      audioBase64 ? `data:audio/mpeg;base64,${audioBase64}` : null,
      detected_words: detectedWords,
    } satisfies TurnResponse,
    { status: 200 },
  );
}

// ── Naive substring word detection ────────────────────────────────────────────
// Sprint 5B will replace this with a proper lemmatizer (e.g. compromise.js)
// that normalises inflections before matching (run -> running -> ran).
function naiveDetectWords(
  transcript: string,
  wordBank: Pick<WordRow, 'id' | 'word' | 'status'>[],
): string[] {
  const lower = transcript.toLowerCase();
  return wordBank
    .filter((w) => lower.includes(w.word.toLowerCase()))
    .map((w) => w.word);
}
