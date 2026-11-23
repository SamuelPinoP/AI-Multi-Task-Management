import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownText } from "./markdown-text";

// The Markdown renderer for task descriptions (#433), rendered to HTML as the server sends it.

const html = (text: string, onCheck?: (line: number, checked: boolean) => void) => renderToStaticMarkup(<MarkdownText text={text} onCheck={onCheck} />);

test("raw HTML shows as the text it is, and a link that could run code stays text", () => {
  const out = html('<img src="x" onerror="alert(1)"> <b>bold</b>\n\n[Run it](javascript:alert(1)) and [the docs](https://example.com/docs)');
  assert.doesNotMatch(out, /<img|<b>/);
  assert.match(out, /&lt;img src=&quot;x&quot; onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(out, /javascript:/);
  assert.match(out, /<span>Run it<\/span>/);
  assert.match(out, /<a href="https:\/\/example\.com\/docs" target="_blank" rel="noopener noreferrer nofollow">the docs<\/a>/);
});

test("a checklist: each box in a label with its text, ticked as written, tickable only with onCheck", () => {
  const text = "- [x] Book the van\n- [ ] Pack the kitchen";
  const readOnly = html(text);
  assert.equal(readOnly.match(/<input type="checkbox"[^>]*>/g)?.length, 2);
  assert.equal(readOnly.match(/<input type="checkbox"[^>]*disabled=""/g)?.length, 2);
  // A ticked item is struck through.
  assert.match(readOnly, /<label class="[^"]*line-through[^"]*"><input type="checkbox"[^>]*\bchecked=""[^>]*\/><span[^>]*>\s*Book the van<\/span><\/label>/);
  assert.match(readOnly, /<label class="(?![^"]*line-through)[^"]*"><input type="checkbox"(?![^>]*\bchecked="")[^>]*\/><span[^>]*>\s*Pack the kitchen<\/span><\/label>/);

  const editable = html(text, () => {});
  assert.doesNotMatch(editable, /disabled=""/);
});

test("a wide table or block of code can be reached with the keyboard, to scroll it", () => {
  const out = html("| Item | Cost |\n| --- | --- |\n| Van | $120 |\n\n```\nnpm run build\n```");
  assert.match(out, /<table tabindex="0">/);
  assert.match(out, /<pre tabindex="0"><code>npm run build\n<\/code><\/pre>/);
});

test("headings, lists, bold and quotes are formatted; line breaks in a paragraph stay", () => {
  const out = html("### Notes\n\nFirst line\nsecond line, **bold**\n\n1. One\n2. Two\n\n> Their words");
  assert.match(out, /<h3>Notes<\/h3>/);
  assert.match(out, /<p>First line\nsecond line, <strong>bold<\/strong><\/p>/);
  assert.match(out, /<ol>\n<li>One<\/li>\n<li>Two<\/li>\n<\/ol>/);
  assert.match(out, /<blockquote>\n<p>Their words<\/p>\n<\/blockquote>/);
});
