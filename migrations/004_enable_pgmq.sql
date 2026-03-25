-- =============================================================================
-- Migration 004 — Enable pgmq and create semantic evaluation queue
-- =============================================================================
-- How to apply:
-- 1. Open Supabase Dashboard → SQL Editor → New Query
-- 2. Paste this entire file and click "Run"
--
-- What this does:
-- a) Enables the pgmq extension (required for local Docker parity).
-- b) Creates the `semantic_evaluation_queue` for durable job delivery.
-- c) Creates the `semantic_failures` dead-letter table for jobs exceeding
--    the 3-attempt retry limit.
-- d) Safely initializes app settings for dynamic URL resolution.
-- e) Schedules a pg_cron job to invoke the semantic-worker Edge Function.
-- =============================================================================

-- ── 1. Enable the pgmq extension ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgmq CASCADE;

-- ── 2. Create the semantic evaluation queue ────────────────────────────────────
SELECT pgmq.create('semantic_evaluation_queue');

-- ── 3. Create semantic_failures dead-letter table ──────────────────────────────
-- Jobs that exceed 3 read attempts (tracked via pgmq read_ct) are routed here
-- for manual engineering inspection.
CREATE TABLE IF NOT EXISTS public.semantic_failures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  msg_id      BIGINT NOT NULL,
  queue_name  TEXT NOT NULL DEFAULT 'semantic_evaluation_queue',
  payload     JSONB NOT NULL,
  read_ct     INT NOT NULL,
  failed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_msg   TEXT
);

ALTER TABLE public.semantic_failures ENABLE ROW LEVEL SECURITY;

-- ── 4. Safely initialize app settings for dynamic URL resolution ───────────────
-- These settings are used by the cron job below to construct the Edge Function
-- URL dynamically, maintaining parity across local Docker, staging, and
-- production. The DO block sets session-scoped defaults ONLY if the settings
-- do not already exist, preventing a fatal "unrecognized configuration
-- parameter" error when current_setting() is called during cron scheduling.
--
-- For production, configure persistent values via:
--   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://your-project.supabase.co';
--   ALTER DATABASE postgres SET app.settings.service_role_key = 'your-service-role-key';
-- Or use Supabase Vault secrets in the Dashboard.
DO $$
BEGIN
  -- Check and set default for supabase_url if it doesn't exist
  IF current_setting('app.settings.supabase_url', true) IS NULL THEN
    PERFORM set_config('app.settings.supabase_url', 'http://host.docker.internal:54321', false);
  END IF;

  -- Check and set default for service_role_key if it doesn't exist
  IF current_setting('app.settings.service_role_key', true) IS NULL THEN
    PERFORM set_config('app.settings.service_role_key', 'local_dev_key', false);
  END IF;
END $$;

-- ── 5. Schedule cron job to invoke the semantic-worker Edge Function ───────────
-- Uses current_setting() for dynamic URL resolution across environments.
-- The Edge Function does not exist yet (Step 3) — the cron job will no-op
-- until the function is deployed.
SELECT cron.schedule(
  'invoke-semantic-worker',
  '30 seconds',
  $$
  SELECT net.http_post(
    url    := current_setting('app.settings.supabase_url') || '/functions/v1/semantic-worker',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body   := '{}'::jsonb
  ) AS request_id;
  $$
);
