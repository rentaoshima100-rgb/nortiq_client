/**
 * t の既定値を恒等関数から plainT に差し替える
 *
 * 恒等関数は差し込みを素通しするので、`{n}件をまとめました` が
 * そのまま出る（実測）。日本語のまま差し込みだけは行う plainT に寄せる。
 */
import fs from 'node:fs';

const files = process.argv.slice(2);
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  const before = s;

  s = s.split('t: T = (s) => s').join('t: T = plainT');
  s = s.split('opts.t ?? ((s: string) => s)').join('opts.t ?? plainT');

  if (s === before) continue;

  if (!/plainT/.test(before)) {
    // 既存の i18n-core の import に足す。無ければ新しく足す
    if (/from '@\/lib\/i18n-core'/.test(s)) {
      s = s.replace(
        /import type \{([^}]*)\} from '@\/lib\/i18n-core';/,
        (m, inner) => `import { plainT } from '@/lib/i18n-core';\nimport type {${inner}} from '@/lib/i18n-core';`,
      );
    } else if (/from '\.\/i18n-core'/.test(s)) {
      s = s.replace(
        /import type \{([^}]*)\} from '\.\/i18n-core';/,
        (m, inner) => `import { plainT } from './i18n-core';\nimport type {${inner}} from './i18n-core';`,
      );
    }
  }

  fs.writeFileSync(f, s, 'utf8');
  console.log('  直した:', f);
}
