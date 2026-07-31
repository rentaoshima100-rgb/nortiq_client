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

export function privateKeyFromEnv() {
  const b64 = process.env.GITHUB_APP_PRIVATE_KEY_B64;
  if (b64) return Buffer.from(b64, 'base64').toString('utf8');
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (raw) return raw.replace(/\\n/g, '\n');
  throw new Error('GITHUB_APP_PRIVATE_KEY_B64 または GITHUB_APP_PRIVATE_KEY が必要です');
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
