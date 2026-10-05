#!/usr/bin/env node
/**
 * build.js — injects components/header.html and components/footer.html
 * into every page of the site.  No dependencies, Node 14+.
 *
 *   node build.js            inject / refresh header + footer in all pages
 *   node build.js --check    don't write anything; exit 1 if any page is stale
 *   node build.js --clean    remove injected blocks from all pages
 *
 * How it works
 *  - Edit the header/footer ONLY in components/*.html, then re-run the script.
 *  - Injected code sits between  <!-- build:xxx -->  …  <!-- /build:xxx -->
 *    markers, so running the script again replaces the old copy (idempotent).
 *  - Component CSS is scoped under [data-site="header"] / [data-site="footer"]
 *    so it can't clobber a page's own styles (and vice-versa), and the
 *    component's  :root  variables no longer leak into / get overridden by pages.
 *  - Links written as ../page.html inside components are rewritten to be
 *    relative to each page (works at the repo root and in sub-folders).
 *
 * To skip a page, add its path to SKIP below, or put <!-- build:skip -->
 * anywhere in that page.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SKIP = new Set(['404.html']);                 // redirect stub, no UI
const IGNORE_DIRS = new Set(['components', 'node_modules', '.git', 'dist']);

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const CLEAN = args.has('--clean');

/* ------------------------------------------------------------------ */
/* component parsing                                                   */
/* ------------------------------------------------------------------ */
function readComponent(file) {
  const html = fs.readFileSync(path.join(ROOT, 'components', file), 'utf8');

  const head = html.slice(0, html.indexOf('</head>'));
  const links = (head.match(/<link\b[^>]*>/gi) || []);

  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');

  const bodyStart = html.search(/<body[^>]*>/i);
  const bodyOpenEnd = html.indexOf('>', bodyStart) + 1;
  let body = html.slice(bodyOpenEnd, html.lastIndexOf('</body>'));

  const scripts = [];
  body = body.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (_, code) => {
    scripts.push(code);
    return '';
  });
  // demo-only note that exists in the standalone footer preview
  body = body.replace(/<div class="demo-note">[\s\S]*?<\/div>\s*/i, '');

  return { links, css, markup: body.trim(), scripts };
}

/* ------------------------------------------------------------------ */
/* CSS scoping                                                         */
/* ------------------------------------------------------------------ */
function splitTop(str, sep) {          // split on sep outside (), [], quotes
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of str) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function scopeSelector(sel, scope) {
  sel = sel.trim();
  if (!sel) return '';
  if (/^:root\b/.test(sel)) return sel.replace(/^:root/, scope);
  if (/^(html|body)\b/.test(sel)) return null;       // page-level, owned by the page
  return `${scope} ${sel}`;
}

function scopeCss(css, scope) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');         // drop comments
  let i = 0, out = '';
  const n = css.length;
  while (i < n) {
    const open = css.indexOf('{', i);
    if (open === -1) { out += css.slice(i); break; }
    const prelude = css.slice(i, open).trim();
    // find matching close brace
    let depth = 1, j = open + 1;
    while (j < n && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const block = css.slice(open + 1, j - 1);
    i = j;

    if (prelude.startsWith('@')) {
      if (/^@(media|supports|container|layer)\b/i.test(prelude)) out += `${prelude}{${scopeCss(block, scope)}}\n`;
      else out += `${prelude}{${block}}\n`;            // @keyframes, @font-face …
    } else {
      const sels = splitTop(prelude, ',').map(s => scopeSelector(s, scope)).filter(Boolean);
      if (sels.length) out += `${sels.join(',')}{${block}}\n`;
    }
  }
  return out;
}

function componentCss(css, name) {
  const scope = `[data-site="${name}"]`;
  const base =
    `${scope}{display:contents;color:var(--ink);font-family:var(--font-body);-webkit-font-smoothing:antialiased}\n` +
    `${scope} *,${scope} *::before,${scope} *::after{box-sizing:border-box}\n`;
  // The header holds off-screen panels (search results, translateX(100%)). The standalone
  // component hid that overflow with html/body{overflow-x:hidden}; those page-level rules are
  // dropped on purpose, so contain it locally ('clip' doesn't break position:sticky).
  const extra = name === 'header' ? `${scope} header{overflow-x:clip}\n` : '';
  return base + scopeCss(css, scope) + extra;
}

/* ------------------------------------------------------------------ */
/* path rewriting  (components live in /components, links use ../)     */
/* ------------------------------------------------------------------ */
function fixPaths(str, prefix) {
  return str
    .replace(/\.\.\/(?=[\w-]+\.html)/g, prefix)        // ../page.html → <prefix>page.html
    .replace(/(["'])\.\.\/\1/g, `$1${prefix || './'}$1`); // "../"       → "./"
}

/* ------------------------------------------------------------------ */
/* page processing                                                     */
/* ------------------------------------------------------------------ */
const BLOCK_RE = /[ \t]*<!-- build:([\w-]+) -->[\s\S]*?<!-- \/build:\1 -->\n?/g;
const wrapBlock = (name, body) => `<!-- build:${name} -->\n${body}\n<!-- /build:${name} -->\n`;

function listPages(dir = ROOT, rel = '') {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) out = out.concat(listPages(path.join(dir, e.name), rel + e.name + '/'));
    } else if (e.name.endsWith('.html')) out.push(rel + e.name);
  }
  return out;
}

function injectInto(html, rel, comps) {
  const depth = rel.split('/').length - 1;
  const prefix = '../'.repeat(depth);

  html = html.replace(BLOCK_RE, '');                   // strip previous injection
  if (CLEAN) return html;

  const H = comps.header, F = comps.footer;

  // 1. <head>: fonts (if missing) + scoped CSS
  const links = [...new Set([...H.links, ...F.links])]
    .filter(l => { const href = (l.match(/href="([^"]+)"/) || [])[1]; return href && !html.includes(href); });
  const headBlock = wrapBlock('head', [
    ...links,
    `<style data-site-css="header">\n${componentCss(H.css, 'header')}</style>`,
    `<style data-site-css="footer">\n${componentCss(F.css, 'footer')}</style>`,
  ].join('\n'));
  const headClose = html.search(/<\/head>/i);
  if (headClose === -1) throw new Error('no </head>');
  html = html.slice(0, headClose) + headBlock + html.slice(headClose);

  // 2. right after <body …>: header markup
  const bm = html.match(/<body[^>]*>/i);
  if (!bm) throw new Error('no <body>');
  const bodyEnd = bm.index + bm[0].length;
  const headerBlock = wrapBlock('header', `<div data-site="header">\n${fixPaths(H.markup, prefix)}\n</div>`);
  html = html.slice(0, bodyEnd) + headerBlock + html.slice(bodyEnd);

  // 3. before </body>: footer markup, then component scripts
  const bodyClose = html.lastIndexOf('</body>');
  if (bodyClose === -1) throw new Error('no </body>');
  const tail =
    wrapBlock('footer', `<div data-site="footer">\n${fixPaths(F.markup, prefix)}\n</div>`) +
    wrapBlock('scripts', [...H.scripts, ...F.scripts].map(s => `<script>${fixPaths(s, prefix)}</script>`).join('\n'));
  html = html.slice(0, bodyClose) + tail + html.slice(bodyClose);
  return html;
}

function main() {
  const comps = CLEAN ? null : { header: readComponent('header.html'), footer: readComponent('footer.html') };
  let changed = 0, skipped = 0, stale = 0;

  for (const rel of listPages().sort()) {
    const file = path.join(ROOT, rel);
    const src = fs.readFileSync(file, 'utf8');
    if (SKIP.has(rel) || src.includes('<!-- build:skip -->')) { skipped++; console.log(`  skip     ${rel}`); continue; }

    let out;
    try { out = injectInto(src, rel, comps); }
    catch (e) { console.error(`  ERROR    ${rel}: ${e.message}`); process.exitCode = 1; continue; }

    if (out === src) { console.log(`  ok       ${rel}`); continue; }
    stale++;
    if (CHECK) { console.log(`  STALE    ${rel}`); continue; }
    fs.writeFileSync(file, out);
    changed++;
    console.log(`  updated  ${rel}`);
  }

  console.log(`\n${CHECK ? `${stale} stale` : `${changed} updated`}, ${skipped} skipped.`);
  if (CHECK && stale) process.exitCode = 1;
}

main();
