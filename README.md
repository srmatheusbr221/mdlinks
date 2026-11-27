# mdlinks

Find broken links in your Markdown files before your readers do.

It checks the boring-but-common failures: a file got renamed and three READMEs still point at the old name, or a heading changed and every `#anchor` to it quietly stopped working. Optionally it also pings `http(s)` links.

```
$ mdlinks docs README.md
README.md:18  docs/install.md
    file not found
docs/guide.md:42  ../README.md#getting-started
    no heading or anchor "#getting-started" in README.md

2 broken links in 7 files
```

Exit code is `1` when something is broken, so it fits in CI or a pre-commit hook.

## Install / run

Not on npm yet, so run it from GitHub:

```sh
npx github:srmatheusbr221/mdlinks            # checks the current directory
npx github:srmatheusbr221/mdlinks docs README.md
npm install --save-dev github:srmatheusbr221/mdlinks
```

Node 20+. No dependencies.

## Options

```
--http             also check http(s) links over the network
--timeout <ms>     per-request timeout for --http    (default: 10000)
--ignore <regex>   skip links whose URL matches (repeatable)
--json             machine readable output
```

Paths can be files or folders. With no path it scans the current folder (skipping `node_modules`, `.git`, `dist`, `build`, `coverage`).

```sh
# everything, including the internet, but ignore localhost examples
mdlinks --http --ignore '^https?://localhost' --ignore 'example\.com'
```

GitHub Actions:

```yaml
- run: npx github:srmatheusbr221/mdlinks
```

## What gets checked

| Link | Checked how |
| --- | --- |
| `[x](other.md)`, `![img](pic.png)` | the file must exist (relative to the file, or to the repo root for `/path`) |
| `[x](other.md#some-heading)` | file exists **and** has a heading that slugifies to `some-heading` |
| `[x](#some-heading)` | heading exists in the same file |
| `[x]: path.md` (reference definitions) | like inline links |
| `<a id="x">`, `<a name="x">` | count as anchors |
| `https://...` | only with `--http` (HEAD, then GET if the server dislikes HEAD) |
| `mailto:`, `tel:`, `data:` | skipped |

Heading slugs follow GitHub's rules (lowercase, punctuation dropped, spaces to hyphens, repeated headings get `-1`, `-2`). Links inside code blocks and inline code are ignored, since those are usually examples.

## Limits

- It's a small hand-written parser, not a CommonMark implementation. Weird nesting and HTML-heavy READMEs can confuse it. If you find a case, please open an issue with the Markdown snippet.
- A link can pass because the heading exists but still be wrong on another renderer, since slug rules differ between GitHub, GitLab and others. GitHub's rules are what's implemented.
- `--http` doesn't follow rate limits or retry. Flaky sites can show up as failures.

## Development

```sh
git clone https://github.com/srmatheusbr221/mdlinks
cd mdlinks
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Check out the issues labelled `good first issue`.

This repo runs mdlinks on its own README in CI, so if you break a link here the build tells you.

## License

MIT
