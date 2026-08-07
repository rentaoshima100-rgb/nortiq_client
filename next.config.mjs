/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // w.js はクライアントサイト（別オリジン）から <script src> で読まれる。
        // 素の <script> 取得に CORS は不要だが、将来 fetch で取りに来る経路と
        // sourcemap 参照のために許可しておく。中身に秘密は含まれない。
        source: '/w.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        // 切り分け用の照合器。w.js と同じ locator.ts を束ねたもの。
        // 対象サイトのページから import して、実際の DOM に当てて確かめる。
        // 秘密は含まない。読み込まれるのは社内が明示的に呼んだときだけ。
        source: '/nq-replay.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default nextConfig;
