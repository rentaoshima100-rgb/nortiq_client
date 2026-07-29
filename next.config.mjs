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
    ];
  },
};

export default nextConfig;
