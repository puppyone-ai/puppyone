type Control = { method: "input" | "resize" | "appearance"; request: unknown; bytes: number };

/** One in-flight command. Input is ordered, never retried after uncertain delivery. */
export class TerminalControlQueue {
  private queue: Control[] = [];
  private bytes = 0;
  private running = false;
  private closed = false;
  constructor(private send: (method: string, request: unknown) => Promise<unknown>, private fail: (error: Error) => void) {}

  enqueue(method: Control["method"], request: unknown) {
    if (this.closed) return;
    const bytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
    const last = this.queue.at(-1);
    if (method !== "input" && last?.method === method && (!this.running || this.queue.length > 1)) {
      this.bytes -= last.bytes;
      this.queue.pop();
    }
    if (this.queue.length >= 128 || this.bytes + bytes > 256 * 1024) {
      this.close();
      this.fail(new Error("Terminal input exceeded its queue budget. Pending input was not retried."));
      return;
    }
    this.queue.push({ method, request, bytes });
    this.bytes += bytes;
    void this.drain();
  }

  close() { this.closed = true; this.queue = []; this.bytes = 0; }

  private async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (!this.closed && this.queue.length) {
        const entry = this.queue[0]!;
        await this.send(entry.method, entry.request);
        if (this.closed) break;
        this.queue.shift();
        this.bytes -= entry.bytes;
      }
    } catch (error) {
      if (!this.closed) {
        this.close();
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    } finally { this.running = false; }
  }
}
