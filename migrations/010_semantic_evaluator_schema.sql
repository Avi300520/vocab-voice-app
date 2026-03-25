-- =============================================================================
-- Migration 010 — Semantic evaluator schema (Sprint 6b)
-- =============================================================================
-- How to apply:
-- 1. Ensure migrations 002-007 have been applied.
-- 2. Run via Supabase MCP apply_migration or SQL Editor.
--
-- What this does:
-- a) Creates evaluation_label and mastery_state enum types.
-- b) Creates semantic_evaluations table (immutable LLM verdict ledger).
-- c) Creates word_mastery table (FSRS spaced-repetition state).
-- d) Enables RLS with owner-scoped read-only policies on both tables.
-- e) Creates the process_evaluation_result SECURITY DEFINER RPC.
-- f) Adds an updated_at trigger on word_mastery.
-- =============================================================================

-- ── 1. Enum types ───────────────────────────────────────────────────────────

CREATE TYPE public.evaluation_label AS ENUM (
  'used_correct',
  'used_partially_correct',
  'used_incorrect',
  'mentioned_not_used',
  'not_used_false_positive',
  'ambiguous'
);

CREATE TYPE public.mastery_state AS ENUM (
  'passive',
  'practicing',
  'stable',
  'mastered',
  'needs_review'
);

-- ── 2. semantic_evaluations table ───────────────────────────────────────────

CREATE TABLE public.semantic_evaluations (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID          NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  turn_index        INT           NOT NULL,
  word_id           UUID          NOT NULL REFERENCES public.words(id) ON DELETE CASCADE,
  user_id           UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label             public.evaluation_label NOT NULL,
  confidence_score  NUMERIC       NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  credited          BOOLEAN       NOT NULL,
  evidence_used     TEXT          NOT NULL,
  diagnostic        TEXT          NOT NULL,
  learner_feedback  TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Idempotency: one evaluation per word per turn per user per session.
  -- Spec says UNIQUE(user_id, session_id, turn_index), but a single turn can
  -- contain multiple target words, so word_id is included as the 4th part.
  CONSTRAINT semantic_evaluations_idempotent
    UNIQUE (user_id, session_id, turn_index, word_id)
);

CREATE INDEX idx_semantic_evaluations_session
  ON public.semantic_evaluations (session_id, turn_index);
CREATE INDEX idx_semantic_evaluations_user_word
  ON public.semantic_evaluations (user_id, word_id);

-- ── 3. word_mastery table (FSRS spaced repetition) ──────────────────────────

CREATE TABLE public.word_mastery (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  word_id          UUID          NOT NULL REFERENCES public.words(id) ON DELETE CASCADE,
  state            public.mastery_state NOT NULL DEFAULT 'passive',
  stability        NUMERIC       NOT NULL DEFAULT 0,
  difficulty       NUMERIC       NOT NULL DEFAULT 0.3
                                 CHECK (difficulty >= 0 AND difficulty <= 1),
  retrievability   NUMERIC       NOT NULL DEFAULT 0,
  success_count    INT           NOT NULL DEFAULT 0,
  fail_count       INT           NOT NULL DEFAULT 0,
  last_reviewed_at TIMESTAMPTZ,
  next_review_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT word_mastery_user_word_unique UNIQUE (user_id, word_id)
);

CREATE INDEX idx_word_mastery_user_state
  ON public.word_mastery (user_id, state);
CREATE INDEX idx_word_mastery_next_review
  ON public.word_mastery (user_id, next_review_at NULLS FIRST);

-- ── 4. updated_at trigger ───────────────────────────────────────────────────
-- No existing set_updated_at function in the codebase — create it here.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_word_mastery_updated_at
  BEFORE UPDATE ON public.word_mastery
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. RLS policies ────────────────────────────────────────────────────────
-- Read-only for authenticated users. All writes go through the
-- SECURITY DEFINER RPC below (invoked by the Edge Function via service_role).

ALTER TABLE public.semantic_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.word_mastery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "semantic_evaluations: owner select"
  ON public.semantic_evaluations FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "word_mastery: owner select"
  ON public.word_mastery FOR SELECT
  USING (user_id = auth.uid());

-- ── 6. process_evaluation_result RPC ────────────────────────────────────────
-- Called exclusively from the semantic-worker Edge Function via service_role.
-- Atomically: inserts evaluation (idempotent), locks word_mastery row,
-- calculates FSRS update, and commits.

CREATE OR REPLACE FUNCTION public.process_evaluation_result(
  p_session_id       UUID,
  p_user_id          UUID,
  p_turn_index       INT,
  p_word_id          UUID,
  p_label            public.evaluation_label,
  p_confidence       NUMERIC,
  p_should_credit    BOOLEAN,
  p_evidence         TEXT,
  p_diagnostic       TEXT,
  p_learner_feedback TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval_id          UUID;
  v_mastery          RECORD;
  v_new_stability    NUMERIC;
  v_new_difficulty   NUMERIC;
  v_new_state        public.mastery_state;
  v_cooldown_active  BOOLEAN := FALSE;
BEGIN
  -- ── Step 1: Idempotent insert into semantic_evaluations ───────────────
  INSERT INTO semantic_evaluations (
    session_id, turn_index, word_id, user_id,
    label, confidence_score, credited,
    evidence_used, diagnostic, learner_feedback
  )
  VALUES (
    p_session_id, p_turn_index, p_word_id, p_user_id,
    p_label, p_confidence, p_should_credit,
    p_evidence, p_diagnostic, p_learner_feedback
  )
  ON CONFLICT (user_id, session_id, turn_index, word_id) DO NOTHING
  RETURNING id INTO v_eval_id;

  -- If ON CONFLICT fired, this is a duplicate — return existing ID (no-op)
  IF v_eval_id IS NULL THEN
    SELECT id INTO v_eval_id
      FROM semantic_evaluations
     WHERE user_id    = p_user_id
       AND session_id = p_session_id
       AND turn_index = p_turn_index
       AND word_id    = p_word_id;
    RETURN v_eval_id;
  END IF;

  -- ── Step 2: Early return for non-creditable labels ────────────────────
  -- These labels have no mastery impact whatsoever.
  IF p_label IN ('mentioned_not_used', 'not_used_false_positive', 'ambiguous')
     AND p_should_credit = FALSE THEN
    RETURN v_eval_id;
  END IF;

  -- ── Step 3: Lock or create word_mastery row ───────────────────────────
  SELECT * INTO v_mastery
    FROM word_mastery
   WHERE user_id = p_user_id AND word_id = p_word_id
     FOR UPDATE;

  IF NOT FOUND THEN
    -- Create initial mastery row; ON CONFLICT handles concurrent insert race
    INSERT INTO word_mastery (user_id, word_id, state)
    VALUES (p_user_id, p_word_id, 'passive')
    ON CONFLICT (user_id, word_id) DO NOTHING
    RETURNING * INTO v_mastery;

    -- Race: another transaction inserted between our SELECT and INSERT
    IF v_mastery IS NULL THEN
      SELECT * INTO v_mastery
        FROM word_mastery
       WHERE user_id = p_user_id AND word_id = p_word_id
         FOR UPDATE;
    END IF;
  END IF;

  -- ── Step 4: 12-hour cooldown check ────────────────────────────────────
  -- Prevents gaming by spamming a word repeatedly in rapid succession.
  IF v_mastery.last_reviewed_at IS NOT NULL
     AND v_mastery.last_reviewed_at + interval '12 hours' > now()
     AND p_should_credit = TRUE THEN
    v_cooldown_active := TRUE;
  END IF;

  -- ── Step 5: FSRS parameter update ────────────────────────────────────
  v_new_stability  := v_mastery.stability;
  v_new_difficulty := v_mastery.difficulty;
  v_new_state      := v_mastery.state;

  IF p_should_credit = TRUE THEN
    -- ── Successful usage ────────────────────────────────────────────────
    IF v_cooldown_active THEN
      -- Minor bump during cooldown (10% of normal)
      v_new_stability := v_mastery.stability + 0.1;
    ELSE
      -- Simplified FSRS-inspired stability increase:
      -- Larger gains for lower difficulty, with diminishing returns as S grows.
      v_new_stability := v_mastery.stability +
        (1.0 + (1.0 - v_mastery.difficulty) * 2.0) *
        GREATEST(1.0 - v_mastery.stability * 0.02, 0.1);
    END IF;

    -- Difficulty decreases on success (bounded 0..1)
    v_new_difficulty := GREATEST(0.0, v_mastery.difficulty - 0.05);

    -- State progression based on stability thresholds (Section 7)
    IF v_new_stability >= 15.0 THEN
      v_new_state := 'mastered';
    ELSIF v_new_stability >= 7.0 THEN
      v_new_state := 'stable';
    ELSIF v_new_stability >= 2.0 THEN
      v_new_state := 'practicing';
    ELSE
      v_new_state := 'passive';
    END IF;

  ELSE
    -- ── Failed usage (used_partially_correct, used_incorrect) ───────────
    v_new_stability  := GREATEST(0.0, v_mastery.stability * 0.5);
    v_new_difficulty := LEAST(1.0, v_mastery.difficulty + 0.1);

    -- If previously stable or mastered, mark for review
    IF v_mastery.state IN ('stable', 'mastered') THEN
      v_new_state := 'needs_review';
    END IF;
    -- If practicing or passive, state stays the same
  END IF;

  -- ── Step 6: Update word_mastery ───────────────────────────────────────
  UPDATE word_mastery
     SET state            = v_new_state,
         stability        = v_new_stability,
         difficulty       = v_new_difficulty,
         retrievability   = 1.0,  -- just reviewed, so R = 1.0
         success_count    = CASE WHEN p_should_credit
                                 THEN v_mastery.success_count + 1
                                 ELSE v_mastery.success_count END,
         fail_count       = CASE WHEN NOT p_should_credit
                                      AND p_label IN ('used_partially_correct', 'used_incorrect')
                                 THEN v_mastery.fail_count + 1
                                 ELSE v_mastery.fail_count END,
         last_reviewed_at = now(),
         next_review_at   = CASE
           WHEN v_new_stability > 0 THEN
             now() + (v_new_stability * 0.1 * interval '1 day')
           ELSE
             now() + interval '1 hour'
           END
   WHERE user_id = p_user_id AND word_id = p_word_id;

  RETURN v_eval_id;
END;
$$;

-- Grant to service_role only (called from Edge Function)
GRANT EXECUTE ON FUNCTION public.process_evaluation_result(
  UUID, UUID, INT, UUID, public.evaluation_label,
  NUMERIC, BOOLEAN, TEXT, TEXT, TEXT
) TO service_role;
