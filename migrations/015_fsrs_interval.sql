-- =============================================================================
-- Migration 015 — Replace linear interval with FSRS decay formula
-- =============================================================================
-- Problem: The current next_review_at calculation uses a linear approximation
-- (stability * 0.1 days), which bears no relationship to FSRS's retention model.
-- At stability = 10 this schedules review in 1 day; at stability = 30 in 3 days —
-- far too aggressive and not calibrated to the 90% desired-retrievability target.
--
-- Fix: Replace the linear factor with the proper FSRS forgetting-curve formula:
--
--   interval = stability × (R^(1/decay) − 1)
--
-- where:
--   R     = 0.9   (desired retrievability — 90% recall at review time)
--   decay = −0.5  (FSRS v4 power-law decay constant)
--
-- Substituting:
--   0.9^(1/−0.5) − 1  =  0.9^(−2) − 1  =  (1/0.81) − 1  ≈  0.2346
--
-- So:  interval_days = stability × 0.2346
--
-- Examples (vs old formula stability × 0.1):
--   stability  1 →  0.23 days  (5.6 h)     [old: 2.4 h  → clamped to 1 h]
--   stability  5 →  1.17 days              [old: 12 h]
--   stability 10 →  2.35 days              [old: 1 day]
--   stability 20 →  4.69 days              [old: 2 days]
--   stability 50 → 11.73 days              [old: 5 days]
--   stability 100→ 23.46 days              [old: 10 days]
--
-- Constraints:
--   minimum interval : 1 hour   (prevents back-to-back hammering)
--   maximum interval : 180 days (prevents scheduling past half a year)
-- =============================================================================

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
  v_interval_days    NUMERIC;
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
    INSERT INTO word_mastery (user_id, word_id, state)
    VALUES (p_user_id, p_word_id, 'passive')
    ON CONFLICT (user_id, word_id) DO NOTHING
    RETURNING * INTO v_mastery;

    IF v_mastery IS NULL THEN
      SELECT * INTO v_mastery
        FROM word_mastery
       WHERE user_id = p_user_id AND word_id = p_word_id
         FOR UPDATE;
    END IF;
  END IF;

  -- ── Step 4: 12-hour cooldown check ────────────────────────────────────
  IF v_mastery.last_reviewed_at IS NOT NULL
     AND v_mastery.last_reviewed_at + interval '12 hours' > now()
     AND p_should_credit = TRUE THEN
    v_cooldown_active := TRUE;
  END IF;

  -- ── Step 5: FSRS parameter update ─────────────────────────────────────
  v_new_stability  := v_mastery.stability;
  v_new_difficulty := v_mastery.difficulty;
  v_new_state      := v_mastery.state;

  IF p_should_credit = TRUE THEN
    IF v_cooldown_active THEN
      v_new_stability := v_mastery.stability + 0.1;
    ELSE
      v_new_stability := v_mastery.stability +
        (1.0 + (1.0 - v_mastery.difficulty) * 2.0) *
        GREATEST(1.0 - v_mastery.stability * 0.02, 0.1);
    END IF;

    v_new_difficulty := GREATEST(0.0, v_mastery.difficulty - 0.05);

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
    v_new_stability  := GREATEST(0.0, v_mastery.stability * 0.5);
    v_new_difficulty := LEAST(1.0, v_mastery.difficulty + 0.1);

    IF v_mastery.state IN ('stable', 'mastered') THEN
      v_new_state := 'needs_review';
    END IF;
  END IF;

  -- ── Step 6: Update word_mastery (FSRS decay interval) ─────────────────
  -- Formula: interval_days = stability × (0.9^(1/−0.5) − 1)
  --                        = stability × (0.9^(−2) − 1)
  --                        ≈ stability × 0.2346
  -- Clamped: [1 hour, 180 days]
  v_interval_days := GREATEST(
    1.0 / 24.0,        -- minimum: 1 hour
    LEAST(
      180.0,           -- maximum: 180 days
      v_new_stability * 0.2346
    )
  );

  UPDATE word_mastery
     SET state            = v_new_state,
         stability        = v_new_stability,
         difficulty       = v_new_difficulty,
         retrievability   = 1.0,
         success_count    = CASE WHEN p_should_credit
                                 THEN v_mastery.success_count + 1
                                 ELSE v_mastery.success_count END,
         fail_count       = CASE WHEN NOT p_should_credit
                                      AND p_label IN ('used_partially_correct', 'used_incorrect')
                                 THEN v_mastery.fail_count + 1
                                 ELSE v_mastery.fail_count END,
         last_reviewed_at = now(),
         next_review_at   = now() + (v_interval_days * interval '1 day')
   WHERE user_id = p_user_id AND word_id = p_word_id;

  -- ── Step 7: Mark session_words as used (credit only) ──────────────────
  -- Rows created by Sprint 9's createSession action; safe no-op if absent.
  IF p_should_credit = TRUE THEN
    UPDATE session_words
       SET used    = TRUE,
           used_at = now()
     WHERE session_id = p_session_id
       AND word_id    = p_word_id;
  END IF;

  RETURN v_eval_id;
END;
$$;

-- Re-grant to service_role (CREATE OR REPLACE revokes no existing grants,
-- but explicit re-grant documents intent and is idempotent).
GRANT EXECUTE ON FUNCTION public.process_evaluation_result(
  UUID, UUID, INT, UUID, public.evaluation_label,
  NUMERIC, BOOLEAN, TEXT, TEXT, TEXT
) TO service_role;
