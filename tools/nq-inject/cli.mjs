#!/usr/bin/env node
/**
 * クライアントサイトのリポジトリで、ビルドの直前に走らせる。
 *
 *   node nq-inject/cli.mjs --root . --out .nq
 *
 * package.json:
 *   "prebuild": "node tools/nq-inject/cli.mjs --root . --out .nq"
 *
 * ソースを その場で 書き換える。Vercel / CI のチェックアウトは使い捨てなので
 * 問題にならないが、手元で試すときは --dry を付けること。
 *
 * 対応表（9.3）は .nq/nqmap.json に出す。リポジトリにはコミットしない。
 * 毎ビルドで diff ノイズが出るため、Storage に SHA をキーにして置く。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { injectSource } from './index.mjs';

const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes('--' + name);

const root = opt('root', '.');
const outDir = opt('out', '.nq');
const dry = flag('dry');
const injectSourceAttr = flag('source') || process.env.NQ_INJECT_SOURCE === '1';

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'out',
  'dist',
  'build',
  '.vercel',
  '.nq',
  'public',
]);
const EXT = /\.(jsx|tsx)$/;

function walkDir(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkDir(p, acc);
    else if (EXT.test(name)) acc.push(p);
  }
  return acc;
}

const files = walkDir(root);
const map = {};
let injected = 0;
let touched = 0;
let skippedComponents = 0;
const failures = [];

for (const file of files) {
  const rel = relative(root, file).split(sep).join('/');
  let code;
  try {
    code = readFileSync(file, 'utf8');
  } catch (e) {
    failures.push([rel, String(e.message)]);
    continue;
  }
  if (code.includes('data-nq-id=')) {
    // すでに注入済み（二重実行）。触らない。
    continue;
  }
  try {
    const res = injectSource(code, rel, { injectSource: injectSourceAttr });
    if (res.count > 0) {
      if (!dry) writeFileSync(file, res.code, 'utf8');
      injected += res.count;
      touched++;
      Object.assign(map, res.map);
    }
    skippedComponents += res.skippedComponents;
  } catch (e) {
    // 1ファイルの構文で全体を止めない。読めなかったものは必ず報告する。
    failures.push([rel, String(e.message).split('\n')[0]]);
  }
}

if (!dry) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'nqmap.json'), JSON.stringify(map, null, 0), 'utf8');
}

const ids = Object.keys(map);
console.log(`  nq-inject: ${files.length} ファイル走査 / ${touched} ファイル書き換え`);
console.log(`             ${injected} 箇所に data-nq-id を注入（一意な id: ${ids.length}）`);
console.log(`             自作コンポーネントの要素 ${skippedComponents} 件はスキップ`);
if (!dry) console.log(`             対応表: ${join(outDir, 'nqmap.json')}`);
if (dry) console.log('             --dry のためファイルは書き換えていない');

if (failures.length) {
  console.log(`\n  解析できなかったファイル ${failures.length} 件:`);
  for (const [f, m] of failures.slice(0, 10)) console.log(`   - ${f}: ${m}`);
  if (failures.length > 10) console.log(`   … ほか ${failures.length - 10} 件`);
}

// 1件も入らなかったときは、黙って成功にしない。
if (injected === 0) {
  console.error('\n  data-nq-id が1件も注入されませんでした。--root の指定を確認してください。');
  process.exit(1);
}
