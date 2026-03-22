/**
 * src/app/session/[id]/summary/_components/EvaluationResults.tsx
 *
 * Displays per-word semantic evaluation results from the LLM evaluator.
 * Shows aggregate credit bar + individual word cards with label, confidence,
 * diagnostic, and learner feedback.
 */

import type { SemanticEvaluationRow, SessionWordRow } from '@/lib/supabase/types';

interface Props {
  evaluations: (SemanticEvaluationRow & { word_text: string })[];
  sessionWords: (SessionWordRow & { word_text: string })[];
}

const LABEL_CONFIG: Record<string, { text: string; color: string }> = {
  used_correct:          { text: 'Correct',           color: 'var(--color-status-mastered)' },
  used_partially_correct:{ text: 'Partially Correct', color: 'var(--color-codex-gold)' },
  used_incorrect:        { text: 'Incorrect',         color: '#F87171' },
  mentioned_not_used:    { text: 'Mentioned Only',    color: 'var(--color-codex-muted)' },
  not_used_false_positive:{ text: 'Not Used',         color: 'var(--color-codex-faint)' },
  ambiguous:             { text: 'Ambiguous',         color: 'var(--color-codex-faint)' },
};

export default function EvaluationResults({ evaluations, sessionWords }: Props) {
  const credited = evaluations.filter((e) => e.credited).length;
  const total    = sessionWords.length;

  // Build a map: word_id → best evaluation (latest by turn_index)
  const evalsByWord = new Map<string, (SemanticEvaluationRow & { word_text: string })>();
  for (const e of evaluations) {
    const existing = evalsByWord.get(e.word_id);
    if (!existing || e.turn_index > existing.turn_index) {
      evalsByWord.set(e.word_id, e);
    }
  }

  return (
    <section className="animate-fade-up animate-fade-up-delay-1">
      <p
        className="text-xs uppercase tracking-widest mb-4"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
      >
        Evaluation Results
      </p>

      {/* Aggregate progress bar */}
      {total > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span
              className="text-xs"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-muted)' }}
            >
              Words credited
            </span>
            <span
              className="text-xs tabular-nums"
              style={{
                fontFamily: 'var(--font-mono)',
                color: credited > 0 ? 'var(--color-status-mastered)' : 'var(--color-codex-faint)',
              }}
            >
              {credited}/{total}
            </span>
          </div>
          <div
            className="w-full h-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--color-codex-border)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${total > 0 ? (credited / total) * 100 : 0}%`,
                background: 'var(--color-status-mastered)',
              }}
            />
          </div>
        </div>
      )}

      {/* Per-word cards */}
      {sessionWords.length === 0 ? (
        <p
          className="text-sm py-6 text-center"
          style={{ color: 'var(--color-codex-muted)' }}
        >
          No target words were assigned to this session.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {sessionWords.map((sw) => {
            const evaluation = evalsByWord.get(sw.word_id);
            const labelCfg = evaluation
              ? LABEL_CONFIG[evaluation.label] ?? { text: evaluation.label, color: 'var(--color-codex-muted)' }
              : null;

            return (
              <div
                key={sw.id}
                className="card px-4 py-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className="font-display text-lg"
                    style={{ color: 'var(--color-codex-text)' }}
                  >
                    {sw.word_text}
                  </span>
                  {labelCfg ? (
                    <span
                      className="category-tag"
                      style={{
                        background: `color-mix(in srgb, ${labelCfg.color} 15%, transparent)`,
                        color: labelCfg.color,
                      }}
                    >
                      {labelCfg.text}
                    </span>
                  ) : (
                    <span
                      className="category-tag"
                      style={{
                        background: 'color-mix(in srgb, var(--color-codex-faint) 15%, transparent)',
                        color: 'var(--color-codex-faint)',
                      }}
                    >
                      Pending…
                    </span>
                  )}
                </div>

                {evaluation && (
                  <>
                    {/* Confidence bar */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="text-xs flex-shrink-0"
                        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)', width: '5rem' }}
                      >
                        Confidence
                      </span>
                      <div
                        className="flex-1 h-1 rounded-full overflow-hidden"
                        style={{ background: 'var(--color-codex-border)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${evaluation.confidence_score * 100}%`,
                            background: labelCfg?.color ?? 'var(--color-codex-muted)',
                          }}
                        />
                      </div>
                      <span
                        className="text-xs tabular-nums flex-shrink-0"
                        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-codex-faint)', width: '2.5rem', textAlign: 'right' }}
                      >
                        {Math.round(evaluation.confidence_score * 100)}%
                      </span>
                    </div>

                    {/* Diagnostic */}
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: 'var(--color-codex-muted)' }}
                    >
                      {evaluation.diagnostic}
                    </p>

                    {/* Learner feedback */}
                    {evaluation.learner_feedback && (
                      <p
                        className="text-sm mt-1 leading-relaxed"
                        style={{ color: 'var(--color-codex-text)', fontStyle: 'italic' }}
                      >
                        {evaluation.learner_feedback}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
