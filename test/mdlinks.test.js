import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMarkdown, slugify } from '../src/markdown.js';
import { checkFiles, checkExternal, externalLinks, findMarkdownFiles } from '../src/check.js';
import { run, parseArgs } from '../src/cli.js';

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'mdlinks-'));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test('slugify follows the GitHub rules', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify("What's new?"), 'whats-new');
  assert.equal(slugify('C++ & Rust'), 'c--rust');
  assert.equal(slugify('Using `npm test`'), 'using-npm-test');
  assert.equal(slugify('A [link](http://x.y) here'), 'a-link-here');
  assert.equal(slugify('**Bold** heading'), 'bold-heading');
  assert.equal(slugify('Configuração rápida'), 'configuração-rápida');
  assert.equal(slugify('snake_case_name'), 'snake_case_name');
});

test('parseMarkdown: inline links, images, reference links, autolinks', () => {
  const { links } = parseMarkdown([
    'See [the docs](docs/a.md) and ![logo](img/logo.png "Logo").',
    '[ref]: ./other.md "Title"',
    'Visit <https://example.com/x> too.',
    'A link with parens [w](https://en.wikipedia.org/wiki/Foo_(bar)).',
    'With spaces [s](<my file.md>).',
  ].join('\n'));
  assert.deepEqual(links.map((l) => [l.url, l.kind, l.line]), [
    ['docs/a.md', 'link', 1],
    ['img/logo.png', 'image', 1],
    ['./other.md', 'reference', 2],
    ['https://example.com/x', 'autolink', 3],
    ['https://en.wikipedia.org/wiki/Foo_(bar)', 'link', 4],
    ['my file.md', 'link', 5],
  ]);
});

test('parseMarkdown: ignores links inside code fences and inline code', () => {
  const { links } = parseMarkdown([
    '```md',
    '[nope](missing.md)',
    '```',
    'Use `[nope](also-missing.md)` literally, but [yes](real.md).',
    '~~~',
    '[still nope](x.md)',
    '~~~',
  ].join('\n'));
  assert.deepEqual(links.map((l) => l.url), ['real.md']);
});

test('parseMarkdown: a longer fence is not closed by a shorter one', () => {
  const { links } = parseMarkdown('````\n```\n[a](a.md)\n```\n````\n[b](b.md)');
  assert.deepEqual(links.map((l) => l.url), ['b.md']);
});

test('parseMarkdown: anchors from headings, duplicates and html ids', () => {
  const { anchors } = parseMarkdown([
    '# Title',
    '## Usage',
    '## Usage',
    '### Closing hashes ###',
    '<a id="custom"></a>',
    '<a name="legacy"></a>',
    '```',
    '# not a heading',
    '```',
  ].join('\n'));
  assert.deepEqual([...anchors].sort(), ['closing-hashes', 'custom', 'legacy', 'title', 'usage', 'usage-1']);
});

test('checkFiles: finds missing files and missing anchors, with line numbers', () => {
  const dir = project({
    'README.md': [
      '# Intro',
      '[ok](docs/guide.md)',
      '[gone](docs/nope.md)',
      '[good anchor](docs/guide.md#setup)',
      '[bad anchor](docs/guide.md#nonexistent)',
      '[self ok](#intro)',
      '[self bad](#outro)',
    ].join('\n'),
    'docs/guide.md': '# Guide\n## Setup\n[back](../README.md#intro)\n',
  });
  try {
    const problems = checkFiles(findMarkdownFiles(['.'], dir), { cwd: dir });
    assert.deepEqual(problems.map((p) => [p.file, p.line, p.url]), [
      ['README.md', 3, 'docs/nope.md'],
      ['README.md', 5, 'docs/guide.md#nonexistent'],
      ['README.md', 7, '#outro'],
    ]);
    assert.equal(problems[0].reason, 'file not found');
  } finally {
    cleanup(dir);
  }
});

test('checkFiles: query strings, encoded paths, directories, root-relative, schemes', () => {
  const dir = project({
    'a.md': [
      '[q](img/pic.png?raw=true)',
      '[enc](my%20file.md)',
      '[dir](docs)',
      '[root](/docs/b.md)',
      '[mail](mailto:me@example.com)',
      '[http](https://example.com/never-checked-offline)',
      '[top](#top)',
    ].join('\n'),
    'img/pic.png': 'x',
    'my file.md': '# x',
    'docs/b.md': '# b',
  });
  try {
    assert.deepEqual(checkFiles(findMarkdownFiles(['.'], dir), { cwd: dir }), []);
  } finally {
    cleanup(dir);
  }
});

test('findMarkdownFiles: skips node_modules and non-markdown, rejects bad paths', () => {
  const dir = project({ 'a.md': '', 'sub/b.markdown': '', 'node_modules/x/c.md': '', 'notes.txt': '' });
  try {
    const found = findMarkdownFiles(['.'], dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, '/'));
    assert.deepEqual(found, ['a.md', 'sub/b.markdown']);
    assert.throws(() => findMarkdownFiles(['nope'], dir), /no such file/);
  } finally {
    cleanup(dir);
  }
});

test('checkExternal: HEAD, GET fallback, failures and de-duplication', async () => {
  const calls = [];
  const fakeFetch = async (url, { method }) => {
    calls.push(`${method} ${url}`);
    if (url.endsWith('/ok')) return { ok: true, status: 200 };
    if (url.endsWith('/nohead')) return method === 'HEAD' ? { ok: false, status: 405 } : { ok: true, status: 200 };
    if (url.endsWith('/gone')) return { ok: false, status: 404 };
    throw Object.assign(new Error('boom'), { cause: { code: 'ENOTFOUND' } });
  };
  const links = [
    { file: 'a.md', line: 1, url: 'https://x.test/ok' },
    { file: 'a.md', line: 2, url: 'https://x.test/nohead' },
    { file: 'a.md', line: 3, url: 'https://x.test/gone' },
    { file: 'b.md', line: 9, url: 'https://x.test/gone' },
    { file: 'a.md', line: 4, url: 'https://x.test/dns' },
  ];
  const bad = await checkExternal(links, { fetchImpl: fakeFetch });
  assert.deepEqual(bad.map((b) => [b.file, b.line, b.reason]), [
    ['a.md', 3, 'HTTP 404'],
    ['b.md', 9, 'HTTP 404'],
    ['a.md', 4, 'request failed (ENOTFOUND)'],
  ]);
  assert.equal(calls.filter((c) => c.endsWith('/gone')).length, 1);
});

test('externalLinks: only http(s) links, with positions', () => {
  const dir = project({ 'a.md': '[a](https://a.test)\n[b](local.md)\n<http://c.test>' });
  try {
    assert.deepEqual(externalLinks(findMarkdownFiles(['.'], dir), { cwd: dir }).map((l) => [l.url, l.line]), [
      ['https://a.test', 1],
      ['http://c.test', 3],
    ]);
  } finally {
    cleanup(dir);
  }
});

test('parseArgs: options, defaults and errors', () => {
  assert.deepEqual(parseArgs([]).paths, ['.']);
  const o = parseArgs(['docs', 'README.md', '--http', '--timeout', '500', '--ignore', 'localhost', '--json']);
  assert.deepEqual(o.paths, ['docs', 'README.md']);
  assert.equal(o.http && o.json, true);
  assert.equal(o.timeout, 500);
  assert.equal(o.ignore.length, 1);
  assert.throws(() => parseArgs(['--timeout', 'abc']), /positive integer/);
  assert.throws(() => parseArgs(['--ignore', '(']), /not a valid regular expression/);
  assert.throws(() => parseArgs(['--wat']), /unknown option/);
});

test('run: exit codes and output', async () => {
  const good = project({ 'a.md': '# A\n[self](#a)' });
  const bad = project({ 'a.md': '[x](missing.md)' });
  try {
    const ok = await run([], { cwd: good });
    assert.equal(ok.code, 0);
    assert.match(ok.out, /checked 1 file, no broken links/);

    const fail = await run([], { cwd: bad });
    assert.equal(fail.code, 1);
    assert.match(fail.out, /a\.md:1 {2}missing\.md\n {4}file not found/);
    assert.match(fail.out, /1 broken link in 1 file/);

    assert.equal((await run(['--bogus'])).code, 2);
    assert.equal((await run(['nope-dir'], { cwd: good })).code, 2);
    assert.equal((await run(['-v'], { version: '9.9.9' })).out, '9.9.9\n');
  } finally {
    cleanup(good);
    cleanup(bad);
  }
});

test('run: --ignore hides matching links, --json is parseable, --http uses fetchImpl', async () => {
  const dir = project({ 'a.md': '[x](missing.md)\n[y](https://dead.test/page)' });
  try {
    const ignored = await run(['--ignore', '^missing'], { cwd: dir });
    assert.equal(ignored.code, 0);

    const fakeFetch = async () => ({ ok: false, status: 500 });
    const r = await run(['--http', '--ignore', '^missing', '--json'], { cwd: dir, fetchImpl: fakeFetch });
    const parsed = JSON.parse(r.out);
    assert.equal(r.code, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.problems[0].reason, 'HTTP 500');
  } finally {
    cleanup(dir);
  }
});
