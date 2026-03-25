'use client';

/**
 * src/app/session/[id]/summary/_components/SummaryActions.tsx
 *
 * Navigation buttons for the post-session summary page.
 */

import Link from 'next/link';

interface Props {
  topic: string;
}

export default function SummaryActions({ topic }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 animate-fade-up animate-fade-up-delay-3">
      <Link
        href={`/setup-session?topic=${encodeURIComponent(topic)}`}
        className="btn-primary no-underline"
      >
        Practice Again
      </Link>
      <Link href="/words" className="btn-ghost no-underline">
        View Words
      </Link>
      <Link href="/dashboard" className="btn-ghost no-underline">
        Dashboard
      </Link>
    </div>
  );
}
