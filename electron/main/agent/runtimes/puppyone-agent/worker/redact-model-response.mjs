/** Sanitize provider echoes before the SDK can persist a native history entry. */
export function redactModelResponse(response, secret) {
  if (!secret || !response.body) return response;
  const patterns = [...new Set([secret, JSON.stringify(secret).slice(1, -1)])].sort((a, b) => b.length - a.length);
  const overlap = Math.max(...patterns.map((value) => value.length)) - 1;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  const scrub = () => { for (const pattern of patterns) pending = pending.replaceAll(pattern, "[redacted]"); };
  const stream = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      scrub();
      let count = Math.max(0, pending.length - overlap);
      if (count && /[\uD800-\uDBFF]/u.test(pending[count - 1])) count--;
      if (count) { controller.enqueue(encoder.encode(pending.slice(0, count))); pending = pending.slice(count); }
    },
    flush(controller) { pending += decoder.decode(); scrub(); if (pending) controller.enqueue(encoder.encode(pending)); },
  }));
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}
