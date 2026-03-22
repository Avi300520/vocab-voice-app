'use client';

/**
 * src/app/onboarding/diagnostic/[sessionId]/_components/DiagnosticSession.tsx
 *
 * Voice-based proficiency assessment interface.
 *
 * State machine: idle → recording → processing → playing → idle
 * (identical push-to-talk core to VoiceSession, without word-bank machinery)
 *
 * After minTurns exchanges the "Finish Assessment" button activates.
 * On finalize: calls the /finalize API → receives 10 target words → redirects
 * the user to /words where they can see their personalised vocabulary list.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_RECORDING_MS = 1000;
const TOAST_DURATION_MS = 2200;
const API_TIMEOUT_MS = 20_000;

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'recording' | 'processing' | 'playing';
type MicPermission = 'prompt' | 'granted' | 'denied' | 'unavailable';

interface TurnEntry {
  role:      'user' | 'assistant';
  text:      string;
  turnIndex: number;
}

interface DiagnosticTurnResponse {
  turn_index:  number;
  transcript:  string;
  reply_text:  string;
  audio_url:   string | null;
}

interface RecommendedWord {
  word:       string;
  definition: string;
  example:    string;
}

interface FinalizeResponse {
  words: RecommendedWord[];
}

interface Props {
  sessionId: string;
  minTurns:  number;
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
                border:     '1px solid color-mix(in srgb, var(--color-codex-gold) 30%, transparent)',
                color:      'var(--color-codex-text)',
              }
            : {
                background: 'var(--color-codex-surface)',
                border:     '1px solid var(--color-codex-border)',
                color:      'var(--color-codex-text)',
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
          {isUser ? 'You' : 'Assessor'} · Turn {turn.turnIndex}
        </p>
        <p>{turn.text}</p>
      </div>
    </div>
  );
}

function WordPreviewCard({ word }: { word: RecommendedWord }) {
  return (
    <div
      className="card p-4 flex flex-col gap-1.5 animate-fade-up"
    >
      <p
        className="font-display text-xl leading-tight"
        style={{ color: 'var(--color-codex-text)' }}
      >
        {word.word}
      </p>
      <p className="text-sm" style={{ color: 'var(--color-codex-muted)' }}>
        {word.definition}
      </p>
      <p
        className="text-xs italic"
        style={{ color: 'var(--color-codex-faint)', fontFamily: 'var(--font-display)' }}
      >
        "{word.example}"
      </p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DiagnosticSession({ sessionId, minTurns }: Props) {
  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────────────
  const [phase, setPhaseState]      = useState<Phase>('idle');
  const [permission, setPermission] = useState<MicPermission>('prompt');
  const [turns, setTurns]           = useState<TurnEntry[]>([]);
  const [turnCount, setTurnCount]   = useState(0);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [toastMsg, setToastMsg]     = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [wordList, setWordList]     = useState<RecommendedWord[] | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef         = useRef<Blob[]>([]);
  const streamRef         = useRef<MediaStream | null>(null);
  const audioPlayerRef    = useRef<HTMLAudioElement | null>(null);
  const transcriptEndRef  = useRef<HTMLDivElement | null>(null);
  const recordingStartRef = useRef<number>(0);
  const toastTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef          = useRef<Phase>('idle');
  const pointerIsDownRef  = useRef(false);

  // ── Stable phase setter ───────────────────────────────────────────────────
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  // ── Stop TTS audio ────────────────────────────────────────────────────────
  const stopAudio = useCallback(() => {
    const audio = audioPlayerRef.current;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = '';
    audioPlayerRef.current = null;
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      stopAudio();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [stopAudio]);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), TOAST_DURATION_MS);
  }, []);

  // ── Acquire microphone ────────────────────────────────────────────────────
  const acquireMic = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) return streamRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission('unavailable');
      setErrorMsg('Your browser does not support microphone access.');
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });
      streamRef.current = stream;
      setPermission('granted');
      return stream;
    } catch (err: unknown) {
      const name = (err instanceof Error) ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setPermission('denied');
        setErrorMsg('Microphone access was denied. Enable it in browser settings and refresh.');
      } else if (name === 'NotFoundError') {
        setPermission('unavailable');
        setErrorMsg('No microphone detected. Connect one and refresh.');
      } else {
        setPermission('unavailable');
        setErrorMsg('Could not access the microphone. Check your device settings.');
      }
      return null;
    }
  }, []);

  // ── Send audio to diagnostic turn API ────────────────────────────────────
  const sendAudioBlob = useCallback(async (blob: Blob) => {
    setPhase('processing');

    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let data: DiagnosticTurnResponse;
    try {
      const res = await fetch(
        `/api/onboarding/diagnostic/${sessionId}/turn`,
        { method: 'POST', body: formData, signal: controller.signal },
      );
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `API error ${res.status}`);
      }

      data = await res.json() as DiagnosticTurnResponse;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMsg('Request timed out. Tap the mic to try again.');
      } else {
        setErrorMsg((err instanceof Error) ? err.message : 'Network error. Please try again.');
      }
      setPhase('idle');
      return;
    }

    setTurns((prev) => [
      ...prev,
      { role: 'user',      text: data.transcript, turnIndex: data.turn_index },
      { role: 'assistant', text: data.reply_text,  turnIndex: data.turn_index },
    ]);
    setTurnCount(data.turn_index);

    if (data.audio_url) {
      setPhase('playing');
      const audio = new Audio(data.audio_url);
      audioPlayerRef.current = audio;
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
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pointer down: start recording ────────────────────────────────────────
  const handlePointerDown = useCallback(async () => {
    const currentPhase = phaseRef.current;
    if (currentPhase === 'processing' || currentPhase === 'recording') return;

    const wasPlaying = currentPhase === 'playing';
    pointerIsDownRef.current = true;
    setErrorMsg(null);
    setToastMsg(null);

    if (wasPlaying) stopAudio();

    flushSync(() => setPhase('recording'));

    const stream = await acquireMic();

    if (!stream || (!wasPlaying && !pointerIsDownRef.current)) {
      setPhase('idle');
      return;
    }

    const mimeType = getPreferredMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      setErrorMsg('MediaRecorder is not supported in this browser.');
      setPhase('idle');
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mediaRecorderRef.current = recorder;
    recordingStartRef.current = Date.now();
    recorder.start(100);
  }, [acquireMic, stopAudio, setPhase]);

  // ── Pointer up: stop and send ─────────────────────────────────────────────
  const handlePointerUp = useCallback(() => {
    pointerIsDownRef.current = false;

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    const elapsed = Date.now() - recordingStartRef.current;

    if (elapsed < MIN_RECORDING_MS) {
      recorder.onstop = () => { chunksRef.current = []; };
      recorder.stop();
      setPhase('idle');
      showToast(`Hold for at least ${MIN_RECORDING_MS / 1000}s — try again`);
      return;
    }

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      chunksRef.current = [];
      void sendAudioBlob(blob);
    };
    recorder.stop();
    mediaRecorderRef.current = null;
  }, [showToast, sendAudioBlob]);

  // ── Finalize assessment ───────────────────────────────────────────────────
  const handleFinalize = useCallback(async () => {
    if (finalizing) return;
    setFinalizing(true);
    setErrorMsg(null);

    try {
      const res = await fetch(
        `/api/onboarding/diagnostic/${sessionId}/finalize`,
        { method: 'POST' },
      );

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `Server error ${res.status}`);
      }

      const data = await res.json() as FinalizeResponse;
      setWordList(data.words);
    } catch (err) {
      setErrorMsg((err instanceof Error) ? err.message : 'Failed to generate word list. Please try again.');
      setFinalizing(false);
    }
  }, [sessionId, finalizing]);

  const isRecording  = phase === 'recording';
  const isProcessing = phase === 'processing';
  const isPlaying    = phase === 'playing';
  const isDisabled   = isProcessing || permission === 'denied' || permission === 'unavailable';
  const canFinish    = turnCount >= minTurns && phase === 'idle' && !finalizing && !wordList;

  const recordLabel =
    isRecording  ? '● Recording' :
    isProcessing ? 'Processing…' :
    isPlaying    ? 'Press to interrupt' :
    permission === 'denied' ? 'Mic denied' :
    'Hold to speak';

  // ── Word list result view ─────────────────────────────────────────────────
  if (wordList) {
    return (
      <main
        className="min-h-dvh px-4 py-8 md:px-6 md:py-10 max-w-2xl mx-auto w-full"
        style={{ color: 'var(--color-codex-text)' }}
      >
        <p
          className="text-xs uppercase tracking-widest mb-2 animate-fade-up"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-teal)' }}
        >
          ✓ Assessment complete
        </p>
        <h1
          className="font-display text-4xl mb-2 animate-fade-up"
          style={{ color: 'var(--color-codex-text)' }}
        >
          Your Vocabulary List
        </h1>
        <p
          className="text-sm mb-8 animate-fade-up animate-fade-up-delay-1"
          style={{ color: 'var(--color-codex-muted)' }}
        >
          {wordList.length} words selected based on your proficiency and professional background.
          They've been added to your Word Bank.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
          {wordList.map((w) => (
            <WordPreviewCard key={w.word} word={w} />
          ))}
        </div>

        <button
          onClick={() => router.push('/words')}
          className="btn-primary"
        >
          View My Word Bank →
        </button>
      </main>
    );
  }

  // ── Live assessment view ──────────────────────────────────────────────────
  return (
    <main
      className="min-h-dvh flex flex-col px-4 py-6 md:px-6 max-w-2xl mx-auto w-full"
      style={{ color: 'var(--color-codex-text)' }}
    >
      {/* ── Header ── */}
      <header className="flex items-center justify-between mb-6 animate-fade-up">
        <div>
          <p
            className="text-xs uppercase tracking-widest"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
          >
            Voice Assessment
          </p>
          <h1
            className="font-display text-2xl"
            style={{ color: 'var(--color-codex-text)' }}
          >
            Proficiency Diagnostic
          </h1>
        </div>
        <div
          className="text-xs text-right"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          <p>Turn {turnCount}</p>
          {turnCount < minTurns && (
            <p style={{ color: 'var(--color-codex-faint)' }}>
              {minTurns - turnCount} more to finish
            </p>
          )}
        </div>
      </header>

      <div className="divider mb-6" />

      {/* ── Transcript ── */}
      <section className="flex-1 overflow-y-auto mb-6">
        {turns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center animate-fade-up">
            <p
              className="font-display text-xl mb-2"
              style={{ color: 'var(--color-codex-muted)' }}
            >
              Ready when you are
            </p>
            <p className="text-sm" style={{ color: 'var(--color-codex-faint)' }}>
              Hold the mic and introduce yourself — tell the assessor about your work.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {turns.map((t, i) => <TurnBubble key={i} turn={t} />)}
            {isProcessing && (
              <div className="flex justify-start animate-fade-up">
                <div
                  className="px-4 py-3 rounded text-sm"
                  style={{ background: 'var(--color-codex-surface)', border: '1px solid var(--color-codex-border)', color: 'var(--color-codex-muted)' }}
                >
                  <span className="animate-pulse">Assessor is thinking…</span>
                </div>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </section>

      {/* ── Error / Toast ── */}
      {errorMsg && (
        <div
          className="mb-4 px-3 py-2 rounded text-sm"
          style={{
            color: '#F87171',
            background: 'color-mix(in srgb, #F87171 8%, transparent)',
            border: '1px solid color-mix(in srgb, #F87171 20%, transparent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ✗ {errorMsg}
          <button
            onClick={() => setErrorMsg(null)}
            className="ml-2 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {toastMsg && (
        <div
          className="mb-4 px-3 py-2 rounded text-sm text-center"
          style={{
            color: 'var(--color-codex-muted)',
            background: 'var(--color-codex-surface)',
            border: '1px solid var(--color-codex-border)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {toastMsg}
        </div>
      )}

      {/* ── Mic button area ── */}
      <div className="flex flex-col items-center gap-4 py-4 animate-fade-up">
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          disabled={isDisabled || finalizing}
          aria-label={recordLabel}
          className="record-button"
          data-recording={isRecording}
          data-processing={isProcessing}
          data-playing={isPlaying}
          style={{ touchAction: 'none' }}
        >
          {(isRecording || isPlaying) && (
            <span
              className="record-ring"
              style={isPlaying ? { borderColor: 'var(--color-codex-teal)', animationDuration: '1.4s' } : undefined}
            />
          )}
          <span className="record-icon">
            {isProcessing ? (
              <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : isPlaying ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                <line x1="6" y1="8" x2="6" y2="16" />
                <line x1="9" y1="5" x2="9" y2="19" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="15" y1="5" x2="15" y2="19" />
                <line x1="18" y1="8" x2="18" y2="16" />
              </svg>
            ) : isRecording ? (
              <svg className="recording-dot" width="32" height="32" viewBox="0 0 24 24" fill="#F87171">
                <circle cx="12" cy="12" r="8" />
              </svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="8"  y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </span>
        </button>

        <p
          className="phase-label"
          data-phase={phase}
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {recordLabel}
        </p>

        {/* ── Finish button ── */}
        <button
          onClick={handleFinalize}
          disabled={!canFinish}
          className={canFinish ? 'btn-primary' : 'btn-ghost'}
          style={{
            opacity: canFinish ? 1 : 0.4,
            cursor: canFinish ? 'pointer' : 'not-allowed',
            marginTop: '0.5rem',
          }}
        >
          {finalizing ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Generating your words…
            </span>
          ) : (
            `Finish Assessment${turnCount < minTurns ? ` (${minTurns - turnCount} more turns)` : ''}`
          )}
        </button>
      </div>
    </main>
  );
}
