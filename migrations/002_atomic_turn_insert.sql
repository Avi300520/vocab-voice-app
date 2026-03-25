-- =============================================================================
-- Migration 002 — Atomic, race-condition-free turn insertion
-- =============================================================================
-- How to apply
-- ────────────
-- 1. Open your Supabase project dashboard.
-- 2. Navigate to: SQL Editor → New Query.
-- 3. Paste this entire file and click "Run".
--
-- What this does
-- ──────────────
-- Creates a single PL/pgSQL function `insert_session_turn` that:
--   a) Acquires a row-level FOR UPDATE lock on the session being written.
--      Two concurrent requests for the SAME session serialize here;
--      requests for DIFFERENT sessions never block each other.
--   b) Computes the next turn_index as MAX(turn_index)+1 from
--      session_messages — inside the same transaction as the lock — so
--      no concurrent request can observe the same MAX value.
--   c) Inserts the user message and the assistant message with that index.
--   d) Bumps sessions.turn_count to keep it in sync.
--   e) Returns the assigned turn_index so the API route can surface it.
--
-- Why "FOR UPDATE on sessions"?
-- ─────────────────────────────
-- Postgres row-level locks (SELECT … FOR UPDATE) are transaction-scoped.
-- Once a transaction acquires the lock on a sessions row, every other
-- transaction that tries to lock the SAME row will block until the first
-- transaction commits or rolls back.  This gives us a cheap, correct mutex
-- per session with zero extra infrastructure.
--
-- Security model
-- ──────────────
-- SECURITY INVOKER — the function runs with the calling user's role.
-- Row Level Security on `sessions` and `session_messages` therefore applies
-- normally: users can only write to rows they own.
-- =============================================================================

-- Drop previous version if it exists (idempotent re-run safety).
DROP FUNCTION IF EXISTS insert_session_turn(uuid, uuid, text, text, text[]);

-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION insert_session_turn(
  p_session_id     UUID,
  p_user_id        UUID,
  p_transcript     TEXT,
  p_reply_text     TEXT,
  p_detected_words TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_turn_index INTEGER;
BEGIN

  -- ── 1. Serialize concurrent writes for this session ────────────────────────
  -- Lock the session row for the duration of this transaction.
  -- Any other call targeting the same session_id will block here until we commit.
  -- Calls targeting different sessions are completely unaffected.
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

  -- ── 2. Compute authoritative next turn_index ───────────────────────────────
  -- This runs AFTER acquiring the lock, so no concurrent transaction for the
  -- same session can be between its own MAX() query and its INSERT.
  SELECT COALESCE(MAX(sm.turn_index), 0) + 1
    INTO v_turn_index
    FROM session_messages sm
   WHERE sm.session_id = p_session_id;

  -- ── 3. Persist user message ────────────────────────────────────────────────
  INSERT INTO session_messages
    (session_id, user_id, role, content, turn_index, detected_words)
  VALUES
    (p_session_id, p_user_id, 'user', p_transcript, v_turn_index, p_detected_words);

  -- ── 4. Persist assistant message (same turn — they share a round) ──────────
  INSERT INTO session_messages
    (session_id, user_id, role, content, turn_index)
  VALUES
    (p_session_id, p_user_id, 'assistant', p_reply_text, v_turn_index);

  -- ── 5. Keep sessions.turn_count consistent ─────────────────────────────────
  UPDATE sessions
     SET turn_count = v_turn_index
   WHERE id = p_session_id;

  RETURN v_turn_index;

END;
$$;

-- Grant execute to the roles used by Supabase client connections.
GRANT EXECUTE ON FUNCTION insert_session_turn(uuid, uuid, text, text, text[])
  TO authenticated, anon;
