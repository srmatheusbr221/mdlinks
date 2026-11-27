# Contributing to mdlinks

Thanks for helping. A few notes to save you time.

## Setup

```sh
git clone https://github.com/srmatheusbr221/mdlinks
cd mdlinks
npm test
```

Node 20+, zero dependencies.

## Layout

- `src/markdown.js`: the mini parser (links, headings, code fences) and `slugify`
- `src/check.js`: finding files, checking local links, checking http links
- `src/cli.js`: argument parsing, output, exit codes. `run()` returns `{ code, out, err }` so tests don't need subprocesses
- `bin/mdlinks.js`: executable wrapper

## The most useful contribution: a failing Markdown snippet

Most bugs here are "this valid Markdown produced a wrong result". If you can, add a test to `test/mdlinks.test.js` with the snippet and the result you expected. Even just the snippet in an issue is great.

## Making a change

1. For anything beyond a bug fix, open an issue first.
2. Add a test that fails before your change.
3. Keep the zero-dependency rule. If you think a parser library is worth it, open an issue and argue the case, I'm open to it.
4. Update README and `CHANGELOG.md` when behaviour changes.
5. Open a PR with the template filled in.

## Network code

Tests must never hit the real network. `checkExternal` takes a `fetchImpl` for exactly that, see the existing tests.
