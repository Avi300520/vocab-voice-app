-- =============================================================================
-- Migration 014 — Add onboarding_completed flag to profiles
-- =============================================================================
-- Adds a boolean column that is set to true when a user completes the
-- diagnostic onboarding session. The dashboard reads this flag to gate
-- new users: if false, they are redirected to /onboarding/diagnostic
-- instead of being shown the empty dashboard.
--
-- DEFAULT FALSE means all existing users are treated as incomplete until
-- their flag is explicitly set. Existing test accounts should be updated
-- manually if needed.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
