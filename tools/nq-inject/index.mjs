/**
 * data-nq-id の注入（設計 6.6）
 *
 * Babel プラグインとしては動かせない。実測（2026-07）:
 *   - babel.config.js を置くと SWC が無効になり、next/font が
 *     「requires SWC」で落ちる
 *   - Turbopack は Babel 設定を見つけた時点でビルドを拒否する
 * そこで「Next.js が動く前にソースを書き換える」方式にした。
 * Next からは普通のソースに見えるので、SWC も Turbopack もそのまま使える。
 *
 * 整形は壊さない。AST は位置を知るためだけに使い、元のテキストに
 * 属性文字列を差し込む。
 */
import { parse } from '@babel/parser';
import { createHash } from 'node:crypto';

/** 注入対象のタグ（6.6） */
const ALWAYS_TAGS = new Set([
  'img',
  'picture',
  'svg',
  'video',
  'button',
  'a',
  'input',
  'label',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'section',
  'article',
  'header',
  'footer',
  'nav',
]);

export function nqId(relPath, structPath) {
  return createHash('sha1')
    .update(relPath + '|' + structPath, 'utf8')
    .digest('hex')
    .slice(0, 8);
}

function parseSource(code, filename) {
  return parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    plugins: [
      'jsx',
      /\.tsx?$/.test(filename) ? 'typescript' : null,
      'decorators-legacy',
      'classProperties',
    ].filter(Boolean),
  });
}

/** JSXOpeningElement の名前（intrinsic のみ対象。大文字始まりは自作コンポーネント） */
function tagNameOf(node) {
  const n = node.name;
  if (n.type === 'JSXIdentifier') return n.name;
  return null; // JSXMemberExpression / JSXNamespacedName は対象外
}

function hasAttr(openingEl, name) {
  return openingEl.attributes.some(
    (a) => a.type === 'JSXAttribute' && a.name && a.name.name === name,
  );
}

/** 選択対象になりえないタグ（6.3 で選択不可にしているものと揃える） */
const NEVER_TAGS = new Set([
  'html',
  'body',
  'head',
  'script',
  'style',
  'meta',
  'link',
  'title',
  'noscript',
  'br',
]);

/** 式の中に JSX が含まれるか（ループ描画や条件描画の判定） */
function containsJsx(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return false;
  if (Array.isArray(node)) return node.some((n) => containsJsx(n, depth + 1));
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
    const v = node[key];
    if (v && typeof v === 'object' && containsJsx(v, depth + 1)) return true;
  }
  return false;
}

/**
 * 直下にテキスト（静的・動的いずれか）を持つか。
 * {items.map(i => <li/>)} のように中身が JSX の式はテキストではない。
 * ここを緩くすると、ラッパの div や ul にまで id が付いて本番HTMLが太る。
 */
function hasOwnText(element) {
  for (const child of element.children ?? []) {
    if (child.type === 'JSXText' && child.value.trim()) return true;
    if (
      child.type === 'JSXExpressionContainer' &&
      child.expression &&
      child.expression.type !== 'JSXEmptyExpression' &&
      !containsJsx(child.expression)
    ) {
      return true;
    }
  }
  return false;
}

function shouldInject(element, tag) {
  if (NEVER_TAGS.has(tag)) return false;
  if (hasAttr(element.openingElement, 'data-nq-id')) return false;
  if (hasAttr(element.openingElement, 'data-nq-force')) return true;
  if (ALWAYS_TAGS.has(tag)) return true;
  return hasOwnText(element);
}

/**
 * ソース1ファイルを走査する。
 * 返すのは差し込み位置の一覧と、nq-id → ソース位置の対応表（9.3）。
 */
export function collectFile(code, relPath, opts = {}) {
  const ast = parseSource(code, relPath);
  const inserts = [];
  const map = {};
  let skippedComponents = 0;

  /**
   * @param node      AST ノード
   * @param component 直近の名前つき関数 = コンポーネント名（構造パスの起点）
   * @param jsxPath   ここまでの JSX 構造パス（空なら未突入）
   * @param parentEl  直近の JSXElement（兄弟の序数を数えるため）
   */
  const walk = (node, component, jsxPath, parentEl) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, component, jsxPath, parentEl);
      return;
    }

    let nextComponent = component;
    if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ClassDeclaration') &&
      node.id?.name
    ) {
      nextComponent = node.id.name;
    } else if (node.type === 'VariableDeclarator' && node.id?.name && node.init) {
      const t = node.init.type;
      if (
        t === 'ArrowFunctionExpression' ||
        t === 'FunctionExpression' ||
        t === 'CallExpression'
      ) {
        nextComponent = node.id.name;
      }
    }

    if (node.type === 'JSXElement') {
      const tag = tagNameOf(node.openingElement);
      const intrinsic = !!tag && /^[a-z]/.test(tag);
      if (tag && !intrinsic) skippedComponents++;

      let childPath = jsxPath;
      if (intrinsic) {
        // 同じ親の中で、同じタグの何番目か。
        // AST 上の定義位置であって、実行時の繰り返しではない。
        // ＝ ループ描画では同じ nq-id が N 個になる（6.5 のとおり）
        const siblings = (parentEl?.children ?? []).filter(
          (c) => c.type === 'JSXElement' && tagNameOf(c.openingElement) === tag,
        );
        const idx = Math.max(0, siblings.indexOf(node));
        const seg = `${tag}[${idx}]`;
        childPath = jsxPath ? `${jsxPath}>${seg}` : `${component || 'default'}>${seg}`;

        if (shouldInject(node, tag)) {
          const id = nqId(relPath, childPath);
          const loc = node.openingElement.name.loc?.start;
          const attrs = [` data-nq-id="${id}"`];
          if (opts.injectSource && loc) {
            attrs.push(` data-nq-src="${relPath}:${loc.line}:${loc.column}"`);
          }
          inserts.push({ index: node.openingElement.name.end, text: attrs.join('') });
          map[id] = loc ? `${relPath}:${loc.line}:${loc.column}` : relPath;
        }
      }

      for (const attr of node.openingElement.attributes ?? []) {
        walk(attr, nextComponent, childPath, node);
      }
      for (const child of node.children ?? []) {
        walk(child, nextComponent, childPath, node);
      }
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
      const v = node[key];
      if (v && typeof v === 'object') walk(v, nextComponent, jsxPath, parentEl);
    }
  };

  walk(ast.program.body, null, '', null);

  return { inserts, map, skippedComponents };
}

/** 差し込みを適用する。後ろから当てて位置がずれないようにする。 */
export function applyInserts(code, inserts) {
  const sorted = [...inserts].sort((a, b) => b.index - a.index);
  let out = code;
  for (const ins of sorted) {
    out = out.slice(0, ins.index) + ins.text + out.slice(ins.index);
  }
  return out;
}

export function injectSource(code, relPath, opts = {}) {
  const { inserts, map, skippedComponents } = collectFile(code, relPath, opts);
  return { code: applyInserts(code, inserts), map, count: inserts.length, skippedComponents };
}
