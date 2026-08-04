import { LoginForm } from './form';
import { getT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const t = await getT();
  const { e } = await searchParams;
  const notice =
    e === 'not-staff'
      ? t('このアカウントは社内メンバーとして登録されていません（STAFF_EMAILS を確認してください）')
      : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-xl font-bold">Nortiq Revise</h1>
          <p className="mt-1 text-sm text-slate-500">{t('社内ダッシュボード')}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm notice={notice} />
        </div>
        <p className="mt-4 text-xs text-slate-400">
          アカウントは Supabase の Authentication から発行します。
        </p>
      </div>
    </main>
  );
}
