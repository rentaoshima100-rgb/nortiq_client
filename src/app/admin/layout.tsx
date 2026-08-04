import Link from 'next/link';
import { getLocale, getT } from '@/lib/i18n';
import { LocaleProvider } from '@/lib/i18n-client';
import { requireStaff } from '@/lib/staff';
import { LangSwitch } from './lang-switch';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const locale = await getLocale();
  const t = await getT();

  return (
    <LocaleProvider locale={locale}>
      <div className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
            <Link href="/admin" className="font-bold">
              Nortiq Revise
            </Link>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {t('社内')}
            </span>
            <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
              <LangSwitch />
              <span>{user.email}</span>
              <form action="/auth/signout" method="post">
                <button className="rounded-lg px-2 py-1 hover:bg-slate-100">
                  {t('ログアウト')}
                </button>
              </form>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </div>
    </LocaleProvider>
  );
}
