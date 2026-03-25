-- =============================================================================
-- Migration 007 — Fix pgmq permissions for authenticated role
-- =============================================================================
-- Problem:
-- insert_session_turn runs as SECURITY INVOKER, meaning it executes with the
-- calling user's role (authenticated). The authenticated role does not have
-- access to the pgmq schema, causing a "permission denied for schema pgmq"
-- error when pgmq.send() is called directly from within the function.
--
-- Fix:
-- Create a minimal SECURITY DEFINER wrapper (internal_pgmq_send) that runs as
-- the function owner (postgres superuser) and has access to the pgmq schema.
-- The insert_session_turn function calls this wrapper instead of pgmq.send()
-- directly. insert_session_turn remains SECURITY INVOKER to preserve RLS on
-- sessions and session_messages tables.
-- =============================================================================

-- ── 1. Minimal SECURITY DEFINER wrapper for pgmq.send() ──────────────────────
CREATE OR REPLACE FUNCTION public.internal_pgmq_send(
  p_queue_name TEXT,
  p_message    JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_msg_id BIGINT;
BEGIN
  SELECT pgmq.send(p_queue_name, p_message) INTO v_msg_id;
  RETURN v_msg_id;
END;
$$;

-- Grant execute only to authenticated (the role that calls insert_session_turn)
GRANT EXECUTE ON FUNCTION public.internal_pgmq_send(text, jsonb) TO authenticated;

-- ── 2. Update insert_session_turn to use the wrapper ─────────────────────────
-- Drops the existing signature and recreates with the wrapper call.
-- All other logic is unchanged. SECURITY INVOKER is preserved.
DROP FUNCTION IF EXISTS insert_session_turn(uuid, uuid, text, text, text[], jsonb);

CREATE FUNCTION public.insert_session_turn(
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
  PERFORM s.id
    FROM sessions s
   WHERE s.id = p_session_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found: session % not accessible', p_session_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 2. Compute authoritative next turn_index ────────────────────────────
  SELECT COALESCE(MAX(sm.turn_index), 0) + 1
    INTO v_turn_index
    FROM session_messages sm
   WHERE sm.session_id = p_session_id;

  -- ── 3. Persist user message (with word-level timestamps) ────────────────
  INSERT INTO session_messages
    (session_id, user_id, role, content, turn_index, detected_words, word_timestamps)
  VALUES
    (p_session_id, p_user_id, 'user', p_transcript, v_turn_index, p_detected_words, p_word_timestamps);

  -- ── 4. Persist assistant message (same turn) ────────────────────────────
  INSERT INTO session_messages
    (session_id, user_id, role, content, turn_index)
  VALUES
    (p_session_id, p_user_id, 'assistant', p_reply_text, v_turn_index);

  -- ── 5. Keep sessions.turn_count consistent ──────────────────────────────
  UPDATE sessions
     SET turn_count = v_turn_index
   WHERE id = p_session_id;

  -- ── 6. Atomic enqueue via SECURITY DEFINER wrapper ──────────────────────
  -- Calls internal_pgmq_send (SECURITY DEFINER) to bypass pgmq schema
  -- permissions while keeping this function as SECURITY INVOKER for RLS.
  PERFORM public.internal_pgmq_send(
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

GRANT EXECUTE ON FUNCTION public.insert_session_turn(uuid, uuid, text, text, text[], jsonb)
  TO authenticated, anon;
