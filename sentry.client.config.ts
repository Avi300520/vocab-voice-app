/**
 * sentry.client.config.ts
 *
 * Sentry SDK initialisation for the browser bundle.
 * Loaded automatically by @sentry/nextjs before any client-side code runs.
 *
 * Set NEXT_PUBLIC_SENTRY_DSN in .env.local to activate.
 * Leave it unset in development to suppress noise while iterating.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 100 % of transactions in dev/staging; tune down for high-traffic prod.
  tracesSampleRate: 1.0,

  // Session Replay — record 10 % of sessions, 100 % on error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Don't print Sentry debug output to the console in production.
  debug: false,
});
