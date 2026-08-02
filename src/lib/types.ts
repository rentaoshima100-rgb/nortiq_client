export type Stack = 'next' | 'static' | 'single-file';
export type RequestCategory = 'minor' | 'spec_change' | 'defect' | 'unclassified';
export type RequestSubtype = 'text' | 'asset' | 'style' | 'order';
export type RequestStatus =
  | 'received'
  | 'in_progress'
  | 'done'
  | 'wont_fix'
  | 'carried_over';
export type AttachmentKind = 'material' | 'reference';
export type MatchTier = 'confirmed' | 'provisional' | 'weak' | 'stale';

export interface ProjectRow {
  id: string;
  name: string;
  client_name: string;
  site_url: string;
  site_origin: string;
  /** site_origin に加えて許可するオリジン。独自ドメインへの切り替え期間などに使う */
  extra_origins: string[];
  snippet_key: string;
  repo_owner: string | null;
  repo_name: string | null;
  default_branch: string | null;
  /** GitHub App のインストール ID。オーナーが承認したときに決まる（0012） */
  gh_installation_id: number | null;
  /** 既定は false（PR を出すだけ）。直接コミットは案件ごとに明示的に許可する */
  allow_direct_commit: boolean;
  /** スニペットを入れたコミット。本番に出たかの判定に使う */
  snippet_commit_sha: string | null;
  snippet_ref_url: string | null;
  snippet_installed_at: string | null;
  stack: Stack;
  has_nq_id: boolean;
  free_rounds: number;
  max_items_per_round: number;
  dispatch_debounce_minutes: number;
  freeze_idle_days: number;
  auto_confirm_days: number;
  max_dispatch_per_day: number;
  ai_enabled: boolean;
  rounds_enabled: boolean;
  asset_swap_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientSessionRow {
  token_hash: string;
  project_id: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

/** 設計 6.7 の locator。ウィジェットと共有する形。 */
export interface Locator {
  nqId: string | null;
  nqOrdinal: number | null;
  nqCount: number | null;
  sourceRef: string | null;
  tag: string;
  textHash: string | null;
  textSample: string;
  cssPath: string;
  bbox: { x: number; y: number; w: number; h: number };
  viewportW: number;
  docHeight: number;
  /** img / picture のグループ内判別子（6.7）。currentSrc ではなく src 属性。 */
  srcAttr?: string | null;
}

/** 設計 6.8 の target（img / picture のときだけ入る） */
export interface RequestTarget {
  srcAttr: string | null;
  srcset: string | null;
  currentSrc: string | null;
  naturalW: number | null;
  naturalH: number | null;
}

export interface MatchedRule {
  href: string | null;
  selector: string;
  cssText: string;
}

export interface RequestRow {
  id: string;
  project_id: string;
  round_id: string | null;
  seq: number;
  body: string;
  category: RequestCategory;
  subtype: RequestSubtype | null;
  status: RequestStatus;
  page_path: string;
  viewport_w: number;
  viewport_h: number;
  scroll_y: number;
  locator: Locator;
  nq_id: string | null;
  nq_ordinal: number | null;
  site_sha: string | null;
  source_ref: string | null;
  target: RequestTarget | null;
  outer_html: string | null;
  computed: Record<string, string> | null;
  css_rules: MatchedRule[] | null;
  created_at: string;
  updated_at: string;
}

export interface AttachmentRow {
  id: string;
  request_id: string;
  storage_path: string;
  filename: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  kind: AttachmentKind;
  created_at: string;
}
