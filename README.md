# VocabVoice

A voice-first English language learning app built with Next.js 16, Supabase, and OpenAI.

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS v4
- **Backend**: Supabase (Postgres + Auth + RLS), Server Actions, Route Handlers
- **AI**: OpenAI Whisper (STT), GPT-4o-mini (conversation), TTS-1 (speech synthesis)
- **Spaced Repetition**: FSRS algorithm (Free Spaced Repetition Scheduler)
- **Error Monitoring**: Sentry (`@sentry/nextjs`)

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project (see `/migrations` for schema)
- An OpenAI API key

### Environment Variables

Create `.env.local` in the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# OpenAI
OPENAI_API_KEY=sk-...

# App URL — used for absolute redirects (password reset emails, etc.)
# Development: http://localhost:3000
# Production:  https://yourdomain.com
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Sentry (optional — app runs without these)
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug
```

### Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Applying Migrations

Migrations live in `/migrations`. Apply them in order via the Supabase dashboard SQL editor or the Supabase CLI:

```bash
supabase db push
```

## Production Checklist

Before deploying to production, ensure:

1. All environment variables above are set in your hosting platform.
2. `NEXT_PUBLIC_SITE_URL` is set to the live domain (used in password-reset `redirectTo`).
3. Supabase email templates are customised (Auth → Email Templates in the dashboard).
4. Row Level Security is enabled on all tables (verified via Supabase dashboard).
5. Sentry DSN, org, and project are configured.

---

## Known Tech Debt

### Sentry / Next.js 16 Deprecation Warnings

**Symptoms**: The dev server and build output emit warnings like:

```
⚠ The "experimental.instrumentationHook" option has been deprecated.
⚠ The "experimental.serverComponentsExternalPackages" option has been moved to "serverExternalPackages".
```

**Root cause**: `@sentry/nextjs` injects these deprecated config keys inside `withSentryConfig()`. They were valid in Next.js ≤14 but have been renamed/promoted in Next.js 15–16. Sentry has not yet released a Next.js 16-compatible version of `withSentryConfig`.

**Impact**: Non-fatal — the app builds and runs correctly. Sentry captures errors as expected.

**Resolution**: Upgrade `@sentry/nextjs` once a version is released with native Next.js 16 support. Track at: https://github.com/getsentry/sentry-javascript/issues

---

### Rate Limiting — DB-backed (MVP)

The current rate limiter (`check_user_rate_limit` RPC, migration 016) counts messages in sessions started within the last hour. This is a conservative proxy that requires no external infrastructure.

**Post-launch**: Replace with a proper sliding-window implementation backed by Upstash Redis or a Supabase Edge Function with a dedicated `rate_limit_buckets` table for sub-second precision.

---

### Word Detection — Naive Substring Matching

`naiveDetectWords()` in `sessions/[sessionId]/turn/route.ts` uses simple `String.includes()`. It does not handle inflections (run/running/ran) or case folding beyond `.toLowerCase()`.

**Post-launch**: Replace with `compromise.js` lemmatizer or a server-side NLP step.
