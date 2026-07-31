/**
 * GitHub App 認証（設計 4.1 / 9.7）
 *
 * Octokit は入れず、REST を直接叩く。JWT の署名も node の crypto でできる。
 * ワーカーの依存を増やさないため。
 *
 * 認証は2段階:
 *   ① App の秘密鍵で JWT を作る（有効10分）
 *   ② JWT でインストールトークンを取る（有効1時間）
 * ファイル操作は②のトークンで行う。
 */
import { createSign } from 'node:crypto';

const API = 'https://api.github.com';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function appJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // iat を 60秒 巻き戻す。GitHub 側との時計のズレで弾かれるのを避けるため。
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = b64url(signer.sign(privateKeyPem));
  return `${header}.${payload}.${sig}`;
}

/**
 * GitHub Actions では `GITHUB_` で始まるシークレット名が予約されていて使えない。
 * そのため NQ_GH_* も受け付ける。手元の .env.local は GITHUB_* のままでよい。
 */
/**
 * 貼り付けで崩れた PEM を直す。
 *
 * 秘密鍵は人の手でコピペされるので、次のどれかで壊れる。
 *   - Windows からのコピーで CRLF になる
 *   - 改行が失われて1行になる
 *   - 環境変数として渡すために \n をリテラルで書いてある
 *   - 末尾の改行が落ちている
 * どれも `DECODER routines::unsupported` という同じ顔で落ちるので、
 * ここで吸収する。
 */
export function normalizePem(input) {
  let s = String(input).replace(/\\n/g, '\n').replace(/\r/g, '').trim();

  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(s);
  if (!m) return s.endsWith('\n') ? s : s + '\n';

  const label = m[1];
  const body = m[2].replace(/\s+/g, '');
  const wrapped = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${wrapped.join('\n')}\n-----END ${label}-----\n`;
}

export function privateKeyFromEnv() {
  const b64 = process.env.NQ_GH_APP_PRIVATE_KEY_B64 || process.env.GITHUB_APP_PRIVATE_KEY_B64;
  if (b64) return normalizePem(Buffer.from(b64, 'base64').toString('utf8'));
  const raw = process.env.NQ_GH_APP_PRIVATE_KEY || process.env.GITHUB_APP_PRIVATE_KEY;
  if (raw) return normalizePem(raw);
  throw new Error('NQ_GH_APP_PRIVATE_KEY（または GITHUB_APP_PRIVATE_KEY_B64）が必要です');
}

export function appIdFromEnv() {
  const v = process.env.NQ_GH_APP_ID || process.env.GITHUB_APP_ID;
  if (!v) throw new Error('NQ_GH_APP_ID（または GITHUB_APP_ID）が必要です');
  return v;
}

export function installationIdFromEnv() {
  const v = process.env.NQ_GH_INSTALLATION_ID || process.env.GITHUB_APP_INSTALLATION_ID;
  if (!v) throw new Error('NQ_GH_INSTALLATION_ID（または GITHUB_APP_INSTALLATION_ID）が必要です');
  return Number(v);
}


async function gh(path, { token, method = 'GET', body, accept } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Accept: accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nortiq-revise',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export function createGitHub(appId, privateKeyPem) {
  const jwt = appJwt(appId, privateKeyPem);
  let cachedToken = null;
  let cachedFor = null;
  let cachedUntil = 0;

  async function installationToken(installationId) {
    if (cachedToken && cachedFor === installationId && Date.now() < cachedUntil - 60_000) {
      return cachedToken;
    }
    const res = await gh(`/app/installations/${installationId}/access_tokens`, {
      token: jwt,
      method: 'POST',
    });
    cachedToken = res.token;
    cachedFor = installationId;
    cachedUntil = new Date(res.expires_at).getTime();
    return cachedToken;
  }

  return {
    /** App 自身の情報 */
    app: () => gh('/app', { token: jwt }),

    /** インストール一覧（Installation ID はここで分かる） */
    installations: () => gh('/app/installations', { token: jwt }),

    /** そのインストールで触れるリポジトリ */
    async repos(installationId) {
      const token = await installationToken(installationId);
      const res = await gh('/installation/repositories?per_page=100', { token });
      return res.repositories;
    },

    installationToken,

    /** ブランチを作る（9.7: ラウンドで1本） */
    async createBranch(installationId, owner, repo, branch, fromSha) {
      const token = await installationToken(installationId);
      return gh(`/repos/${owner}/${repo}/git/refs`, {
        token,
        method: 'POST',
        body: { ref: `refs/heads/${branch}`, sha: fromSha },
      });
    },

    async getRef(installationId, owner, repo, ref) {
      const token = await installationToken(installationId);
      return gh(`/repos/${owner}/${repo}/git/ref/${ref}`, { token });
    },

    /** ファイルを取る。返るのは { content(base64), sha } */
    async getFile(installationId, owner, repo, path, ref) {
      const token = await installationToken(installationId);
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      return gh(`/repos/${owner}/${repo}/contents/${encodeURI(path)}${q}`, { token });
    },

    /**
     * ファイルを書く。テキストもバイナリも同じ経路。
     * 素材差し替え（9.10）はここをそのまま使う。
     */
    async putFile(installationId, owner, repo, path, contentBuffer, message, branch, sha) {
      const token = await installationToken(installationId);
      return gh(`/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
        token,
        method: 'PUT',
        body: {
          message,
          content: Buffer.from(contentBuffer).toString('base64'),
          branch,
          ...(sha ? { sha } : {}),
        },
      });
    },

    async createPull(installationId, owner, repo, { title, head, base, body }) {
      const token = await installationToken(installationId);
      return gh(`/repos/${owner}/${repo}/pulls`, {
        token,
        method: 'POST',
        body: { title, head, base, body },
      });
    },

    async comment(installationId, owner, repo, number, body) {
      const token = await installationToken(installationId);
      return gh(`/repos/${owner}/${repo}/issues/${number}/comments`, {
        token,
        method: 'POST',
        body: { body },
      });
    },
  };
}
