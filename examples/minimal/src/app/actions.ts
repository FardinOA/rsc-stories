'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';

export interface FollowState {
  followers: number;
  following: boolean;
  error?: string;
}

/** Server Action: follows a user and returns the new follower count. */
export async function follow(previous: FollowState, formData: FormData): Promise<FollowState> {
  const userId = String(formData.get('userId'));
  try {
    const followers = await db.users.follow(userId);
    revalidatePath('/');
    return { followers, following: true };
  } catch (error) {
    return { ...previous, error: (error as Error).message };
  }
}
