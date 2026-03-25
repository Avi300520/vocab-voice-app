-- Migration 016: Per-user hourly rate-limit RPC
--
-- check_user_rate_limit(p_user_id, p_limit)
--
-- Counts session_messages belonging to sessions the user started within the
-- last hour. Returns TRUE when that count >= p_limit (limit exceeded).
-- session_messages has no created_at column, so sessions.started_at serves
-- as the time-window proxy.  This is slightly conservative (it counts all
-- messages in sessions *started* within the window) but is accurate enough
-- for abuse prevention at MVP scale.
--
-- Called at the top of every /turn API route BEFORE any OpenAI work so that
-- abusive requests fail fast and incur zero AI cost.
--
-- SECURITY DEFINER runs with table owner privileges — safe here because the
-- function only reads, not writes, and the only parameter it uses is the
-- authenticated user's own id (passed in from the API route after
-- supabase.auth.getUser()).

CREATE OR REPLACE FUNCTION public.check_user_rate_limit(
  p_user_id UUID,
  p_limit   INT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(COUNT(*), 0) >= p_limit
  FROM   public.session_messages sm
  JOIN   public.sessions         s  ON s.id = sm.session_id
  WHERE  s.user_id    = p_user_id
    AND  s.started_at >= NOW() - INTERVAL '1 hour';
$$;

-- Grant execute to authenticated users so the Supabase server client can call
-- it via supabase.rpc() using the anon/service role.
GRANT EXECUTE ON FUNCTION public.check_user_rate_limit(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_rate_limit(UUID, INT) TO service_role;
