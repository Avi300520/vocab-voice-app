-- ============================================================
-- Migration: 001_initial_schema.sql
-- Description: Initial schema for voice-based AI language learning app
-- ============================================================

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE public.word_status AS ENUM ('new', 'practicing', 'mastered');

-- ============================================================
-- TABLE: profiles
-- Links to auth.users. Stores language preferences and TTS voice.
-- ============================================================

CREATE TABLE public.profiles (
  id            UUID          PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT          NOT NULL,
  native_lang   TEXT          NOT NULL DEFAULT 'he',
  target_lang   TEXT          NOT NULL DEFAULT 'en',
  proficiency   TEXT          NOT NULL CHECK (proficiency IN ('intermediate', 'advanced', 'native')),
  voice_id      TEXT,
  settings      JSONB         NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: words
-- User's personal target word bank.
-- ============================================================

CREATE TABLE public.words (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  word          TEXT          NOT NULL,
  definition    TEXT,
  example       TEXT,
  status        public.word_status NOT NULL DEFAULT 'new',
  times_used    INT           NOT NULL DEFAULT 0,
  times_shown   INT           NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  notes         TEXT,
  tags          TEXT[]        NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT words_user_word_unique UNIQUE (user_id, (LOWER(word)))
);

CREATE INDEX idx_words_user_status    ON public.words (user_id, status);
CREATE INDEX idx_words_user_last_used ON public.words (user_id, last_used_at NULLS FIRST);

-- ============================================================
-- TABLE: sessions
-- One row per voice conversation.
-- ============================================================

CREATE TABLE public.sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic           TEXT        NOT NULL,
  topic_context   TEXT,
  status          TEXT        NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  duration_sec    INT,
  turn_count      INT         NOT NULL DEFAULT 0,
  words_assigned  INT         NOT NULL DEFAULT 0,
  words_used      INT         NOT NULL DEFAULT 0,
  model_id        TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'
);

-- ============================================================
-- TABLE: session_messages
-- Individual conversation turns.
-- ============================================================

CREATE TABLE public.session_messages (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role              TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content           TEXT        NOT NULL,
  turn_index        INT         NOT NULL,
  audio_duration_ms INT,
  detected_words    TEXT[]      NOT NULL DEFAULT '{}',
  metadata          JSONB       NOT NULL DEFAULT '{}',

  CONSTRAINT session_messages_turn_unique UNIQUE (session_id, turn_index)
);

CREATE INDEX idx_session_messages_session ON public.session_messages (session_id);
CREATE INDEX idx_session_messages_user    ON public.session_messages (user_id);

-- ============================================================
-- TABLE: session_words
-- Junction: which target words were assigned to a session and whether used.
-- ============================================================

CREATE TABLE public.session_words (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  word_id     UUID        NOT NULL REFERENCES public.words(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  used        BOOLEAN     NOT NULL DEFAULT FALSE,
  used_at     TIMESTAMPTZ,
  turn_index  INT,
  context     TEXT,

  CONSTRAINT session_words_unique UNIQUE (session_id, word_id)
);

CREATE INDEX idx_session_words_session ON public.session_words (session_id);
CREATE INDEX idx_session_words_user    ON public.session_words (user_id);

-- ============================================================
-- TRIGGER: auto-create profile on new auth user
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, 'New User')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- TRIGGER: keep updated_at current for profiles and words
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_words_updated_at
  BEFORE UPDATE ON public.words
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.words           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_words   ENABLE ROW LEVEL SECURITY;

-- ---- profiles ----
CREATE POLICY "profiles: owner select"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles: owner insert"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles: owner update"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- No delete policy for profiles — deletion handled via auth.users CASCADE

-- ---- words ----
CREATE POLICY "words: owner select"
  ON public.words FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "words: owner insert"
  ON public.words FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "words: owner update"
  ON public.words FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "words: owner delete"
  ON public.words FOR DELETE
  USING (user_id = auth.uid());

-- ---- sessions ----
CREATE POLICY "sessions: owner select"
  ON public.sessions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "sessions: owner insert"
  ON public.sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "sessions: owner update"
  ON public.sessions FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "sessions: owner delete"
  ON public.sessions FOR DELETE
  USING (user_id = auth.uid());

-- ---- session_messages ----
CREATE POLICY "session_messages: owner select"
  ON public.session_messages FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "session_messages: owner insert"
  ON public.session_messages FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "session_messages: owner update"
  ON public.session_messages FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "session_messages: owner delete"
  ON public.session_messages FOR DELETE
  USING (user_id = auth.uid());

-- ---- session_words ----
CREATE POLICY "session_words: owner select"
  ON public.session_words FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "session_words: owner insert"
  ON public.session_words FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "session_words: owner update"
  ON public.session_words FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "session_words: owner delete"
  ON public.session_words FOR DELETE
  USING (user_id = auth.uid());
