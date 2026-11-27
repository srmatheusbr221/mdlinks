# Changelog

## 0.1.1

- Fix: footnote definitions (`[^1]: text`) were reported as broken links

## 0.1.0

First public version.

- Checks relative file links, images, reference definitions and `#anchors`
- GitHub style heading slugs, duplicate headings, `<a id>` / `<a name>` anchors
- Ignores code fences and inline code
- `--http` to check web links (HEAD with GET fallback, de-duplicated, concurrent)
- `--ignore`, `--timeout`, `--json`
