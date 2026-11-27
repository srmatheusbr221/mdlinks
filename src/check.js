import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { parseMarkdown } from './markdown.js';

const MD_EXT = new Set(['.md', '.markdown']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'coverage']);

/** Finds markdown files under the given files/directories. */
export function findMarkdownFiles(paths, cwd = process.cwd()) {
  const files = [];
  const visit = (p) => {
    const abs = resolve(cwd, p);
    if (!existsSync(abs)) throw new Error(`no such file or directory: ${p}`);
    const st = statSync(abs);
    if (st.isFile()) {
      files.push(abs);
      return;
    }
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) visit(join(abs, e.name));
      } else if (e.isFile() && MD_EXT.has(extname(e.name).toLowerCase())) {
        files.push(join(abs, e.name));
      }
    }
  };
  for (const p of paths) visit(p);
  return [...new Set(files)].sort();
}

const EXTERNAL = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SKIPPED_SCHEMES = /^(mailto|tel|sms|data|javascript):/i;

/**
 * Checks local links (files and #anchors). Returns a list of problems.
 * @param {string[]} files absolute paths
 * @param {{ cwd?: string }} [opts]
 * @returns {{ file: string, line: number, url: string, reason: string }[]}
 */
export function checkFiles(files, { cwd = process.cwd() } = {}) {
  const cache = new Map(); // abs path -> parsed markdown
  const parsed = (abs) => {
    if (!cache.has(abs)) cache.set(abs, parseMarkdown(readFileSync(abs, 'utf8')));
    return cache.get(abs);
  };

  const problems = [];
  const report = (file, link, reason) =>
    problems.push({ file: relative(cwd, file).split(sep).join('/'), line: link.line, url: link.url, reason });

  for (const file of files) {
    const { links, anchors } = parsed(file);

    for (const link of links) {
      const url = link.url;
      if (SKIPPED_SCHEMES.test(url)) continue;
      if (EXTERNAL.test(url) || url.startsWith('//')) continue; // see checkExternal

      const [pathPart, ...hashParts] = url.split('#');
      const hash = hashParts.join('#');

      // same-file anchor
      if (pathPart === '') {
        if (hash && hash !== 'top' && !anchors.has(decode(hash).toLowerCase()) && !anchors.has(decode(hash))) {
          report(file, link, `no heading or anchor "#${hash}" in this file`);
        }
        continue;
      }

      const clean = decode(pathPart.split('?')[0]);
      const target = clean.startsWith('/') ? resolve(cwd, '.' + clean) : resolve(dirname(file), clean);

      if (!existsSync(target)) {
        report(file, link, 'file not found');
        continue;
      }
      if (hash && statSync(target).isFile() && MD_EXT.has(extname(target).toLowerCase())) {
        const t = parsed(target).anchors;
        if (!t.has(decode(hash).toLowerCase()) && !t.has(decode(hash))) {
          report(file, link, `no heading or anchor "#${hash}" in ${relative(cwd, target).split(sep).join('/')}`);
        }
      }
    }
  }
  return problems;
}

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Collects http(s) links so they can be checked over the network. */
export function externalLinks(files, { cwd = process.cwd() } = {}) {
  const out = [];
  for (const file of files) {
    for (const link of parseMarkdown(readFileSync(file, 'utf8')).links) {
      if (/^https?:\/\//i.test(link.url)) {
        out.push({ file: relative(cwd, file).split(sep).join('/'), line: link.line, url: link.url });
      }
    }
  }
  return out;
}

/**
 * HEAD first, GET as fallback (some servers refuse HEAD). Each distinct URL is
 * requested once, at most `concurrency` at the same time.
 * @param {{ file: string, line: number, url: string }[]} links
 * @param {{ timeout?: number, concurrency?: number, fetchImpl?: typeof fetch }} [opts]
 */
export async function checkExternal(links, { timeout = 10000, concurrency = 5, fetchImpl = globalThis.fetch } = {}) {
  const unique = [...new Set(links.map((l) => l.url))];
  const verdict = new Map();

  const probe = async (url) => {
    const attempt = async (method) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      try {
        return await fetchImpl(url, { method, redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'mdlinks' } });
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      let res = await attempt('HEAD');
      if (res.status === 405 || res.status === 403 || res.status === 501) res = await attempt('GET');
      verdict.set(url, res.ok ? null : `HTTP ${res.status}`);
    } catch (e) {
      verdict.set(url, e?.name === 'AbortError' ? `timed out after ${timeout} ms` : `request failed (${e?.cause?.code ?? e?.message ?? 'unknown'})`);
    }
  };

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    while (next < unique.length) await probe(unique[next++]);
  });
  await Promise.all(workers);

  return links.filter((l) => verdict.get(l.url)).map((l) => ({ ...l, reason: verdict.get(l.url) }));
}
