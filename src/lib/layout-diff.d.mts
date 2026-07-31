/**
 * layout-diff.mjs の型。実装はワーカーと共有するため .mjs のまま置いている
 * （二重実装を作らないため。設計 7.4 の判定はここ1箇所だけにする）。
 */

export interface LayoutEntry {
  key: string | null;
  ord: number | null;
  tag: string;
  path: string;
  text: string;
  srcAttr: string | null;
  src: string | null;
  styleHash: number;
  style: Record<string, string>;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface LayoutDiff {
  kind: 'changed' | 'added' | 'removed';
  changeFields: string[];
  elementKey: string;
  nqId: string | null;
  ord: number | null;
  tag: string;
  bbox: { x: number; y: number; w: number; h: number };
  before: { text: string; style: Record<string, string>; src: string | null; bbox: unknown } | null;
  after: { text: string; style: Record<string, string>; src: string | null; bbox: unknown } | null;
}

export function joinMaps(
  before: LayoutEntry[],
  after: LayoutEntry[],
): { pairs: [LayoutEntry, LayoutEntry][]; removed: LayoutEntry[]; added: LayoutEntry[] };

export function classify(
  before: LayoutEntry[],
  after: LayoutEntry[],
): { diffs: LayoutDiff[]; movedCount: number; pairCount: number };
