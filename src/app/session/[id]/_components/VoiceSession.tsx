'use client';

/**
 * src/app/session/[id]/_components/VoiceSession.tsx
 *
 * The active voice-loop screen.
 *
 * State machine:
 *   idle → recording → processing → playing → idle
 *                   ↘ error         ↑ interrupt via pointerdown
 *
 * MediaRecorder flow:
 *   pointerdown  → [if playing: stopAudio()] → getUserMedia → mediaRecorder.start()
 *   pointerup    → [duration check] → mediaRecorder.stop() → sendAudio()
 *                                   ↘ [too short] → discard + show toast
 *   sendAudio()  → POST /api/sessions/:id/turn → play TTS audio → idle
 *
 * ── Interruption ──────────────────────────────────────────────────────────────
 * While the AI audio is playing (phase === 'playing'), the RecordButton is NOT
 * disabled. A pointerdown event in that state calls stopAudio() synchronously,
 * then falls through to acquire the mic and start recording.  The transition is
 * instantaneous from the user's perspective.
 *
 * ── Minimum recording guard ───────────────────────────────────────────────────
 * Whisper requires >= 0.1 s of audio. We enforce a stricter 1 000 ms minimum
 * on the client so we never reach the API with a near-empty blob.
 * If the user releases before MIN_RECORDING_MS has elapsed:
 *   • The recorder is stopped immediately (no data is sent).
 *   • Collected chunks are discarded.
 *   • A brief toast message appears near the mic button.
 *   • Phase returns to 'idle' — the user can try again right away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { completeSession, abandonSession } from '@/app/actions/sessions';
import type { WordRow } from '@/lib/supabase/types';
import type { TurnResponse } from '@/app/api/sessions/[sessionId]/turn/route';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum hold time before audio is considered valid and sent to Whisper. */
const MIN_RECORDING_MS = 1000;

/** How long the "hold longer" toast stays visible. */
const TOAST_DURATION_MS = 2200;

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'recording' | 'processing' | 'playing';

type MicPermission = 'prompt' | 'granted' | 'denied' | 'unavailable';

interface TurnEntry {
  role:      'user' | 'assistant';
  text:      string;
  turnIndex: number;
  // audioUrl is intentionally absent — it is played once then discarded.
  // Storing multi-kilobyte base64 strings in the turns array would grow
  // memory unboundedly over a long session.
}

interface Props {
  sessionId:        string;
  topic:            string;
  topicContext?:    string;
  wordBank:         WordRow[];
  initialTurnCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPreferredMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Pulsing animated dots — shown while the AI is processing */
function ThinkingIndicator() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8">
      <div className="flex items-center gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="thinking-dot"
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </div>
      <p
        className="text-sm tracking-widest uppercase"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
      >
        Processing…
      </p>
    </div>
  );
}

/** Single turn bubble in the transcript feed */
function TurnBubble({ turn }: { turn: TurnEntry }) {
  const isUser = turn.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-up`}>
      <div
        className="max-w-[85%] px-4 py-3 rounded text-sm leading-relaxed"
        style={
          isUser
            ? {
                background: 'color-mix(in srgb, var(--color-codex-gold) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-codex-gold) 30%, transparent)',
                color: 'var(--color-codex-text)',
              }
            : {
                background: 'var(--color-codex-surface)',
                border: '1px solid var(--color-codex-border)',
                color: 'var(--color-codex-text)',
              }
        }
      >
        <p
          className="text-xs mb-1.5 uppercase tracking-widest"
          style={{
            fontFamily: 'var(--font-mono)',
            color: isUser ? 'var(--color-codex-gold)' : 'var(--color-codex-teal)',
          }}
        >
          {isUser ? 'You' : 'AI Interlocutor'} · Turn {turn.turnIndex}
        </p>
        <p>{turn.text}</p>
      </div>
    </div>
  );
}

/** Word tracker pill — lights up when the word has been detected */
function WordPill({ word, detected }: { word: WordRow; detected: boolean }) {
  const statusDot =
    word.status === 'mastered'   ? '●' :
    word.status === 'practicing' ? '◑' :
                                   '○';

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded text-sm transition-all duration-300"
      style={
        detected
          ? {
              background: 'color-mix(in srgb, var(--color-status-mastered) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-status-mastered) 35%, transparent)',
              color: 'var(--color-status-mastered)',
            }
          : {
              background: 'var(--color-codex-surface)',
              border: '1px solid var(--color-codex-border)',
              color: 'var(--color-codex-muted)',
            }
      }
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }}>
        {statusDot}
      </span>
      <span
        className="font-medium"
        style={{ color: detected ? 'var(--color-status-mastered)' : 'var(--color-codex-text)' }}
      >
        {word.word}
      </span>
      {detected && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--color-status-mastered)' }}>
          ✓
        </span>
      )}
    </div>
  );
}

/** The big central microphone button */
function RecordButton({
  phase,
  permission,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
}: {
  phase:          Phase;
  permission:     MicPermission;
  onPointerDown:  () => void;
  onPointerUp:    () => void;
  onPointerLeave: () => void;
}) {
  const isRecording  = phase === 'recording';
  // 'playing' is intentionally excluded — the button stays enabled so the user
  // can press it to interrupt the AI mid-sentence.
  const isProcessing = phase === 'processing';
  const isPlaying    = phase === 'playing';
  const isDisabled   = isProcessing || permission === 'denied' || permission === 'unavailable';

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      disabled={isDisabled}
      aria-label={
        isRecording  ? 'Recording — release to send' :
        isProcessing ? 'AI is thinking, please wait' :
        isPlaying    ? 'Press to interrupt and speak' :
        permission === 'denied' ? 'Microphone access denied' :
        'Hold to record'
      }
      className="record-button"
      data-recording={isRecording}
      data-processing={isProcessing}
      data-playing={isPlaying}
      style={{ touchAction: 'none' }} // Prevent scroll-on-drag on mobile
    >
      {/* Outer pulse ring — shown during recording (red) and playing (teal) */}
      {(isRecording || isPlaying) && (
        <span
          className="record-ring"
          style={isPlaying
            ? { borderColor: 'var(--color-codex-teal)', animationDuration: '1.4s' }
            : undefined
          }
        />
      )}

      {/* Inner icon */}
      <span className="record-icon">
        {isProcessing ? (
          // Spinner — hard blocked, nothing the user can do
          <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : isPlaying ? (
          // Waveform / interrupt icon — indicates audio is playing and tap interrupts
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <line x1="3"  y1="12" x2="3"  y2="12" />
            <line x1="6"  y1="8"  x2="6"  y2="16" />
            <line x1="9"  y1="5"  x2="9"  y2="19" />
            <line x1="12" y1="8"  x2="12" y2="16" />
            <line x1="15" y1="5"  x2="15" y2="19" />
            <line x1="18" y1="8"  x2="18" y2="16" />
            <line x1="21" y1="12" x2="21" y2="12" />
          </svg>
        ) : (
          // Mic icon — idle or recording
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="8"  y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </span>
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function VoiceSession({
  sessionId,
  topic,
  topicContext,
  wordBank,
  initialTurnCount,
}: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [phase, setPhase]             = useState<Phase>('idle');
  const [permission, setPermission]   = useState<MicPermission>('prompt');
  const [turns, setTurns]             = useState<TurnEntry[]>([]);
  const [detectedSet, setDetectedSet] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);
  const [toastMsg, setToastMsg]       = useState<string | null>(null);
  const [turnCount, setTurnCount]     = useState(initialTurnCount);
  const [isEndingSession, setIsEndingSession] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const mediaRecorderRef   = useRef<MediaRecorder | null>(null);
  const chunksRef          = useRef<Blob[]>([]);
  const streamRef          = useRef<MediaStream | null>(null);
  const audioPlayerRef     = useRef<HTMLAudioElement | null>(null);
  const transcriptEndRef   = useRef<HTMLDivElement | null>(null);
  /** Wall-clock timestamp (ms) set at the start of each recording. */
  const recordingStartRef  = useRef<number>(0);
  /** Timer ID for the auto-dismissing toast. */
  const toastTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Stop and release the current TTS audio player ────────────────────────
  // Defined before effects so the cleanup effect can reference it safely.
  // Detaching onended/onerror first is critical — without it, pausing the
  // element fires onerror on some browsers, which would call setPhase('idle')
  // after the user has already transitioned to 'recording'.
  const stopAudio = useCallback(() => {
    const audio = audioPlayerRef.current;
    if (!audio) return;
    audio.onended  = null;  // Detach — prevent a stale setPhase('idle') firing
    audio.onerror  = null;
    audio.pause();
    audio.src = '';          // Releases the data URL reference so GC can reclaim it
    audioPlayerRef.current = null;
  }, []);

  // ── Auto-scroll transcript to bottom on new turns ─────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // ── Clean up media stream + audio + toast timer on unmount ───────────────
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      stopAudio();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [stopAudio]);

  // ── Toast helper (auto-dismisses after TOAST_DURATION_MS) ─────────────────
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), TOAST_DURATION_MS);
  }, []);

  // ── Acquire microphone ─────────────────────────────────────────────────────
  const acquireMic = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) return streamRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission('unavailable');
      setErrorMsg('Your browser does not support microphone access.');
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;
      setPermission('granted');
      return stream;
    } catch (err: unknown) {
      const name = (err instanceof Error) ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setPermission('denied');
        setErrorMsg('Microphone access was denied. Please enable it in your browser settings and refresh.');
      } else if (name === 'NotFoundError') {
        setPermission('unavailable');
        setErrorMsg('No microphone was detected. Please connect one and refresh.');
      } else {
        setPermission('unavailable');
        setErrorMsg('Could not access the microphone. Please check your device settings.');
      }
      return null;
    }
  }, []);

  // ── Start recording (or interrupt playback and start recording) ───────────
  const handlePointerDown = useCallback(async () => {
    // 'processing': Whisper + LLM are in-flight — the network request cannot be
    //   cancelled mid-flight, so block here.
    // 'recording':  Already capturing — a second pointerdown is a no-op.
    if (phase === 'processing' || phase === 'recording') return;

    setErrorMsg(null);
    setToastMsg(null);

    // ── Interrupt active TTS playback ────────────────────────────────────────
    // If the AI is speaking, halt it immediately so recording starts without
    // delay. stopAudio() detaches event handlers first to prevent a stale
    // setPhase('idle') from firing after we've already moved to 'recording'.
    if (phase === 'playing') {
      stopAudio();
    }

    const stream = await acquireMic();
    if (!stream) return;

    const mimeType = getPreferredMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      setErrorMsg('MediaRecorder is not supported in this browser.');
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mediaRecorderRef.current = recorder;
    recordingStartRef.current = Date.now(); // stamp the exact start time
    recorder.start(100); // Collect chunks every 100ms
    setPhase('recording');
  }, [phase, acquireMic, stopAudio]);

  // ── Send audio to the turn API ─────────────────────────────────────────────
  // Defined BEFORE handlePointerUp so it is initialised when handlePointerUp's
  // deps array is evaluated (avoids a TDZ ReferenceError on first render).
  const sendAudioBlob = useCallback(async (blob: Blob) => {
    setPhase('processing');

    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');

    let data: TurnResponse;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/turn`, {
        method: 'POST',
        body:   formData,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `API error ${res.status}`);
      }

      data = await res.json() as TurnResponse;
    } catch (err: unknown) {
      const msg = (err instanceof Error) ? err.message : 'Network error. Please try again.';
      setErrorMsg(msg);
      setPhase('idle');
      return;
    }

    // ── Append both turns to the transcript ───────────────────────────────
    // audio_url is played once and then discarded — we never store it in state
    // to avoid accumulating megabytes of base64 over a long session.
    setTurns((prev) => [
      ...prev,
      { role: 'user',      text: data.transcript, turnIndex: data.turn_index },
      { role: 'assistant', text: data.reply_text,  turnIndex: data.turn_index },
    ]);

    // ── Mark detected words ───────────────────────────────────────────────
    if (data.detected_words.length > 0) {
      setDetectedSet((prev) => {
        const next = new Set(prev);
        data.detected_words.forEach((w) => next.add(w.toLowerCase()));
        return next;
      });
    }

    setTurnCount(data.turn_index);

    // ── Play TTS audio if provided, otherwise return to idle immediately ──
    if (data.audio_url) {
      setPhase('playing');
      const audio = new Audio(data.audio_url);
      audioPlayerRef.current = audio;

      // Single cleanup handler — runs on natural end, error, or play() rejection.
      // Clears src so the browser can release the data URL from memory.
      const onDone = () => {
        audio.src = '';
        audioPlayerRef.current = null;
        setPhase('idle');
      };
      audio.onended = onDone;
      audio.onerror = onDone;
      audio.play().catch(onDone);
    } else {
      setPhase('idle');
    }
  }, [sessionId]);

  // ── Stop recording and conditionally send ─────────────────────────────────
  const handlePointerUp = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    const elapsed = Date.now() - recordingStartRef.current;

    if (elapsed < MIN_RECORDING_MS) {
      // Recording is too short — stop the recorder, discard all chunks, and
      // return to idle without touching the API. Show a brief toast hint.
      recorder.onstop = () => {
        chunksRef.current = []; // discard — nothing is sent
      };
      recorder.stop();
      setPhase('idle');
      showToast(`Hold for at least ${MIN_RECORDING_MS / 1000}s — try again`);
      return;
    }

    // Recording is long enough — stop and send.
    recorder.onstop = async () => {
      const mimeType = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      await sendAudioBlob(blob);
    };

    recorder.stop();
  }, [showToast, sendAudioBlob]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const usedCount  = wordBank.filter((w) => detectedSet.has(w.word.toLowerCase())).length;
  const totalWords = wordBank.length;

  const recordLabel =
    phase === 'recording'        ? 'Release to send'                :
    phase === 'processing'       ? 'Thinking…'                      :
    phase === 'playing'          ? 'Press to interrupt'             :
    permission === 'denied'      ? 'Mic denied — check settings'    :
    permission === 'unavailable' ? 'No microphone found'            :
    'Hold to speak';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-dvh flex flex-col"
      style={{ background: 'var(--color-codex-bg)', color: 'var(--color-codex-text)' }}
    >
      {/* ── Top navigation bar ── */}
      <header
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-codex-border)', background: 'var(--color-codex-surface)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="category-tag flex-shrink-0"
            style={{
              background: 'color-mix(in srgb, var(--color-codex-gold) 12%, transparent)',
              color: 'var(--color-codex-gold)',
            }}
          >
            LIVE
          </span>
          <h1
            className="font-display text-lg md:text-xl leading-tight truncate"
            style={{ color: 'var(--color-codex-text)' }}
            title={topic}
          >
            {topic}
          </h1>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="text-xs hidden sm:block"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            Turn {turnCount}
          </span>
          <form action={abandonSession.bind(null, sessionId)}>
            <button type="submit" className="btn-ghost text-xs">
              ✕ End
            </button>
          </form>
        </div>
      </header>

      {/* ── Main two-column layout (stacked on mobile) ── */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden">

        {/* ── LEFT: Transcript feed ── */}
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">

          {/* Transcript scroll area */}
          <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-3">
            {turns.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                <p
                  className="font-display text-3xl md:text-4xl mb-3 opacity-20"
                  style={{ color: 'var(--color-codex-gold)' }}
                >
                  ◌
                </p>
                <p
                  className="font-display text-xl mb-2"
                  style={{ color: 'var(--color-codex-text)' }}
                >
                  Ready to begin
                </p>
                {topicContext && (
                  <p
                    className="text-sm max-w-sm leading-relaxed"
                    style={{ color: 'var(--color-codex-muted)' }}
                  >
                    {topicContext}
                  </p>
                )}
                <p
                  className="text-xs mt-4 uppercase tracking-widest"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
                >
                  Hold the button below to start speaking
                </p>
              </div>
            ) : (
              turns.map((turn, i) => <TurnBubble key={i} turn={turn} />)
            )}

            {/* Thinking indicator overlaid when processing */}
            {phase === 'processing' && <ThinkingIndicator />}

            <div ref={transcriptEndRef} />
          </div>

          {/* ── Persistent error banner (API / mic errors) ── */}
          {errorMsg && (
            <div
              className="mx-4 mb-3 flex items-start gap-2 px-4 py-3 rounded text-sm"
              style={{
                color: '#F87171',
                background: 'color-mix(in srgb, #F87171 8%, transparent)',
                border: '1px solid color-mix(in srgb, #F87171 25%, transparent)',
              }}
            >
              <span className="flex-shrink-0 mt-px">⚠</span>
              <span>{errorMsg}</span>
              <button
                type="button"
                className="ml-auto flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                onClick={() => setErrorMsg(null)}
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}

          {/* ── Record control area ── */}
          <div
            className="flex-shrink-0 flex flex-col items-center gap-3 px-4 pt-4 pb-6"
            style={{ borderTop: '1px solid var(--color-codex-border)' }}
          >
            {/* Phase label */}
            <p
              className="text-xs uppercase tracking-widest h-4"
              style={{
                fontFamily: 'var(--font-mono)',
                color:
                  phase === 'recording'  ? '#F87171' :
                  phase === 'processing' || phase === 'playing' ? 'var(--color-codex-teal)' :
                  permission === 'denied' ? '#F87171' :
                  'var(--color-codex-faint)',
              }}
            >
              {recordLabel}
            </p>

            {/* The big mic button */}
            <RecordButton
              phase={phase}
              permission={permission}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />

            {/* ── Transient toast: recording-too-short hint ── */}
            {/* Separate from errorMsg — auto-dismisses, amber colour, no X button. */}
            {toastMsg && (
              <p
                className="text-xs text-center px-3 py-1.5 rounded"
                role="status"
                aria-live="polite"
                style={{
                  fontFamily:  'var(--font-mono)',
                  color:       'var(--color-codex-gold)',
                  background:  'color-mix(in srgb, var(--color-codex-gold) 10%, transparent)',
                  border:      '1px solid color-mix(in srgb, var(--color-codex-gold) 25%, transparent)',
                }}
              >
                {toastMsg}
              </p>
            )}

            {/* Mic permission help */}
            {permission === 'denied' && (
              <p
                className="text-xs text-center max-w-xs"
                style={{ color: 'var(--color-codex-muted)' }}
              >
                Enable microphone access in your browser&apos;s site settings, then refresh the page.
              </p>
            )}

            {/* End session button */}
            <form
              action={async () => {
                setIsEndingSession(true);
                await completeSession(sessionId);
              }}
            >
              <button
                type="submit"
                className="btn-ghost text-xs"
                disabled={isEndingSession || phase !== 'idle'}
              >
                {isEndingSession ? '…Saving session' : '✓ Complete Session'}
              </button>
            </form>
          </div>
        </main>

        {/* ── RIGHT: Word tracker panel ── */}
        <aside
          className="lg:w-72 xl:w-80 flex-shrink-0 flex flex-col border-t lg:border-t-0 lg:border-l overflow-hidden"
          style={{ borderColor: 'var(--color-codex-border)', background: 'var(--color-codex-surface)' }}
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--color-codex-border)' }}
          >
            <p
              className="text-xs uppercase tracking-widest"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
            >
              Target Words
            </p>
            <span
              className="text-xs tabular-nums"
              style={{
                fontFamily: 'var(--font-mono)',
                color: usedCount > 0 ? 'var(--color-status-mastered)' : 'var(--color-codex-faint)',
              }}
            >
              {usedCount}/{totalWords} used
            </span>
          </div>

          {/* Word list — scrollable */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {wordBank.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm" style={{ color: 'var(--color-codex-muted)' }}>
                  No words in your bank yet.
                </p>
                <Link
                  href="/words"
                  className="text-xs mt-2 inline-block"
                  style={{ color: 'var(--color-codex-gold)', fontFamily: 'var(--font-mono)' }}
                >
                  Add words →
                </Link>
              </div>
            ) : (
              wordBank.map((word) => (
                <WordPill
                  key={word.id}
                  word={word}
                  detected={detectedSet.has(word.word.toLowerCase())}
                />
              ))
            )}
          </div>

          {/* Progress bar */}
          {totalWords > 0 && (
            <div
              className="flex-shrink-0 px-4 py-3"
              style={{ borderTop: '1px solid var(--color-codex-border)' }}
            >
              <div
                className="w-full h-1 rounded-full overflow-hidden"
                style={{ background: 'var(--color-codex-border)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width:      `${(usedCount / totalWords) * 100}%`,
                    background: 'var(--color-status-mastered)',
                  }}
                />
              </div>
              <p
                className="text-xs mt-1.5 text-right"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)' }}
              >
                {Math.round((usedCount / totalWords) * 100)}% coverage
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
