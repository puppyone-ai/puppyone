/** Bound one authenticated SSE read so the existing IPC envelope stays finite.
 * Closing a read cancels only the subscription, never the server-owned run. */
export async function readCloudAgentEventBatch(response, { maxWaitMs = 10000 } = {}) {
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
    throw new Error("Cloud Agent returned an invalid event stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(null), maxWaitMs); });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk === null) return events;
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 512 * 1024) throw new Error("Cloud Agent event exceeds the transport limit.");
      while (buffer.includes("\n\n")) {
        const end = buffer.indexOf("\n\n");
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        // An idle heartbeat is not EOF. Keep the authenticated subscription
        // open instead of creating a snapshot/reconnect loop every 200 ms.
        if (frame.startsWith(":") && events.length) return events;
        if (frame.startsWith(":")) continue;
        const event = parseEvent(frame);
        if (!event) continue;
        events.push(event);
        if (events.length === 64 || event.event === "reset" || event.event === "terminal") return events;
      }
      if (chunk.done) return events;
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseEvent(frame) {
  const fields = { data: [], event: "message", id: "" };
  for (const line of frame.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).replace(/^ /, "");
    if (name === "data") fields.data.push(value);
    else if (name === "event" || name === "id") fields[name] = value;
  }
  if (!fields.data.length) return null;
  if (!/^\d{1,15}$/.test(fields.id)) throw new Error("Cloud Agent returned an invalid event cursor.");
  return { id: Number(fields.id), event: fields.event, data: JSON.parse(fields.data.join("\n")) };
}
