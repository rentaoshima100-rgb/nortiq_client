/**
 * 写真の差し替え。
 *
 * GET  … どのファイルが置き換わるかを返すだけ（リポジトリは変えない）
 * POST … 差し替えて PR を出す。**自動マージはしない（9.8）**
 */
import { getT } from '@/lib/i18n';
import { applyAssetSwap, planAssetSwap } from '@/lib/asset-swap';
import { currentStaff, staffActor } from '@/lib/staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// リポジトリのツリーを引いて画像を1枚 PUT する。長くはならない
export const maxDuration = 120;

export async function GET(req: Request) {
  const t = await getT();
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: t('権限がありません') }, { status: 403 });

  const requestId = new URL(req.url).searchParams.get('requestId');
  if (!requestId) return Response.json({ error: t('必要な項目がありません') }, { status: 400 });

  return Response.json(await planAssetSwap(requestId, t));
}

export async function POST(req: Request) {
  const t = await getT();
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: t('権限がありません') }, { status: 403 });

  let b: { requestId?: string; file?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return Response.json({ error: t('リクエストが不正です') }, { status: 400 });
  }
  if (!b.requestId) return Response.json({ error: t('必要な項目がありません') }, { status: 400 });

  return Response.json(await applyAssetSwap(b.requestId, staffActor(staff), { file: b.file, t }));
}
