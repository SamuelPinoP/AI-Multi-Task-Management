import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentKind,
  attachmentTypeLabel,
  attachmentUrls,
  canPreviewKind,
  extensionLabel,
  formatDuration,
  mediaGridLayout,
  parseCsv,
  textFormat,
} from "./project-chat-attachment-display";

test("detects the kind from the stored type or the extension", () => {
  assert.equal(attachmentKind("image/png", "shot.png"), "image");
  assert.equal(attachmentKind("", "Photo.JPEG"), "image");
  assert.equal(attachmentKind("video/quicktime", "clip.mov"), "video");
  assert.equal(attachmentKind("application/octet-stream", "clip.webm"), "video");
  assert.equal(attachmentKind("application/pdf", "brief"), "pdf");
  assert.equal(attachmentKind("", "notes.docx"), "docx");
  assert.equal(attachmentKind("application/msword", "old.doc"), "word");
  assert.equal(attachmentKind("", "budget.xlsx"), "spreadsheet");
  assert.equal(attachmentKind("", "deck.pptx"), "presentation");
  assert.equal(attachmentKind("text/csv", "rows.csv"), "text");
  assert.equal(attachmentKind("application/json", "data.json"), "text");
  assert.equal(attachmentKind("application/zip", "bundle.zip"), "archive");
  assert.equal(attachmentKind("application/octet-stream", "mystery"), "file");
});

test("only previewable kinds open inline", () => {
  for (const kind of ["image", "video", "pdf", "docx", "text"] as const) {
    assert.equal(canPreviewKind(kind), true, kind);
  }
  for (const kind of ["word", "spreadsheet", "presentation", "archive", "file"] as const) {
    assert.equal(canPreviewKind(kind), false, kind);
  }
});

test("labels read like file types, not MIME types", () => {
  assert.equal(attachmentTypeLabel("docx", "a.docx"), "Word document");
  assert.equal(attachmentTypeLabel("video", "a.mp4"), "MP4 video");
  assert.equal(attachmentTypeLabel("image", "a.jpeg"), "JPG image");
  assert.equal(attachmentTypeLabel("text", "a.csv"), "CSV table");
  assert.equal(attachmentTypeLabel("file", "README"), "File");
  assert.equal(extensionLabel("Report.Final.PDF"), "PDF");
  assert.equal(extensionLabel(".hidden"), "FILE");
});

test("text previews pick a format", () => {
  assert.equal(textFormat("rows.csv"), "csv");
  assert.equal(textFormat("data.json"), "json");
  assert.equal(textFormat("notes.txt"), "plain");
});

test("formats video durations", () => {
  assert.equal(formatDuration(7.4), "0:07");
  assert.equal(formatDuration(62), "1:02");
  assert.equal(formatDuration(3723), "1:02:03");
  assert.equal(formatDuration(Number.NaN), "");
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), "");
});

test("gallery layout fills every row of the 6-column grid", () => {
  for (let count = 1; count <= 5; count += 1) {
    const layout = mediaGridLayout(count);
    assert.equal(layout.length, count);

    let rowWidth = 0;
    for (const tile of layout) {
      rowWidth += tile.colSpan;
      assert.ok(rowWidth <= 6, `count ${count} overflows a row`);
      if (rowWidth === 6) rowWidth = 0;
    }
    assert.equal(rowWidth, 0, `count ${count} leaves a gap`);
  }

  assert.deepEqual(mediaGridLayout(1), [{ colSpan: 6, aspect: "wide" }]);
  assert.deepEqual(
    mediaGridLayout(3).map((tile) => tile.colSpan),
    [6, 3, 3],
  );
  assert.deepEqual(
    mediaGridLayout(5).map((tile) => tile.colSpan),
    [3, 3, 2, 2, 2],
  );
  assert.deepEqual(mediaGridLayout(0), []);
});

test("builds encoded attachment URLs", () => {
  assert.deepEqual(attachmentUrls("p 1", "a/2"), {
    view: "/api/projects/p%201/attachments/a%2F2/download",
    download: "/api/projects/p%201/attachments/a%2F2/download?download=1",
    preview: "/api/projects/p%201/attachments/a%2F2/preview",
  });
});

test("parses CSV with quotes, escaped quotes and CRLF", () => {
  assert.deepEqual(parseCsv('name,note\r\n"Ada","said ""hi"", twice"\r\nBob,\n'), [
    ["name", "note"],
    ["Ada", 'said "hi", twice'],
    ["Bob", ""],
  ]);
  assert.deepEqual(parseCsv("a,b\nc,d\ne,f", 2), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(parseCsv("x"), [["x"]]);
});
