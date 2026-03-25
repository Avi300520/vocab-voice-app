-- =============================================================================
-- Migration 011 — Replace functional index on words with named UNIQUE constraint
-- =============================================================================
-- Problem: The existing index words_user_word_unique was created as a functional
-- index on (user_id, lower(word)). Supabase's .upsert({ onConflict: 'user_id,word' })
-- targets column names directly; it cannot resolve a functional expression index,
-- causing Postgres error 42P10: "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification."
--
-- Fix: Drop the functional index (if it exists as an index rather than a
-- constraint) and add a plain named UNIQUE CONSTRAINT on (user_id, word).
-- This is semantically equivalent because the application layer already
-- calls .trim().toLowerCase() on every word before insertion.
-- =============================================================================

-- Step 1: Drop the old functional index if present (created as INDEX, not CONSTRAINT)
DROP INDEX IF EXISTS public.words_user_word_unique;

-- Step 2: Drop the old constraint form if present (idempotent guard)
ALTER TABLE public.words
  DROP CONSTRAINT IF EXISTS words_user_word_unique;

-- Step 3: Add the named UNIQUE constraint that ON CONFLICT can target by column name
ALTER TABLE public.words
  ADD CONSTRAINT words_user_word_unique UNIQUE (user_id, word);
