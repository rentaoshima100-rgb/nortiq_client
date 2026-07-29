import { redirect } from 'next/navigation';
import { isStaffEmail } from '@/lib/env';
import { createServerSupabase } from '@/lib/supabase/server';
import type { Actor } from '@/lib/events';

export interface StaffUser {
  id: string;
  email: string;
}

/**
 * 社内画面の入口で必ず通す。
 * middleware でも弾いているが、middleware は境界として当てにしない。
 */
export async function requireStaff(): Promise<StaffUser> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');
  if (!isStaffEmail(user.email)) redirect('/login?e=not-staff');

  return { id: user.id, email: user.email as string };
}

export function staffActor(user: StaffUser): Actor {
  return { type: 'staff', id: user.email };
}
