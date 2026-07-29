// 検証用のデモサイトを別オリジンで配信する。
// ウィジェットはクライアントサイトのオリジンで動くため、同一オリジンで試すと
// CORS と Origin 検証（6.1）を素通りしてしまい、本番と違う経路を確かめることになる。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../demo');
const port = Number(process.env.DEMO_PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    if (!extname(path)) path += '.html';
    const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}).listen(port, () => {
  console.log(`  デモサイト: http://localhost:${port}`);
  console.log(`  案件の site_url に http://localhost:${port} を登録してください`);
});
