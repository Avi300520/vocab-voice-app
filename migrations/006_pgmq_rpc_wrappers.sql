-- =============================================================================
-- Migration 006 — pgmq RPC wrappers for Edge Function access
-- =============================================================================
-- How to apply:
-- 1. Open Supabase Dashboard → SQL Editor → New Query
-- 2. Paste this entire file and click "Run"
--
-- What this does:
-- Creates SECURITY DEFINER wrappers around pgmq.read(), pgmq.delete(), and
-- pgmq.archive() so that the semantic-worker Edge Function (which connects
-- via service_role) can access pgmq schema functions through the Supabase
-- JS client's .rpc() method.
--
-- Why SECURITY DEFINER:
-- pgmq schema functions are only accessible to the postgres superuser.
-- These wrappers run as the function owner (postgres), providing a controlled
-- gateway for the service_role to interact with the queue.
-- =============================================================================

-- ── pgmq_read — dequeue a batch of messages with visibility timeout ────────
CREATE OR REPLACE FUNCTION public.pgmq_read(
  p_queue_name TEXT,
  p_vt         INTEGER,
  p_batch_size INTEGER
)
RETURNS TABLE(msg_id BIGINT, read_ct INTEGER, enqueued_at TIMESTAMPTZ, vt TIMESTAMPTZ, message JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
    SELECT m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message
    FROM pgmq.read(p_queue_name, p_vt, p_batch_size) m;
END;
$$;

-- ── pgmq_delete — permanently remove a processed message ───────────────────
CREATE OR REPLACE FUNCTION public.pgmq_delete(
  p_queue_name TEXT,
  p_msg_id     BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result BOOLEAN;
BEGIN
  SELECT pgmq.delete(p_queue_name, p_msg_id) INTO v_result;
  RETURN v_result;
END;
$$;

-- ── pgmq_archive — move a failed message to the archive table ──────────────
CREATE OR REPLACE FUNCTION public.pgmq_archive(
  p_queue_name TEXT,
  p_msg_id     BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result BOOLEAN;
BEGIN
  SELECT pgmq.archive(p_queue_name, p_msg_id) INTO v_result;
  RETURN v_result;
END;
$$;

-- ── Grants — only service_role needs access ────────────────────────────────
GRANT EXECUTE ON FUNCTION public.pgmq_read(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pgmq_delete(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.pgmq_archive(text, bigint) TO service_role;
