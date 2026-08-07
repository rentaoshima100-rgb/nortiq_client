import type { Locator, MatchedRule, Target } from './locator';

export interface InitResponse {
  project: { name: string; clientName: string };
  limits: { maxItemsPerRound: number; freeRounds: number };
  requestCount: number;
}

export interface PinDTO {
  id: string;
  seq: number;
  status: string;
  category: string;
  body: string;
  locator: Locator;
  createdAt: string;
}

export interface RoundDTO {
  id: string;
  seq: number;
  status: string;
  statusLabel: string;
  countsFree: boolean;
  rejectCount: number;
  itemCount: number;
  maxItems: number;
  freezeInDays: number | null;
  confirmInDays: number | null;
  canConfirm: boolean;
  canReject: boolean;
}

export interface RoundsResponse {
  /** false ならラウンドの締切・カウント・確認を行わない案件 */
  roundsEnabled: boolean;
  contract: { freeRounds: number; usedFreeRounds: number; currentIndex: number } | null;
  round: RoundDTO | null;
  carriedOverCount: number;
  requests: {
    id: string;
    seq: number;
    body: string;
    status: string;
    category: string;
    pagePath: string;
    createdAt: string;
    /** 社内から本人への確認。入っているとパネルに出る */
  question: string | null;
  answered: boolean;
  inCurrentRound: boolean;
    carriedOver: boolean;
  }[];
}

export interface RoundDiffResponse {
  round: { seq: number; status: string };
  hasBefore: boolean;
  hasAfter: boolean;
  items: {
    requestId: string;
    seq: number;
    body: string;
    before: string | null;
    after: string | null;
    diff: string | null;
    diffRatio: number | null;
  }[];
}

export interface CreateRequestPayload {
  projectKey: string;
  body: string;
  pagePath: string;
  siteSha: string | null;
  viewport: { w: number; h: number; dpr: number };
  scrollY: number;
  locator: Locator;
  target: Target | null;
  outerHTML: string;
  computed: Record<string, string>;
  cssRules: MatchedRule[];
  ua: string;
}

export interface SignedUpload {
  uploadUrl: string;
  storagePath: string;
  attachmentId: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createApi(base: string, token: string, projectKey: string) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(base + path, {
      ...init,
      credentials: 'omit', // Cookie は使わない（6.1）
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(init && init.headers ? (init.headers as Record<string, string>) : {}),
      },
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* 空ボディ */
    }
    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : '通信に失敗しました';
      throw new ApiError(res.status, msg);
    }
    return data as T;
  }

  return {
    init(): Promise<InitResponse> {
      return call<InitResponse>('/api/w/init', {
        method: 'POST',
        body: JSON.stringify({ projectKey }),
      });
    },

    /** 「確認したいこと」に答える */
    answerQuestion(requestId: string, answer: string): Promise<{ ok: boolean }> {
      return call<{ ok: boolean }>('/api/w/answer', {
        method: 'POST',
        body: JSON.stringify({ projectKey, requestId, answer }),
      });
    },

    listPins(pagePath: string): Promise<{ pins: PinDTO[] }> {
      const q =
        '?projectKey=' + encodeURIComponent(projectKey) + '&path=' + encodeURIComponent(pagePath);
      return call<{ pins: PinDTO[] }>('/api/w/pins' + q, { method: 'GET' });
    },

    /**
     * 当てられたピンの手がかりを打ち直す。
     * これをやらないと、サイトを直すたびロケータが古びて、いつか当たらなくなる。
     */
    reanchor(anchors: { id: string; locator: Locator }[]): Promise<{ updated: number }> {
      return call<{ updated: number }>('/api/w/pins', {
        method: 'POST',
        body: JSON.stringify({ projectKey, anchors }),
      });
    },

    getRounds(): Promise<RoundsResponse> {
      return call<RoundsResponse>(
        '/api/w/rounds?projectKey=' + encodeURIComponent(projectKey),
        { method: 'GET' },
      );
    },

    getRoundDiff(roundId: string): Promise<RoundDiffResponse> {
      return call<RoundDiffResponse>(
        '/api/w/rounds/' + roundId + '/diff?projectKey=' + encodeURIComponent(projectKey),
        { method: 'GET' },
      );
    },

    confirmRound(roundId: string): Promise<{ ok: true }> {
      return call<{ ok: true }>('/api/w/rounds/' + roundId + '/confirm', {
        method: 'POST',
        body: JSON.stringify({ projectKey }),
      });
    },

    rejectRound(roundId: string, requestIds: string[]): Promise<{ ok: true; rejectCount: number }> {
      return call<{ ok: true; rejectCount: number }>('/api/w/rounds/' + roundId + '/reject', {
        method: 'POST',
        body: JSON.stringify({ projectKey, requestIds }),
      });
    },

    createRequest(payload: CreateRequestPayload): Promise<{ id: string; seq: number; carriedOver?: boolean }> {
      return call<{ id: string; seq: number; carriedOver?: boolean }>('/api/w/requests', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    signAttachment(input: {
      requestId: string;
      filename: string;
      mime: string;
      bytes: number;
      width: number | null;
      height: number | null;
      kind: 'material' | 'reference';
    }): Promise<SignedUpload> {
      return call<SignedUpload>('/api/w/attachments', {
        method: 'POST',
        body: JSON.stringify({ projectKey, ...input }),
      });
    },
  };
}

export type Api = ReturnType<typeof createApi>;

/** Supabase の署名付きアップロード URL へ直接 PUT する（6.9） */
export async function putToSignedUrl(url: string, file: File): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
  });
  if (!res.ok) throw new ApiError(res.status, '画像のアップロードに失敗しました');
}
