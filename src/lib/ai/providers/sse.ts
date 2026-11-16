// Reads a server-sent events stream (text/event-stream), as model APIs stream
// their answers: yields each event's data, its "data:" lines joined. Comments,
// event names and ids aren't needed by any provider here, so they're skipped.

function dataOf(line: string) {
  return line.slice(line[5] === " " ? 6 : 5);
}

export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let finished = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.search(/\r\n|\n|\r/)) >= 0) {
        // A "\r" at the very end may be the first half of a "\r\n" still on its way.
        if (!done && buffer[newline] === "\r" && newline === buffer.length - 1) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));

        if (line === "") {
          if (data.length) yield data.join("\n");
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(dataOf(line));
        }
      }

      if (done) {
        finished = true;
        if (buffer.startsWith("data:")) data.push(dataOf(buffer));
        if (data.length) yield data.join("\n");
        return;
      }
    }
  } finally {
    // Stopped early (an error, or the reader went away): close the connection.
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
