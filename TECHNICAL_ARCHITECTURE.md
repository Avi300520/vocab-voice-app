# VocabVoice — Technical Architecture & State Document

> **Generated:** 2026-03-20
> **Purpose:** Authoritative reference for onboarding a new development session. Covers the live database schema, full routing map, every key component, and all known gotchas. Read this before writing any code.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack & Versions](#2-tech-stack--versions)
3. [Directory Structure](#3-directory-structure)
4. [Environment Variables](#4-environment-variables)
5. [Database Schema (Live — Supabase)](#5-database-schema-live--supabase)
6. [PL/pgSQL Functions](#6-plpgsql-functions)
7. [Routing & API Structure](#7-routing--api-structure)
8. [Server Actions](#8-server-actions)
9. [Key Components](#9-key-components)
10. [AI Pipeline (`route.ts`)](#10-ai-pipeline-routets)
11. [VoiceSession State Machine](#11-voicesession-state-machine)
12. [Topic Data](#12-topic-data)
13. [TypeScript Types](#13-typescript-types)
14. [Critical Engineering Notes](#14-critical-engineering-notes)
15. [Deferred Features](#15-deferred-features)

---

## 1. Project Overview

VocabVoice is an English language practice application where users hold voice conversations with an AI sparring partner on intellectually rich topics. The app detects target vocabulary words in the user's speech to gamify acquisition.

**Core loop:**
1. User picks a topic (preset or custom) → session created in DB
2. User holds the mic button and speaks → audio sent to Whisper (STT)
3. Whisper transcript → gpt-4o-mini → AI text reply
4. Reply → tts-1/alloy → base64 mp3 → auto-plays on client
5. User can interrupt playback mid-sentence to speak again
6. Detected vocabulary words light up in a sidebar tracker
7. User clicks "Complete Session" → session marked `completed`, redirect to `/dashboard`

---

## 2. Tech Stack & Versions

| Package | Version | Notes |
|---------|---------|-------|
| `next` | 16.2.0 | App Router, Turbopack dev server |
| `react` / `react-dom` | 19.2.4 | React 19 with `useActionState` |
| `@supabase/supabase-js` | ^2.99.2 | Client & server Supabase clients |
| `@supabase/ssr` | ^0.9.0 | Cookie-based SSR auth helpers |
| `openai` | ^6.32.0 | Whisper STT, gpt-4o-mini, tts-1 |
| `babel-plugin-react-compiler` | 1.0.0 | **See critical note §14.1** |
| `tailwindcss` | ^4 | Utility CSS |
| `typescript` | ^5 | Strict mode |

**Supabase Project:** `csheolzcojsogokdxhvr`

---

## 3. Directory Structure

```
vocab-voice-app/
├── migrations/
│   ├── 002_atomic_turn_insert.sql       # insert_session_turn PL/pgSQL function
│   └── 003_fix_turn_unique_constraint.sql  # Fixed UNIQUE constraint (applied ✓)
├── src/
│   ├── app/
│   │   ├── layout.tsx                   # Root layout — fonts + metadata
│   │   ├── page.tsx                     # Landing / marketing page
│   │   ├── globals.css                  # Obsidian Codex design tokens + global styles
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx           # Login form
│   │   │   └── register/page.tsx        # Registration form
│   │   ├── actions/
│   │   │   ├── auth.ts                  # signIn, signUp, signOut server actions
│   │   │   ├── sessions.ts              # createSession, completeSession, abandonSession
│   │   │   └── words.ts                 # addWord, deleteWord
│   │   ├── api/
│   │   │   └── sessions/[sessionId]/
│   │   │       └── turn/
│   │   │           └── route.ts         # POST — full AI pipeline (STT→LLM→TTS→DB)
│   │   ├── dashboard/
│   │   │   └── page.tsx                 # User dashboard — session history
│   │   ├── session/
│   │   │   └── [id]/
│   │   │       ├── page.tsx             # Server Component — auth + data fetch
│   │   │       └── _components/
│   │   │           └── VoiceSession.tsx # Client Component — full voice loop UI
│   │   ├── setup-session/
│   │   │   ├── page.tsx                 # Server Component — renders setup UI
│   │   │   ├── _data/
│   │   │   │   └── topics.ts            # 12 topic definitions + CATEGORY_COLORS
│   │   │   └── _components/
│   │   │       ├── CustomTopicForm.tsx  # Free-text topic input (top of page)
│   │   │       └── TopicGrid.tsx        # 12-card grid of preset topics
│   │   └── words/
│   │       ├── page.tsx                 # Word bank management page
│   │       └── _components/
│   │           ├── AddWordForm.tsx       # Add word form
│   │           └── WordCard.tsx          # Individual word card with delete
│   └── lib/
│       └── supabase/
│           ├── client.ts                # Browser Supabase client (singleton)
│           ├── server.ts                # Server Supabase client (cookie-based)
│           └── types.ts                 # Full DB TypeScript types (hand-authored)
├── TECHNICAL_ARCHITECTURE.md            # This document
├── package.json
├── next.config.ts
├── tsconfig.json
└── tailwind.config.ts (or postcss.config.mjs)
```

---

## 4. Environment Variables

All stored in `.env.local` (never committed).

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `OPENAI_API_KEY` | ✅ | OpenAI API key (`sk-...`). Module-level guard in `route.ts` — server throws at cold-start if missing. |

---

## 5. Database Schema (Live — Supabase)

Schema verified via live Supabase MCP connector. All tables are in `public` schema with Row Level Security (RLS) enabled.

### 5.1 `profiles`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, FK → `auth.users(id)` |
| `display_name` | `text` | NOT NULL |
| `native_lang` | `text` | NOT NULL, default `'en'` |
| `target_lang` | `text` | NOT NULL, default `'en'` |
| `proficiency` | `text` | NOT NULL, default `'intermediate'` |
| `voice_id` | `text` | NULLABLE |
| `settings` | `jsonb` | NOT NULL, default `'{}'` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

**RLS:** Users can only read/write their own profile row.

### 5.2 `words`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` |
| `word` | `text` | NOT NULL |
| `definition` | `text` | NULLABLE |
| `example` | `text` | NULLABLE |
| `status` | `word_status` (enum) | NOT NULL, default `'new'` |
| `times_used` | `integer` | NOT NULL, default `0` |
| `times_shown` | `integer` | NOT NULL, default `0` |
| `last_used_at` | `timestamptz` | NULLABLE |
| `notes` | `text` | NULLABLE |
| `tags` | `text[]` | NOT NULL, default `'{}'` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

**Enum:** `word_status` = `'new' | 'practicing' | 'mastered'`

**Indexes:**
- `words_user_word_unique` — `UNIQUE(user_id, lower(word))` — prevents duplicate words per user (case-insensitive)

**RLS:** Users can only read/write their own words.

### 5.3 `sessions`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` |
| `topic` | `text` | NOT NULL |
| `topic_context` | `text` | NULLABLE |
| `status` | `text` | NOT NULL, default `'active'` — values: `'active' \| 'completed' \| 'abandoned'` |
| `started_at` | `timestamptz` | NOT NULL, default `now()` |
| `ended_at` | `timestamptz` | NULLABLE |
| `duration_sec` | `integer` | NULLABLE |
| `turn_count` | `integer` | NOT NULL, default `0` — kept in sync by `insert_session_turn` |
| `words_assigned` | `integer` | NOT NULL, default `0` |
| `words_used` | `integer` | NOT NULL, default `0` |
| `model_id` | `text` | NULLABLE |
| `metadata` | `jsonb` | NOT NULL, default `'{}'` |

**RLS:** Users can only read/write their own sessions.

**Note:** The `sessions` row is the **lock target** for `insert_session_turn` (see §6). It must exist and be accessible via RLS before any turn can be persisted.

### 5.4 `session_messages`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `session_id` | `uuid` | NOT NULL, FK → `sessions(id)` |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` |
| `role` | `text` | NOT NULL — values: `'user' \| 'assistant' \| 'system'` |
| `content` | `text` | NOT NULL |
| `turn_index` | `integer` | NOT NULL — assigned by `insert_session_turn` |
| `audio_duration_ms` | `integer` | NULLABLE |
| `detected_words` | `text[]` | NOT NULL, default `'{}'` |
| `metadata` | `jsonb` | NOT NULL, default `'{}'` |

**Constraints (post-Migration 003):**
- `session_messages_turn_unique` — `UNIQUE(session_id, role, turn_index)`
  - Enforces: at most one user message **and** one assistant message per turn per session
  - **Critical:** `role` MUST be in this constraint. Without it, the second INSERT in `insert_session_turn` (which shares `turn_index` with the first) always violates the constraint.

**RLS:** Users can only read/write messages belonging to their own sessions.

### 5.5 `session_words`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `session_id` | `uuid` | NOT NULL, FK → `sessions(id)` |
| `word_id` | `uuid` | NOT NULL, FK → `words(id)` |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` |
| `used` | `boolean` | NOT NULL, default `false` |
| `used_at` | `timestamptz` | NULLABLE |
| `turn_index` | `integer` | NULLABLE |
| `context` | `text` | NULLABLE |

**RLS:** Users can only read/write their own session_words rows.

**Note:** This table exists in the schema but is **not yet populated** by the current code. Planned for a future sprint.

---

## 6. PL/pgSQL Functions

### `insert_session_turn` (Migration 002 + 003)

**Signature:**
```sql
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
```

**Purpose:** Atomically insert one user message + one assistant message for a conversation turn, with guaranteed sequential `turn_index` values.

**Execution steps:**

1. **Acquire row-level lock** on the `sessions` row matching `p_session_id`:
   ```sql
   PERFORM s.id FROM sessions s WHERE s.id = p_session_id FOR UPDATE;
   ```
   - Two concurrent requests for the **same** session serialize here.
   - Requests for **different** sessions are completely unaffected.
   - If no row is found (wrong user ID filtered by RLS, or invalid session ID), raises `EXCEPTION 'session_not_found'` with `ERRCODE = 'P0001'`.

2. **Compute next `turn_index`** — executed while holding the lock:
   ```sql
   SELECT COALESCE(MAX(sm.turn_index), 0) + 1
     INTO v_turn_index
     FROM session_messages sm
    WHERE sm.session_id = p_session_id;
   ```

3. **Insert user message:**
   ```sql
   INSERT INTO session_messages (session_id, user_id, role, content, turn_index, detected_words)
   VALUES (p_session_id, p_user_id, 'user', p_transcript, v_turn_index, p_detected_words);
   ```

4. **Insert assistant message** (same `turn_index` — they form a pair):
   ```sql
   INSERT INTO session_messages (session_id, user_id, role, content, turn_index)
   VALUES (p_session_id, p_user_id, 'assistant', p_reply_text, v_turn_index);
   ```
   - This is why `session_messages_turn_unique` **must** include `role` — both rows share the same `turn_index`.

5. **Update `sessions.turn_count`:**
   ```sql
   UPDATE sessions SET turn_count = v_turn_index WHERE id = p_session_id;
   ```

6. **Return** `v_turn_index` (INTEGER).

**Grants:**
```sql
GRANT EXECUTE ON FUNCTION insert_session_turn(uuid, uuid, text, text, text[])
  TO authenticated, anon;
```

**Security model:** `SECURITY INVOKER` — function runs with the calling user's role, so RLS on both `sessions` and `session_messages` applies normally. Users cannot insert into sessions they don't own.

---

## 7. Routing & API Structure

### App Router Pages

| Route | File | Type | Auth | Description |
|-------|------|------|------|-------------|
| `/` | `app/page.tsx` | Server Component | None | Landing page |
| `/login` | `app/(auth)/login/page.tsx` | Server Component | Redirect if authed | Login form |
| `/register` | `app/(auth)/register/page.tsx` | Server Component | Redirect if authed | Registration form |
| `/dashboard` | `app/dashboard/page.tsx` | Server Component | Required | Session history + stats |
| `/words` | `app/words/page.tsx` | Server Component | Required | Word bank management |
| `/setup-session` | `app/setup-session/page.tsx` | Server Component | Required | Topic picker |
| `/session/[id]` | `app/session/[id]/page.tsx` | Server Component | Required | Active voice session |

### API Routes

| Method | Route | File | Description |
|--------|-------|------|-------------|
| `POST` | `/api/sessions/[sessionId]/turn` | `app/api/sessions/[sessionId]/turn/route.ts` | Full AI pipeline: STT → LLM → TTS → DB persist |

**`route.ts` params type:**
```typescript
{ params }: { params: Promise<{ sessionId: string }> }
```
Note: In Next.js 16, dynamic route params are a `Promise` and must be `await`ed.

---

## 8. Server Actions

All server actions are in `src/app/actions/`. All use `'use server'` directive and authenticate via `supabase.auth.getUser()` — never trusting client-supplied user IDs.

### `sessions.ts`

#### `createSession(_prev: CreateSessionState, formData: FormData): Promise<CreateSessionState>`

- **Used by:** `TopicGrid.tsx`, `CustomTopicForm.tsx` via `useActionState`
- **Reads:** `formData.get('topic')`, `formData.get('topic_context')`
- **Flow:** Auth check → INSERT into `sessions` → `redirect(\`/session/${sessionId}\`)`
- **Error return:** `{ error: string }` for DB failures
- **Redirect:** `redirect()` is **outside** the try/catch block. This is load-bearing — see §14.2.
- **`isRedirectError` pattern:** Inside the catch block, `if (isRedirectError(err)) throw err` ensures NEXT_REDIRECT propagates correctly if redirect() is ever called within a try.

#### `completeSession(sessionId: string): Promise<void>`

- Updates `sessions.status = 'completed'`, sets `ended_at = now()`
- Redirects to `/dashboard`

#### `abandonSession(sessionId: string): Promise<void>`

- Updates `sessions.status = 'abandoned'`, sets `ended_at = now()`
- Redirects to `/dashboard`
- Called from the "✕ End" button in `VoiceSession.tsx` via `<form action={abandonSession.bind(null, sessionId)}>`

### `words.ts`

#### `addWord(_prevState: WordActionState, formData: FormData): Promise<WordActionState>`

- Reads `word`, `definition`, `notes` from FormData
- Validates: word required, max 100 chars
- Handles `23505` (unique violation) for duplicate word detection
- Calls `revalidatePath('/words')`

#### `deleteWord(wordId: string): Promise<void>`

- Belt-and-suspenders: `.eq('id', wordId).eq('user_id', user.id)` (plus RLS)
- Calls `revalidatePath('/words')`

### `auth.ts`

Contains `signIn`, `signUp`, `signOut` server actions (standard Supabase email/password auth pattern).

---

## 9. Key Components

### `TopicGrid.tsx` — `src/app/setup-session/_components/TopicGrid.tsx`

**Type:** Client Component (`'use client'`)

**Purpose:** Renders 12 topic cards. Each card submits a form to `createSession`.

**Key pattern:**
```typescript
const [state, formAction, isPending] = useActionState(createSession, { error: null });
const [loadingId, setLoadingId] = useState<string | null>(null);
// Clear spinner on error (isPending becomes false)
const activeLoadingId = isPending ? loadingId : null;
```

Each card is a `<form action={formAction}>` containing:
- `<input type="hidden" name="topic" value={topic.title} />`
- `<input type="hidden" name="topic_context" value={topic.context} />`
- `<button type="submit" onClick={() => !isPending && setLoadingId(topic.id)}>`

**Why `<form action>` not `startTransition`:** `babel-plugin-react-compiler` v1.0.0 transforms `startTransition(() => formAction(fd))` in a way that breaks the transition context, causing a React console error: _"An async function with useActionState was called outside of a transition."_ The `<form action>` pattern is immune — the framework enrolls form submissions in a transition at the DOM level.

---

### `CustomTopicForm.tsx` — `src/app/setup-session/_components/CustomTopicForm.tsx`

**Type:** Client Component (`'use client'`)

**Purpose:** Free-text topic input at the top of `/setup-session`.

**Key detail:** Uses `<input type="hidden" name="topic_context" value="">` — custom topics have no pre-written context string. The AI system prompt still receives the custom topic text via the `topic` field.

---

### `VoiceSession.tsx` — `src/app/session/[id]/_components/VoiceSession.tsx`

**Type:** Client Component (`'use client'`). This is the most complex component in the codebase. See §11 for the full state machine documentation.

---

### `SessionPage` — `src/app/session/[id]/page.tsx`

**Type:** Server Component

**Responsibilities:**
1. Auth guard → `redirect('/login')`
2. Fetch session by `id` + `user_id` (RLS enforces ownership)
3. If `session.status !== 'active'` → `redirect(\`/dashboard?ended=${session.status}\`)`
4. Fetch user's full word bank ordered by `status` ascending (`new → practicing → mastered`)
5. Render `<VoiceSession>` with session data + word bank as props

**Props passed to VoiceSession:**
```typescript
{
  sessionId:        string;
  topic:            string;
  topicContext?:    string;
  wordBank:         WordRow[];
  initialTurnCount: number;
}
```

---

## 10. AI Pipeline (`route.ts`)

**Endpoint:** `POST /api/sessions/[sessionId]/turn`

**Content-Type:** `multipart/form-data` with field `audio` (File/Blob)

**Response type:**
```typescript
export interface TurnResponse {
  turn_index:     number;
  transcript:     string;        // User speech (from Whisper)
  reply_text:     string;        // AI reply (from gpt-4o-mini)
  audio_url:      string | null; // 'data:audio/mpeg;base64,...' or null on TTS failure
  detected_words: string[];      // Words from bank found in transcript
}
```

### Pipeline Steps

| Step | Operation | Model/Service | Fatal? | HTTP on failure |
|------|-----------|---------------|--------|-----------------|
| 1 | Auth check | Supabase `getUser()` | Yes | 401 |
| 2 | Session ownership + status check | Supabase | Yes | 404 / 409 |
| 3 | Parse `multipart/form-data`, extract `audio` File | — | Yes | 400 |
| 4 | STT: transcribe audio | `whisper-1` | Yes | 422 (too short / inaudible) / 502 |
| 5 | Fetch conversation history | Supabase `session_messages` | No (non-fatal) | — |
| 6 | LLM: generate reply | `gpt-4o-mini` | Yes | 502 |
| 7 | Naive word detection | in-process substring match | No | — |
| 8a | TTS: synthesize speech | `tts-1` / `alloy` | No (non-fatal) | — |
| 8b | DB persist (parallel with 8a) | `insert_session_turn` RPC | Yes | 500 |
| 9 | Return `TurnResponse` JSON | — | — | 200 |

### System Prompt

```
You are a razor-sharp intellectual sparring partner engaged in a voice conversation.

TOPIC: "{topic}"
CONTEXT: {topicContext}  ← omitted if topicContext is null

RULES — never break these:
1. Your ENTIRE response must be 2-3 sentences maximum. Never exceed this. Brevity is non-negotiable for voice.
2. Challenge the user's reasoning directly. If an argument is weak, name the weakness.
3. End with exactly one probing question that forces deeper thinking.
4. Never compliment the user just to be polite. Reserve any praise for genuinely incisive insights only.
5. Never discuss daily routines, weather, food, greetings, or any small talk whatsoever.
6. You may disagree with the user's entire premise — state your position and defend it concisely.
7. Write in plain prose: no bullet points, no markdown, no headers. This is spoken dialogue.
```

**LLM parameters:** `model: 'gpt-4o-mini'`, `max_tokens: 220`, `temperature: 0.8`

### TTS + DB Parallel Execution

Steps 8a and 8b run concurrently via `Promise.all`:

```typescript
const [audioBase64, rpcResult] = await Promise.all([
  // TTS — non-fatal, returns null on error
  openai.audio.speech.create({ model: 'tts-1', voice: 'alloy', input: replyText, response_format: 'mp3' })
    .then(r => r.arrayBuffer())
    .then(buf => Buffer.from(buf).toString('base64'))
    .catch(() => null),

  // DB persist — fatal
  supabase.rpc('insert_session_turn', {
    p_session_id: sessionId, p_user_id: user.id,
    p_transcript: transcript, p_reply_text: replyText,
    p_detected_words: detectedWords,
  }),
]);
```

**Why parallel:** Both operations are independent. Running them concurrently reduces total latency to `max(tts_time, db_time)` instead of `tts_time + db_time`.

**Audio transport:** The TTS response body is read as `ArrayBuffer`, converted to base64, and wrapped in a data URL: `data:audio/mpeg;base64,${audioBase64}`. The client passes this directly to `new Audio(url)`. No file storage or presigned URLs needed.

### `naiveDetectWords`

```typescript
function naiveDetectWords(transcript: string, wordBank: Pick<WordRow, 'id' | 'word' | 'status'>[]): string[] {
  const lower = transcript.toLowerCase();
  return wordBank.filter(w => lower.includes(w.word.toLowerCase())).map(w => w.word);
}
```

**Known limitation:** Does not lemmatize. `"running"` will not match a bank word `"run"`. Replace with `compromise.js` in a future sprint.

---

## 11. VoiceSession State Machine

### States

```
type Phase = 'idle' | 'recording' | 'processing' | 'playing'
```

### Transitions

```
idle       ──[pointerdown]──────────────────────► recording
recording  ──[pointerup, elapsed ≥ 1000ms]──────► processing
recording  ──[pointerup, elapsed < 1000ms]──────► idle  (+ toast)
processing ──[API response received]────────────► playing  (if audio_url)
processing ──[API response received]────────────► idle     (if no audio_url)
processing ──[API error]────────────────────────► idle  (+ errorMsg)
playing    ──[audio ended/error]────────────────► idle
playing    ──[pointerdown — INTERRUPT]──────────► recording
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `sessionId` | `string` | UUID of active session |
| `topic` | `string` | Display name of topic |
| `topicContext` | `string \| undefined` | Semantic context string for display and LLM |
| `wordBank` | `WordRow[]` | Full word bank fetched server-side |
| `initialTurnCount` | `number` | `sessions.turn_count` at page load |

### State Variables

| Variable | Type | Description |
|----------|------|-------------|
| `phase` | `Phase` | Current state machine phase |
| `permission` | `'prompt' \| 'granted' \| 'denied' \| 'unavailable'` | Microphone permission status |
| `turns` | `TurnEntry[]` | Transcript history (user + assistant bubbles) |
| `detectedSet` | `Set<string>` | Lowercased words from bank detected this session |
| `errorMsg` | `string \| null` | Persistent API/mic error (red banner, dismissable) |
| `toastMsg` | `string \| null` | Transient hint (amber, auto-dismisses in 2200ms) |
| `turnCount` | `number` | Running turn counter (updated after each API call) |
| `isEndingSession` | `boolean` | True while `completeSession` is in-flight |

### Refs

| Ref | Type | Description |
|-----|------|-------------|
| `mediaRecorderRef` | `MediaRecorder \| null` | Active recorder instance |
| `chunksRef` | `Blob[]` | Accumulated audio chunks |
| `streamRef` | `MediaStream \| null` | Cached mic stream (reused across turns) |
| `audioPlayerRef` | `HTMLAudioElement \| null` | Active TTS audio player |
| `transcriptEndRef` | `HTMLDivElement \| null` | Scroll anchor at bottom of transcript |
| `recordingStartRef` | `number` | `Date.now()` at pointerdown — for duration guard |
| `toastTimerRef` | `ReturnType<typeof setTimeout> \| null` | Auto-dismiss timer for toast |

### Callbacks (declaration order is load-bearing)

**⚠️ Order matters** — `sendAudioBlob` MUST be declared before `handlePointerUp` in the component body. `handlePointerUp`'s `useCallback` deps array `[showToast, sendAudioBlob]` is evaluated during the render pass; referencing a `const` declared later causes a **Temporal Dead Zone (TDZ) ReferenceError** on first render.

| Order | Callback | Deps | Description |
|-------|----------|------|-------------|
| 1 | `stopAudio` | `[]` | Null `onended`/`onerror` then `pause()`. Must be declared before effects that reference it. |
| 2 | `showToast(msg)` | `[]` | Sets `toastMsg`; starts auto-dismiss timer. |
| 3 | `acquireMic()` | `[]` | `getUserMedia` with echo/noise cancellation. Caches stream in `streamRef`. |
| 4 | `handlePointerDown()` | `[phase, acquireMic, stopAudio]` | Blocks on `processing`/`recording`. Calls `stopAudio()` if `phase === 'playing'`. Acquires mic, creates `MediaRecorder`, starts recording. |
| 5 | `sendAudioBlob(blob)` | `[sessionId]` | POSTs to `/api/sessions/${sessionId}/turn`. On success: appends turns, updates `detectedSet`, plays TTS audio. On error: sets `errorMsg`. **Must be declared before `handlePointerUp`.** |
| 6 | `handlePointerUp()` | `[showToast, sendAudioBlob]` | Checks elapsed time. If < 1000ms: discards, shows toast. If ≥ 1000ms: builds Blob, calls `sendAudioBlob`. |

### `stopAudio()` — Critical Implementation Detail

```typescript
const stopAudio = useCallback(() => {
  const audio = audioPlayerRef.current;
  if (!audio) return;
  audio.onended = null;  // MUST come before pause()
  audio.onerror = null;  // Some browsers fire onerror on pause()
  audio.pause();
  audio.src = '';        // Release data URL reference for GC
  audioPlayerRef.current = null;
}, []);
```

**Why null handlers before `pause()`:** Certain browsers (notably some mobile WebKit versions) fire `onerror` synchronously when `pause()` is called on a playing element. Without nulling the handler first, the stale `onDone` callback would call `setPhase('idle')` after the user has already transitioned to `'recording'`, corrupting the state machine.

### Memory Management for TTS Audio

`audio_url` (the base64 data URL) is intentionally **not stored** in the `TurnEntry` interface or the `turns` state array. It is played once and discarded:

```typescript
const onDone = () => {
  audio.src = '';              // Release data URL → GC can reclaim the buffer
  audioPlayerRef.current = null;
  setPhase('idle');
};
audio.onended = onDone;
audio.onerror = onDone;
audio.play().catch(onDone);
```

Storing multi-kilobyte base64 strings in the turns array would cause unbounded memory growth over a long session.

### Minimum Recording Guard

```typescript
const MIN_RECORDING_MS = 1000;  // Whisper requires >= 0.1s; we use 1s for safety
const TOAST_DURATION_MS = 2200;
```

On `pointerup`, if `Date.now() - recordingStartRef.current < MIN_RECORDING_MS`:
- Recorder is stopped, all chunks are discarded (`chunksRef.current = []`)
- Phase returns to `'idle'`
- Amber toast: `"Hold for at least 1s — try again"` (auto-dismisses after 2200ms)
- API is never called

The backend also catches Whisper 400 errors (too-short audio) and returns HTTP 422, but this frontend guard is the primary defence.

### RecordButton States

| `phase` | `permission` | `isDisabled` | Icon | Pulse ring |
|---------|--------------|--------------|------|------------|
| `idle` | `granted`/`prompt` | false | Mic | None |
| `recording` | any | false | Mic | Red, default speed |
| `processing` | any | **true** | Spinner | None |
| `playing` | any | **false** | Waveform | Teal, 1.4s duration |
| any | `denied` | **true** | Mic | None |
| any | `unavailable` | **true** | Mic | None |

**Key design decision:** `phase === 'playing'` does NOT set `isDisabled`. This enables the interruption feature — user can tap during playback to start speaking.

---

## 12. Topic Data

**File:** `src/app/setup-session/_data/topics.ts`

### 12 Preset Topics

| ID | Title | Category | Depth |
|----|-------|----------|-------|
| `global-history` | Global History & Civilisations | HISTORY | 2 |
| `ethical-dilemmas` | Ethical Dilemmas | ETHICS | 3 |
| `future-technologies` | Future Technologies | TECHNOLOGY | 3 |
| `society-inequality` | Society & Inequality | SOCIETY | 3 |
| `economics-power` | Economics & Power | ECONOMICS | 4 |
| `psychology-behaviour` | Psychology & Human Behaviour | PSYCHOLOGY | 3 |
| `political-theory` | Political Theory & Governance | POLITICS | 3 |
| `philosophy-mind` | Philosophy of Mind & Consciousness | PHILOSOPHY | 4 |
| `climate-environment` | Climate & the Environment | ENVIRONMENT | 3 |
| `science-discovery` | Science & Discovery | SCIENCE | 3 |
| `art-culture` | Art, Culture & Identity | CULTURE | 2 |
| `language-communication` | Language & Communication | LINGUISTICS | 3 |

**`Topic` interface:**
```typescript
interface Topic {
  id: string;
  title: string;
  description: string;
  category: TopicCategory;
  depth: 1 | 2 | 3 | 4 | 5;  // vocabulary complexity
  keyTerms: string[];
  context: string;             // stored in sessions.topic_context
}
```

**`context` field** is stored verbatim in `sessions.topic_context` and passed to the LLM system prompt as `CONTEXT: {topicContext}`. Custom topics set `topic_context` to `null`.

---

## 13. TypeScript Types

**File:** `src/lib/supabase/types.ts`

Hand-authored (not auto-generated). All Row/Insert/Update shapes use `type` (not `interface`) — required for compatibility with Supabase's `GenericTable` constraint (`Record<string, unknown>`).

**To regenerate from live schema:**
```bash
npx supabase gen types typescript --project-id csheolzcojsogokdxhvr > src/lib/supabase/types.ts
```

**Key types:**
- `ProfileRow`, `WordRow`, `SessionRow`, `SessionMessageRow`, `SessionWordRow` — SELECT shapes
- `ProfileInsert`, `WordInsert`, `SessionInsert`, `SessionMessageInsert`, `SessionWordInsert` — INSERT shapes
- `Database` — top-level generic passed to `createClient<Database>()`
- `Database.public.Functions.insert_session_turn` — typed RPC definition

---

## 14. Critical Engineering Notes

### 14.1 React Compiler + `startTransition` Incompatibility

`babel-plugin-react-compiler` v1.0.0 (in `devDependencies`) transforms `startTransition(() => formAction(formData))` in a way that breaks the transition context. This causes the React console error:

> _"An async function with useActionState was called outside of a transition."_

**Permanent fix:** Use `<form action={formAction}>` + `<button type="submit">`. Form submissions are enrolled in a transition by the framework itself, at the DOM level, and are immune to compiler transformation. Never use `startTransition` with server actions in this project.

### 14.2 `redirect()` Inside `try/catch`

`redirect()` from `next/navigation` works by throwing a special `NEXT_REDIRECT` error. If this throw is caught by a `try/catch` block and not re-thrown, the redirect is silently swallowed.

**Pattern used throughout this codebase:**
```typescript
// redirect() OUTSIDE try/catch — safe, always propagates
try {
  // ... db work ...
} catch (err) {
  if (isRedirectError(err)) throw err;  // Re-throw NEXT_REDIRECT
  return { error: 'unexpected error' };
}
redirect(`/session/${sessionId}`);  // ← outside try/catch
```

`isRedirectError` is imported from `next/dist/client/components/redirect-error`.

### 14.3 `insert_session_turn` Unique Constraint (Migration 003)

The original constraint `session_messages_turn_unique` was `UNIQUE(session_id, turn_index)` — without `role`. Since `insert_session_turn` inserts both a `'user'` row and an `'assistant'` row with the **same** `turn_index`, the second INSERT always violated the constraint.

**Root cause discovered via:** Live schema inspection using Supabase MCP connector.

**Fix (Migration 003):** Drop and recreate as `UNIQUE(session_id, role, turn_index)`. This constraint is already applied to the live database.

### 14.4 Temporal Dead Zone (TDZ) in `VoiceSession.tsx`

`sendAudioBlob` MUST be declared before `handlePointerUp` in the component function body. `handlePointerUp`'s `useCallback` closes over `sendAudioBlob`, which is also a `const`. If `handlePointerUp` is declared first, its deps array evaluation accesses `sendAudioBlob` before the `const` is initialized, causing:

> _ReferenceError: Cannot access 'sendAudioBlob' before initialization_

This is a JavaScript TDZ (Temporal Dead Zone) error. The `// NOTE: sendAudioBlob must be declared BEFORE handlePointerUp` comment in the source documents this constraint.

### 14.5 Next.js 16 Dynamic Params are Promises

In Next.js 16, dynamic route segment params (`[id]`, `[sessionId]`) are `Promise` objects and must be `await`ed:

```typescript
// Server Component page
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;  // ← must await
}

// Route handler
export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;  // ← must await
}
```

---

## 15. Deferred Features

These features are designed in the schema and/or architecture but not yet implemented:

| Feature | Description | Relevant Code Location |
|---------|-------------|------------------------|
| Semantic lemmatization | Replace `naiveDetectWords` substring match with `compromise.js` NLP lemmatizer so `"running"` matches bank word `"run"` | `route.ts` — `naiveDetectWords()` |
| Word status updates | After session ends, update `words.times_used`, `words.status` for used words | New server action needed |
| `session_words` population | Populate `session_words` table during/after session for per-session word tracking | `route.ts` — after `insert_session_turn` |
| Session stats | Populate `sessions.duration_sec`, `words_used`, `words_assigned` | `completeSession` server action |
| Voice selection | Let users choose TTS voice via `profiles.voice_id` | `route.ts` — `voice: 'alloy'` hardcoded |
| Dashboard history | Full session history with word stats | `dashboard/page.tsx` — currently stub |
| Conversation history on resume | Load existing `session_messages` if user navigates back to an active session | `session/[id]/page.tsx` + `VoiceSession.tsx` |

---

## 16. Design System

**Theme name:** Obsidian Codex

**CSS custom properties (key tokens from `globals.css`):**

| Token | Description |
|-------|-------------|
| `--color-codex-bg` | Page background (near-black) |
| `--color-codex-surface` | Card / panel background |
| `--color-codex-border` | Subtle border |
| `--color-codex-text` | Primary text |
| `--color-codex-muted` | Secondary text |
| `--color-codex-faint` | Tertiary / placeholder text |
| `--color-codex-gold` | Accent — labels, CTA highlights |
| `--color-codex-teal` | Secondary accent — AI turns, tech category |
| `--color-codex-violet` | Psychology category |
| `--color-status-mastered` | Green — mastered word indicator |

**Typography stack:**
- `--font-cormorant` (Cormorant Garamond) — scholarly display / headings (`font-display` utility)
- `--font-space-mono` (Space Mono) — technical labels, data, counts (`font-mono` utility)
- `--font-dm-sans` (DM Sans) — body text / form text (default)

---

*Document generated from live source code and database schema. Last verified: 2026-03-20.*
