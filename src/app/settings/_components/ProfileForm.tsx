'use client';

/**
 * src/app/settings/_components/ProfileForm.tsx
 *
 * Client Component — profile update form.
 * Uses useActionState so the server action can return inline feedback
 * without a page redirect.
 */

import { useActionState } from 'react';
import { updateProfile, type ProfileActionState } from '@/app/actions/profile';
import type { ProfileRow } from '@/lib/supabase/types';

const INITIAL_STATE: ProfileActionState = { error: null, success: false };

interface Props {
  profile: ProfileRow;
}

export default function ProfileForm({ profile }: Props) {
  const [state, formAction, isPending] = useActionState(updateProfile, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-5">
      {/* Success banner */}
      {state.success && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          Profile updated successfully.
        </div>
      )}

      {/* Error banner */}
      {state.error && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}

      {/* Display name */}
      <div>
        <label htmlFor="display_name" className="block text-sm font-medium text-gray-700">
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          required
          defaultValue={profile.display_name}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Proficiency */}
      <div>
        <label htmlFor="proficiency" className="block text-sm font-medium text-gray-700">
          Proficiency level
        </label>
        <select
          id="proficiency"
          name="proficiency"
          defaultValue={profile.proficiency}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
          <option value="native">Native / Near-native</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60"
      >
        {isPending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
