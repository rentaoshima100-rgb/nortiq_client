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

    listPins(pagePath: string): Promise<{ pins: PinDTO[] }> {
      const q =
        '?projectKey=' + encodeURIComponent(projectKey) + '&path=' + encodeURIComponent(pagePath);
      return call<{ pins: PinDTO[] }>('/api/w/pins' + q, { method: 'GET' });
    },

    createRequest(payload: CreateRequestPayload): Promise<{ id: string; seq: number }> {
      return call<{ id: string; seq: number }>('/api/w/requests', {
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
