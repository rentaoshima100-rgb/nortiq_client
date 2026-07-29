'use server';

import { redirect } from 'next/navigation';
import { isStaffEmail } from '@/lib/env';
import { createServerSupabase } from '@/lib/supabase/server';

export interface LoginState {
  error?: string;
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  if (!email || !password) return { error: 'メールアドレスとパスワードを入力してください' };

  if (!isStaffEmail(email)) {
    // STAFF_EMAILS に無いメールは、Supabase Auth を通っても社内画面には入れない
    return { error: 'このアカウントは社内メンバーとして登録されていません' };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: 'メールアドレスまたはパスワードが違います' };

  redirect('/admin');
}
