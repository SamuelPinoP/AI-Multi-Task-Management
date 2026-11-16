import assert from "node:assert/strict";
import test from "node:test";
import { readSseData } from "./sse";

function streamOf(text: string, pieceLength = text.length) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += pieceLength) controller.enqueue(bytes.slice(at, at + pieceLength));
      controller.close();
    },
  });
}

async function read(text: string, pieceLength?: number) {
  const events: string[] = [];
  for await (const data of readSseData(streamOf(text, pieceLength))) events.push(data);
  return events;
}

test("yields each event's data, whatever the line endings", async () => {
  assert.deepEqual(await read('data: {"a":1}\n\ndata: {"b":2}\n\n'), ['{"a":1}', '{"b":2}']);
  assert.deepEqual(await read('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n'), ['{"a":1}', '{"b":2}']);
  assert.deepEqual(await read("data: one\r\rdata: two\r\r"), ["one", "two"]);
});

test("joins multi-line data and skips comments, names and ids", async () => {
  assert.deepEqual(await read(": keep-alive\nevent: message\nid: 7\ndata: first\ndata:second\n\n"), ["first\nsecond"]);
});

test("keeps a last event that has no blank line after it", async () => {
  assert.deepEqual(await read("data: one\n\ndata: two"), ["one", "two"]);
});

test("reads the same events however the bytes are split, even inside a CRLF or a character", async () => {
  const text = 'data: {"text":"héllo wörld"}\r\n\r\ndata: {"done":true}\r\n\r\n';
  for (let pieceLength = 1; pieceLength <= 8; pieceLength += 1) {
    assert.deepEqual(await read(text, pieceLength), ['{"text":"héllo wörld"}', '{"done":true}'], `pieces of ${pieceLength} bytes`);
  }
});
