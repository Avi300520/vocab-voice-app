/**
 * sentry.edge.config.ts
 *
 * Sentry SDK initialisation for the Edge runtime.
 * Loaded automatically by @sentry/nextjs in the proxy (formerly middleware)
 * and any Edge Route Handlers.
 *
 * Note: the Edge runtime is a reduced subset of Node — avoid Node-only APIs here.
 * Set NEXT_PUBLIC_SENTRY_DSN in .env.local to activate.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Lower sample rate for the proxy — it runs on every request.
  tracesSampleRate: 0.1,

  debug: false,
});
