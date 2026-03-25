-- =============================================================================
-- Migration 013 — Update process_evaluation_result to mark session_words.used
-- =============================================================================
-- Problem: When the semantic worker credits a word (p_should_credit = true),
-- the session_words row for that word is not marked as used. The summary page
-- reads session_words.used to display per-word evaluation cards, so all words
-- appear as unused regardless of actual evaluation outcomes.
--
-- Fix: Add a final UPDATE step to the RPC that sets session_words.used = true
-- and session_words.used_at = now() when p_should_credit = true.
-- If the session_words row does not exist (sessions created before Sprint 9),
-- the UPDATE affects 0 rows — this is a safe no-op.
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

  -- ── Step 6: Update word_mastery ───────────────────────────────────────
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
         next_review_at   = CASE
           WHEN v_new_stability > 0 THEN
             now() + (v_new_stability * 0.1 * interval '1 day')
           ELSE
             now() + interval '1 hour'
           END
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
