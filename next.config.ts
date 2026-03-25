import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactCompiler: true,
};

export default withSentryConfig(nextConfig, {
  /**
   * Source-map upload and release tracking.
   * Requires SENTRY_ORG, SENTRY_PROJECT, and SENTRY_AUTH_TOKEN in CI env.
   * In local dev these are unset — the build still succeeds, maps just aren't uploaded.
   */
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Suppress Sentry CLI output during local builds.
  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces in Sentry.
  widenClientFileUpload: true,

  // Hide server-side source maps from the client bundle.
  hideSourceMaps: true,

  // Suppress the Sentry logger at runtime to keep logs clean.
  disableLogger: true,
});
