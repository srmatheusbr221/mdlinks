import { checkExternal, checkFiles, externalLinks, findMarkdownFiles } from './check.js';

const HELP = `mdlinks - find broken links in Markdown files

Usage: mdlinks [options] [path...]

Checks relative file links and #heading anchors. Paths can be files or
directories (default: the current directory).

Options:
  --http             also check http(s) links over the network
  --timeout <ms>     per-request timeout for --http    (default: 10000)
  --ignore <regex>   skip links whose URL matches (repeatable)
  --json             machine readable output
  -h, --help         show this help
  -v, --version      show the version

Exit codes: 0 = all fine, 1 = broken links, 2 = bad usage
`;

class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { paths: [], http: false, timeout: 10000, ignore: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case '--http': opts.http = true; break;
      case '--json': opts.json = true; break;
      case '--timeout': {
        const n = Number(value());
        if (!Number.isInteger(n) || n <= 0) throw new UsageError('--timeout must be a positive integer');
        opts.timeout = n;
        break;
      }
      case '--ignore': {
        const src = value();
        try {
          opts.ignore.push(new RegExp(src));
        } catch {
          throw new UsageError(`--ignore: "${src}" is not a valid regular expression`);
        }
        break;
      }
      case '-h': case '--help': opts.help = true; break;
      case '-v': case '--version': opts.version = true; break;
      default:
        if (a.startsWith('-')) throw new UsageError(`unknown option: ${a}`);
        opts.paths.push(a);
    }
  }
  if (!opts.paths.length) opts.paths.push('.');
  return opts;
}

/** @returns {Promise<{ code: number, out: string, err: string }>} */
export async function run(argv, { cwd = process.cwd(), version = '0.0.0', fetchImpl } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) return { code: 2, out: '', err: `mdlinks: ${e.message}\n\n${HELP}` };
    throw e;
  }
  if (opts.help) return { code: 0, out: HELP, err: '' };
  if (opts.version) return { code: 0, out: version + '\n', err: '' };

  let files;
  try {
    files = findMarkdownFiles(opts.paths, cwd);
  } catch (e) {
    return { code: 2, out: '', err: `mdlinks: ${e.message}\n` };
  }

  const ignored = (url) => opts.ignore.some((re) => re.test(url));
  let problems = checkFiles(files, { cwd }).filter((p) => !ignored(p.url));

  if (opts.http) {
    const links = externalLinks(files, { cwd }).filter((l) => !ignored(l.url));
    problems = problems.concat(await checkExternal(links, { timeout: opts.timeout, fetchImpl }));
  }
  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const code = problems.length ? 1 : 0;
  if (opts.json) {
    return { code, out: JSON.stringify({ ok: code === 0, files: files.length, problems }, null, 2) + '\n', err: '' };
  }
  if (!problems.length) {
    return { code, out: `checked ${files.length} file${files.length === 1 ? '' : 's'}, no broken links\n`, err: '' };
  }
  const lines = problems.map((p) => `${p.file}:${p.line}  ${p.url}\n    ${p.reason}`);
  lines.push('', `${problems.length} broken link${problems.length === 1 ? '' : 's'} in ${files.length} file${files.length === 1 ? '' : 's'}`);
  return { code, out: lines.join('\n') + '\n', err: '' };
}
