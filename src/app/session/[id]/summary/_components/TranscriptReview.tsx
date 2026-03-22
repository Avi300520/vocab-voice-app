/**
 * src/app/session/[id]/summary/_components/TranscriptReview.tsx
 *
 * Full conversation transcript with detected words highlighted in user messages.
 * Reuses the TurnBubble visual pattern from VoiceSession.
 */

import type { SessionMessageRow } from '@/lib/supabase/types';

interface Props {
  messages: SessionMessageRow[];
}

/** Highlight detected words in a message by wrapping them in styled spans. */
function highlightWords(text: string, detectedWords: string[]): React.ReactNode {
  if (detectedWords.length === 0) return text;

  // Build a regex that matches any detected word (case-insensitive, word boundary)
  const escaped = detectedWords.map((w) =>
    w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span
        key={match.index}
        style={{
          color: 'var(--color-status-mastered)',
          fontWeight: 600,
          borderBottom: '1px solid color-mix(in srgb, var(--color-status-mastered) 40%, transparent)',
        }}
      >
        {match[0]}
      </span>,
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export default function TranscriptReview({ messages }: Props) {
  // Filter to user + assistant messages only (skip system)
  const turns = messages.filter((m) => m.role !== 'system');

  if (turns.length === 0) {
    return (
      <section className="animate-fade-up animate-fade-up-delay-2">
        <p
          className="text-xs uppercase tracking-widest mb-4"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
        >
          Transcript
        </p>
        <p className="text-sm py-6 text-center" style={{ color: 'var(--color-codex-muted)' }}>
          No messages in this session.
        </p>
      </section>
    );
  }

  return (
    <section className="animate-fade-up animate-fade-up-delay-2">
      <p
        className="text-xs uppercase tracking-widest mb-4"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
      >
        Transcript
      </p>

      <div
        className="flex flex-col gap-3 max-h-[28rem] overflow-y-auto rounded p-3"
        style={{
          background: 'var(--color-codex-bg)',
          border: '1px solid var(--color-codex-border)',
        }}
      >
        {turns.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            >
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
                  {isUser ? 'You' : 'AI Interlocutor'} · Turn {msg.turn_index}
                </p>
                <p>
                  {isUser
                    ? highlightWords(msg.content, msg.detected_words ?? [])
                    : msg.content}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
