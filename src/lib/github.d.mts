/**
 * github.mjs の型。実装はワーカーと共有するため .mjs のまま置いている
 * （二重実装を作らないため。App 認証の経路はここ1箇所にする）。
 */

export interface GhInstallation {
  id: number;
  account: { login: string } | null;
  repository_selection: 'all' | 'selected';
}

export interface GhRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
}

export interface GhContentFile {
  type: 'file';
  path: string;
  sha: string;
  size: number;
  /** base64。ディレクトリを取ったときは undefined */
  content?: string;
  encoding?: string;
}

export interface GhCommitResult {
  content: { path: string; sha: string } | null;
  commit: { sha: string; html_url: string };
}

export interface GhPull {
  number: number;
  html_url: string;
  head: { ref: string };
}

export interface GhRef {
  ref: string;
  object: { sha: string; type: string };
}

export interface GitHubClient {
  app(): Promise<{ id: number; slug: string; name: string }>;
  installations(): Promise<GhInstallation[]>;
  repos(installationId: number): Promise<GhRepo[]>;
  installationToken(installationId: number): Promise<string>;
  createBranch(
    installationId: number,
    owner: string,
    repo: string,
    branch: string,
    fromSha: string,
  ): Promise<GhRef>;
  getRef(installationId: number, owner: string, repo: string, ref: string): Promise<GhRef>;
  getFile(
    installationId: number,
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<GhContentFile | GhContentFile[]>;
  putFile(
    installationId: number,
    owner: string,
    repo: string,
    path: string,
    contentBuffer: Uint8Array | Buffer | string,
    message: string,
    branch?: string,
    sha?: string,
  ): Promise<GhCommitResult>;
  createPull(
    installationId: number,
    owner: string,
    repo: string,
    opts: { title: string; head: string; base: string; body: string },
  ): Promise<GhPull>;
  comment(
    installationId: number,
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<unknown>;
  getTree(
    installationId: number,
    owner: string,
    repo: string,
    ref: string,
  ): Promise<{ truncated: boolean; entries: GhTreeEntry[] }>;
  deployments(
    installationId: number,
    owner: string,
    repo: string,
    sha: string,
  ): Promise<GhDeployment[]>;
  deploymentStatuses(
    installationId: number,
    owner: string,
    repo: string,
    deploymentId: number,
  ): Promise<GhDeploymentStatus[]>;
}

export interface GhTreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

export interface GhDeployment {
  id: number;
  environment: string;
  created_at: string;
}

export interface GhDeploymentStatus {
  state: 'queued' | 'in_progress' | 'success' | 'failure' | 'error' | 'inactive' | 'pending';
  environment_url: string | null;
  created_at: string;
}

export function appJwt(appId: string | number, privateKeyPem: string): string;
export function normalizePem(input: string, label?: string): string;
export function privateKeyFromEnv(): string;
export function appIdFromEnv(): string;
export function installationIdFromEnv(): number;
export function createGitHub(appId: string | number, privateKeyPem: string): GitHubClient;
