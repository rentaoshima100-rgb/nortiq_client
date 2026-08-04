'use server';

import { redirect } from 'next/navigation';
import { isStaffEmail } from '@/lib/env';
import { getT } from '@/lib/i18n';
import { createServerSupabase } from '@/lib/supabase/server';

export interface LoginState {
  error?: string;
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getT();
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  if (!email || !password) return { error: t('メールアドレスとパスワードを入力してください') };

  if (!isStaffEmail(email)) {
    // STAFF_EMAILS に無いメールは、Supabase Auth を通っても社内画面には入れない
    return { error: t('このアカウントは社内メンバーとして登録されていません') };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: t('メールアドレスまたはパスワードが違います') };

  redirect('/admin');
}
