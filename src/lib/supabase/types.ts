/**
 * src/lib/supabase/types.ts
 *
 * Strict TypeScript definitions for the VocabVoiceApp database schema.
 * Hand-authored to exactly mirror 001_initial_schema.sql.
 *
 * IMPORTANT: All Row / Insert / Update shapes use `type` (not `interface`)
 * so that TypeScript's conditional-type checker can resolve them as satisfying
 * `Record<string, unknown>` — a requirement of the Supabase postgrest-js
 * `GenericTable` constraint (v2.x, PostgrestVersion "12").
 *
 * TIP: After any future migration, regenerate with:
 *   npx supabase gen types typescript --project-id csheolzcojsogokdxhvr > src/lib/supabase/types.ts
 */

// ─── Enums ──────────────────────────────────────────────────────────────────

export type WordStatus = 'new' | 'practicing' | 'mastered';

export type EvaluationLabel =
  | 'used_correct'
  | 'used_partially_correct'
  | 'used_incorrect'
  | 'mentioned_not_used'
  | 'not_used_false_positive'
  | 'ambiguous';

export type MasteryState =
  | 'passive'
  | 'practicing'
  | 'stable'
  | 'mastered'
  | 'needs_review';

// ─── Row types (shape returned by SELECT *) ──────────────────────────────────

export type ProfileRow = {
  id: string;
  display_name: string;
  native_lang: string;
  target_lang: string;
  proficiency: 'intermediate' | 'advanced' | 'native';
  voice_id: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type WordRow = {
  id: string;
  user_id: string;
  word: string;
  definition: string | null;
  example: string | null;
  status: WordStatus;
  times_used: number;
  times_shown: number;
  last_used_at: string | null;
  notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type SessionRow = {
  id: string;
  user_id: string;
  topic: string;
  topic_context: string | null;
  status: 'active' | 'completed' | 'abandoned';
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
  turn_count: number;
  words_assigned: number;
  words_used: number;
  model_id: string | null;
  metadata: Record<string, unknown>;
};

export type SessionMessageRow = {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  turn_index: number;
  audio_duration_ms: number | null;
  detected_words: string[];
  word_timestamps: Record<string, unknown>[] | null;
  metadata: Record<string, unknown>;
};

export type SessionWordRow = {
  id: string;
  session_id: string;
  word_id: string;
  user_id: string;
  used: boolean;
  used_at: string | null;
  turn_index: number | null;
  context: string | null;
};

export type SemanticEvaluationRow = {
  id: string;
  session_id: string;
  turn_index: number;
  word_id: string;
  user_id: string;
  label: EvaluationLabel;
  confidence_score: number;
  credited: boolean;
  evidence_used: string;
  diagnostic: string;
  learner_feedback: string | null;
  created_at: string;
};

export type WordMasteryRow = {
  id: string;
  user_id: string;
  word_id: string;
  state: MasteryState;
  stability: number;
  difficulty: number;
  retrievability: number;
  success_count: number;
  fail_count: number;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Insert types (required fields required; DB-defaulted fields optional) ────

export type ProfileInsert = {
  id: string;
  display_name: string;
  native_lang: string;
  target_lang: string;
  proficiency: 'intermediate' | 'advanced' | 'native';
  voice_id?: string | null;
  settings?: Record<string, unknown>;
};

export type WordInsert = {
  id?: string;
  user_id: string;
  word: string;
  definition?: string | null;
  example?: string | null;
  status?: WordStatus;
  times_used?: number;
  times_shown?: number;
  last_used_at?: string | null;
  notes?: string | null;
  tags?: string[];
};

export type SessionInsert = {
  id?: string;
  user_id: string;
  topic: string;
  topic_context?: string | null;
  status: 'active' | 'completed' | 'abandoned';
  started_at?: string;
  ended_at?: string | null;
  duration_sec?: number | null;
  turn_count?: number;
  words_assigned?: number;
  words_used?: number;
  model_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type SessionMessageInsert = {
  id?: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  turn_index: number;
  audio_duration_ms?: number | null;
  detected_words?: string[];
  word_timestamps?: Record<string, unknown>[] | null;
  metadata?: Record<string, unknown>;
};

export type SessionWordInsert = {
  id?: string;
  session_id: string;
  word_id: string;
  user_id: string;
  used?: boolean;
  used_at?: string | null;
  turn_index?: number | null;
  context?: string | null;
};

// ─── Update types (all mutable columns optional) ────────────────────────────

export type ProfileUpdate = {
  display_name?: string;
  native_lang?: string;
  target_lang?: string;
  proficiency?: 'intermediate' | 'advanced' | 'native';
  voice_id?: string | null;
  settings?: Record<string, unknown>;
  updated_at?: string;
};

export type WordUpdate = {
  word?: string;
  definition?: string | null;
  example?: string | null;
  status?: WordStatus;
  times_used?: number;
  times_shown?: number;
  last_used_at?: string | null;
  notes?: string | null;
  tags?: string[];
  updated_at?: string;
};

export type SessionUpdate = {
  topic?: string;
  topic_context?: string | null;
  status?: 'active' | 'completed' | 'abandoned';
  ended_at?: string | null;
  duration_sec?: number | null;
  turn_count?: number;
  words_assigned?: number;
  words_used?: number;
  model_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type SessionMessageUpdate = {
  role?: 'user' | 'assistant' | 'system';
  content?: string;
  turn_index?: number;
  audio_duration_ms?: number | null;
  detected_words?: string[];
  word_timestamps?: Record<string, unknown>[] | null;
  metadata?: Record<string, unknown>;
};

export type SessionWordUpdate = {
  used?: boolean;
  used_at?: string | null;
  turn_index?: number | null;
  context?: string | null;
};

export type SemanticEvaluationInsert = {
  id?: string;
  session_id: string;
  turn_index: number;
  word_id: string;
  user_id: string;
  label: EvaluationLabel;
  confidence_score: number;
  credited: boolean;
  evidence_used: string;
  diagnostic: string;
  learner_feedback?: string | null;
};

export type WordMasteryInsert = {
  id?: string;
  user_id: string;
  word_id: string;
  state?: MasteryState;
  stability?: number;
  difficulty?: number;
  retrievability?: number;
  success_count?: number;
  fail_count?: number;
  last_reviewed_at?: string | null;
  next_review_at?: string | null;
};

export type WordMasteryUpdate = {
  state?: MasteryState;
  stability?: number;
  difficulty?: number;
  retrievability?: number;
  success_count?: number;
  fail_count?: number;
  last_reviewed_at?: string | null;
  next_review_at?: string | null;
};

// ─── Database (top-level generic for Supabase client) ───────────────────────
// • Each table entry must include `Relationships: []` (GenericTable constraint).
// • Views / Functions use `{ [_ in never]: never }` — the Supabase CLI pattern
//   for "no views / no functions" — which satisfies Record<string, GenericView>.
// • All Row / Insert / Update types are `type` aliases (not interfaces) so that
//   TypeScript's conditional-type resolver correctly sees them as subtypes of
//   Record<string, unknown> (interfaces are opaque to index-signature checks).

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
      words: {
        Row: WordRow;
        Insert: WordInsert;
        Update: WordUpdate;
        Relationships: [];
      };
      sessions: {
        Row: SessionRow;
        Insert: SessionInsert;
        Update: SessionUpdate;
        Relationships: [];
      };
      session_messages: {
        Row: SessionMessageRow;
        Insert: SessionMessageInsert;
        Update: SessionMessageUpdate;
        Relationships: [];
      };
      session_words: {
        Row: SessionWordRow;
        Insert: SessionWordInsert;
        Update: SessionWordUpdate;
        Relationships: [];
      };
      semantic_evaluations: {
        Row: SemanticEvaluationRow;
        Insert: SemanticEvaluationInsert;
        Update: never;
        Relationships: [];
      };
      word_mastery: {
        Row: WordMasteryRow;
        Insert: WordMasteryInsert;
        Update: WordMasteryUpdate;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      /**
       * Atomically inserts one user message + one assistant message for a
       * single conversation turn, holding a FOR UPDATE lock on the session row
       * so that concurrent requests for the same session serialize correctly.
       *
       * Returns the assigned turn_index (integer).
       */
      insert_session_turn: {
        Args: {
          p_session_id:      string;
          p_user_id:         string;
          p_transcript:      string;
          p_reply_text:      string;
          p_detected_words:  string[];
          p_word_timestamps?: Record<string, unknown>[] | null;
        };
        Returns: number;
      };
      /**
       * Atomically inserts a semantic evaluation and updates the word_mastery
       * FSRS state. Called exclusively from the semantic-worker Edge Function
       * via service_role. Returns the evaluation UUID.
       */
      process_evaluation_result: {
        Args: {
          p_session_id:       string;
          p_user_id:          string;
          p_turn_index:       number;
          p_word_id:          string;
          p_label:            EvaluationLabel;
          p_confidence:       number;
          p_should_credit:    boolean;
          p_evidence:         string;
          p_diagnostic:       string;
          p_learner_feedback?: string | null;
        };
        Returns: string;
      };
    };
    Enums: {
      word_status: WordStatus;
      evaluation_label: EvaluationLabel;
      mastery_state: MasteryState;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
