import assert from "node:assert/strict";
import test from "node:test";
import {
  STANDARD_FILE_SIZE_LIMIT,
  VIDEO_FILE_SIZE_LIMIT,
  attachmentContentType,
  isVideoAttachment,
  validateProjectChatAttachment,
} from "./project-chat-attachment-validation";

test("enforces ordinary and video size limits", () => {
  assert.equal(validateProjectChatAttachment({ name: "report.pdf", type: "application/pdf", size: STANDARD_FILE_SIZE_LIMIT + 1 }), "too-large");
  assert.equal(validateProjectChatAttachment({ name: "clip.mp4", type: "video/mp4", size: VIDEO_FILE_SIZE_LIMIT + 1 }), "too-large");
});

test("derives routing and content type from the validated extension, not client MIME", () => {
  assert.equal(isVideoAttachment({ name: "notes.txt", type: "video/mp4" }), false);
  assert.equal(isVideoAttachment({ name: "clip.mp4", type: "text/plain" }), true);
  assert.equal(attachmentContentType({ name: "clip.mp4" }), "video/mp4");
});

test("rejects invalid types and unsafe filenames", () => {
  assert.equal(validateProjectChatAttachment({ name: "payload.exe", type: "application/octet-stream", size: 1 }), "invalid-type");
  assert.equal(validateProjectChatAttachment({ name: "../report.pdf", type: "application/pdf", size: 1 }), "unsafe-name");
  assert.equal(validateProjectChatAttachment({ name: "report\u0000.pdf", type: "application/pdf", size: 1 }), "unsafe-name");
});
