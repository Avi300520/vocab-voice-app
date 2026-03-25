-- =============================================================================
-- Migration 005 — Atomic enqueue + word-level timestamps
-- =============================================================================
-- How to apply:
-- 1. Run migration 004 FIRST (enables pgmq and creates the queue).
-- 2. Open Supabase Dashboard → SQL Editor → New Query.
-- 3. Paste this entire file and click "Run".
--
-- What this does:
-- a) Adds a `word_timestamps` JSONB column to `session_messages` for storing
--    Whisper word-level timestamp arrays (Audio Vault strategy).
-- b) Replaces `insert_session_turn` to accept the new timestamps parameter
--    AND atomically enqueue a semantic evaluation job via pgmq.send()
--    within the same transaction.
--
-- Atomicity guarantee:
--   "turn existence" and "job existence" are a single commit.
--   If the transaction rolls back, neither the turn NOR the job persist.
-- =============================================================================

-- ── 1. Add word_timestamps JSONB column to session_messages ────────────────────
ALTER TABLE public.session_messages
  ADD COLUMN IF NOT EXISTS word_timestamps JSONB;

-- ── 2. Replace insert_session_turn with atomic enqueue ─────────────────────────
-- Drop previous signature (idempotent re-run safety).
DROP FUNCTION IF EXISTS insert_session_turn(uuid, uuid, text, text, text[]);

CREATE FUNCTION insert_session_turn(
  p_session_id      UUID,
  p_user_id         UUID,
  p_transcript      TEXT,
  p_reply_text      TEXT,
  p_detected_words  TEXT[],
  p_word_timestamps JSONB DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_turn_index INTEGER;
BEGIN

  -- ── 1. Serialize concurrent writes for this session ──────────────────────
  -- Lock the session row for the duration of this transaction.
  -- Two concurrent requests for the SAME session serialize here;
  -- requests for DIFFERENT sessions never block each other.
  PERFORM s.id
    FROM sessions s
   WHERE s.id = p_session_id
     FOR UPDATE;

  -- If no row was found (wrong user or invalid ID), abort immediately so we
  -- don't insert orphaned messages.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found: session % not accessible', p_session_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 2. Compute authoritative next turn_index ────────────────────────────
  -- This runs AFTER acquiring the lock, so no concurrent transaction for the
  -- same session can observe the same MAX value.
  SELECT COALESCE(MAX(sm.turn_index), 0) + 1
    INTO v_turn_index
    FROM session_messages sm
   WHERE sm.session_id = p_session_id;

  -- ── 3. Persist user message (with word-level timestamps) ────────────────
  INSERT INTO session_messages
    (session_id, user_id, role, content, turn_index, detected_words, word_timestamps)
  VALUES
    (p_session_id, p_user_id, 'user', p_transcript, v_turn_index, p_detected_words, p_word_timestamps);

  -- ── 4. Persist assistant message (same turn — they share a round) ───────
  INSERT INTO session_messages
    (session_id, user_id, role, content, turn_index)
  VALUES
    (p_session_id, p_user_id, 'assistant', p_reply_text, v_turn_index);

  -- ── 5. Keep sessions.turn_count consistent ──────────────────────────────
  UPDATE sessions
     SET turn_count = v_turn_index
   WHERE id = p_session_id;

  -- ── 6. ATOMIC ENQUEUE — pgmq.send() inside same transaction ─────────────
  -- If this transaction commits, the job is guaranteed to exist.
  -- If it rolls back, neither the turn nor the job persist.
  PERFORM pgmq.send(
    'semantic_evaluation_queue',
    jsonb_build_object(
      'session_id',  p_session_id,
      'user_id',     p_user_id,
      'turn_index',  v_turn_index,
      'transcript',  p_transcript,
      'enqueued_at', now()
    )
  );

  RETURN v_turn_index;

END;
$$;

-- Grant execute to the roles used by Supabase client connections.
-- New signature includes the optional JSONB parameter.
GRANT EXECUTE ON FUNCTION insert_session_turn(uuid, uuid, text, text, text[], jsonb)
  TO authenticated, anon;
