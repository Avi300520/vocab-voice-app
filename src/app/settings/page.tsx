/**
 * src/app/settings/page.tsx
 *
 * User Profile / Settings page — Server Component.
 * Auth guard: proxy redirects unauthenticated users to /login.
 * Fetches the current profile and renders the ProfileForm client component.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ProfileForm from './_components/ProfileForm';

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    redirect('/dashboard');
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-lg space-y-8">

        {/* Back nav */}
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profile &amp; Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Update your display name and proficiency level.
          </p>
        </div>

        <ProfileForm profile={profile} />

      </div>
    </main>
  );
}
