-- =============================================================================
-- Migration 003 — Fix session_messages_turn_unique constraint
-- =============================================================================
-- STATUS: Applied to production via Supabase MCP connector.
--
-- DIAGNOSIS
-- ─────────
-- Live schema inspection revealed:
--
--   CREATE UNIQUE INDEX session_messages_turn_unique
--     ON public.session_messages (session_id, turn_index);
--
-- The constraint covered only (session_id, turn_index) — role was absent.
-- insert_session_turn inserts both a 'user' row and an 'assistant' row with
-- the SAME turn_index (they are a conversation pair).  The second INSERT
-- always violated the constraint because (session_id, turn_index) was already
-- taken by the first INSERT, regardless of which role was being written.
--
-- FIX
-- ───
-- Added `role` as the third column so the constraint reads:
--   UNIQUE (session_id, role, turn_index)
--
-- This enforces the intended invariant:
--   "at most one user message AND one assistant message per turn per session"
--
--   (session1, 'user',      1)  ✓  — allowed
--   (session1, 'assistant', 1)  ✓  — allowed (different role)
--   (session1, 'user',      1)  ✗  — correctly rejected (duplicate)
--
-- The insert_session_turn function logic is correct and unchanged.
-- The FOR UPDATE lock on sessions still prevents race conditions.
-- =============================================================================

-- Step 1: Drop the too-narrow constraint.
ALTER TABLE public.session_messages
  DROP CONSTRAINT session_messages_turn_unique;

-- Step 2: Recreate with role included.
ALTER TABLE public.session_messages
  ADD CONSTRAINT session_messages_turn_unique
  UNIQUE (session_id, role, turn_index);
