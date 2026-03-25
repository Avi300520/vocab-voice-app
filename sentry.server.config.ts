/**
 * sentry.server.config.ts
 *
 * Sentry SDK initialisation for the Node.js server runtime.
 * Loaded automatically by @sentry/nextjs in Server Components, Route Handlers,
 * and Server Actions.
 *
 * Set NEXT_PUBLIC_SENTRY_DSN in .env.local to activate.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 1.0,

  debug: false,
});
