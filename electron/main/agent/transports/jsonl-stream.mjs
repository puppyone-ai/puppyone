/** Byte framing only; native RPC schemas and command outcomes stay with each client. */
export function createJsonlFramer({ maxLineBytes, onLine, onFailure, isClosed }) {
  let buffer = "";
  return (chunk) => {
    if (isClosed()) return;
    buffer += String(chunk);
    let newline = buffer.indexOf("\n");
    while (newline >= 0 && !isClosed()) {
      const line = buffer.slice(0, newline).replace(/\r$/u, "");
      buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > maxLineBytes) {
        buffer = "";
        onFailure();
        return;
      }
      if (line.trim()) onLine(line);
      newline = buffer.indexOf("\n");
    }
    // Check the unfinished tail even when this chunk also contained valid lines.
    if (Buffer.byteLength(buffer, "utf8") > maxLineBytes) {
      buffer = "";
      onFailure();
    }
  };
}

export function writeJsonlFrame(stream, line, { maxBufferedBytes, onError }) {
  if ((stream.writableLength ?? 0) + Buffer.byteLength(line, "utf8") > maxBufferedBytes) {
    throw new Error("The native RPC write buffer is full.");
  }
  // write(false) means backpressure, not failed delivery. A finite queued-byte
  // budget bounds memory; the callback reports asynchronous pipe failures.
  stream.write(line, "utf8", (error) => { if (error) onError(error); });
}
