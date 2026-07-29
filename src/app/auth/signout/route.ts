import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { appUrl } from '@/lib/env';

export const runtime = 'nodejs';

export async function POST() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', appUrl()), { status: 303 });
}
