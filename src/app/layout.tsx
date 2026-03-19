import type { Metadata } from 'next';
import { Cormorant_Garamond, Space_Mono, DM_Sans } from 'next/font/google';
import './globals.css';

/**
 * Obsidian Codex typography stack:
 *   Cormorant Garamond — scholarly display / headings
 *   Space Mono         — technical labels, data, counts
 *   DM Sans            — clean readable body / form text
 */
const cormorant = Cormorant_Garamond({
  variable: '--font-cormorant',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
});

const spaceMono = Space_Mono({
  variable: '--font-space-mono',
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
});

const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'VocabVoice — Intelligent Language Practice',
  description: 'Voice-based AI language learning with curated intellectual topics.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${spaceMono.variable} ${dmSans.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
