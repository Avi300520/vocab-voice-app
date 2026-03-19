/**
 * src/app/page.tsx
 *
 * Root route — immediately redirects to /login.
 * Middleware will bounce authenticated users straight to /dashboard.
 */
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/login');
}
