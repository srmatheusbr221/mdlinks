// Just enough Markdown parsing to find links and headings.
// It is not a full CommonMark parser: it understands fenced code blocks,
// inline code, inline links/images, reference definitions and autolinks.

/** GitHub style heading id: "Hello, World!" -> "hello-world" */
export function slugify(heading) {
  return stripInline(heading)
    .trim()
    .toLowerCase()
    // keep letters, numbers, spaces, hyphens, underscores (unicode aware)
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-');
}

function stripInline(s) {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images -> their text
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*|__|\*|~~/g, ''); // single underscores stay: snake_case is common in headings
}

/**
 * Walks the text line by line and hands back only the lines that are not
 * inside a fenced code block.
 * @returns {{ text: string, line: number }[]}
 */
function proseLines(markdown) {
  const out = [];
  let fence = null; // the opening marker, e.g. "```" or "~~~~"
  markdown.split(/\r?\n/).forEach((text, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (m) {
      if (!fence) fence = m[1];
      else if (m[1][0] === fence[0] && m[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(text)) fence = null;
      return;
    }
    if (!fence) out.push({ text, line: i + 1 });
  });
  return out;
}

function blankInlineCode(text) {
  // replace the contents of `code spans` with spaces so links in them are ignored
  return text.replace(/(`+)(.+?)\1/g, (m) => ' '.repeat(m.length));
}

/**
 * @param {string} markdown
 * @returns {{ links: { url: string, line: number, kind: 'link'|'image'|'reference'|'autolink' }[], anchors: Set<string> }}
 */
export function parseMarkdown(markdown) {
  const links = [];
  const anchors = new Set();
  const seen = new Map(); // slug -> how many times, for -1, -2 suffixes

  const addAnchor = (slug) => {
    if (!slug) return;
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    anchors.add(n === 0 ? slug : `${slug}-${n}`);
  };

  const lines = proseLines(markdown);
  for (let i = 0; i < lines.length; i++) {
    const { text, line } = lines[i];
    // headings: # Title, ## Title ##
    const h = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(text);
    if (h) addAnchor(slugify(h[1]));

    // setext headings: a non-blank line underlined with === (h1) or --- (h2).
    // A blank line before the underline makes --- a thematic break instead.
    const next = lines[i + 1]?.text;
    if (text.trim() && next && !/^ {0,3}#{1,6}\s/.test(text)) {
      const setext = /^ {0,3}(=+|-+)\s*$/.exec(next);
      if (setext) addAnchor(slugify(text));
    }

    const clean = blankInlineCode(text);

    // explicit anchors: <a id="x"> / <a name="x"> / any tag with id=
    for (const a of clean.matchAll(/<[a-zA-Z][^>]*\b(?:id|name)=["']([^"']+)["'][^>]*>/g)) anchors.add(a[1]);

    // inline links and images: [text](url "title") / ![alt](<url with spaces>)
    for (const m of clean.matchAll(/(!?)\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
      const url = m[2].replace(/^<|>$/g, '');
      if (url) links.push({ url, line, kind: m[1] ? 'image' : 'link' });
    }

    // reference definitions: [id]: url "title"
    // (footnote definitions look similar, "[^1]: text", but are not links)
    const ref = /^ {0,3}\[(?!\^)[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(clean);
    if (ref) links.push({ url: ref[1].replace(/^<|>$/g, ''), line, kind: 'reference' });

    // autolinks: <https://example.com>
    for (const m of clean.matchAll(/<((?:https?|ftp):\/\/[^>\s]+)>/g)) {
      links.push({ url: m[1], line, kind: 'autolink' });
    }
  }

  return { links, anchors };
}
