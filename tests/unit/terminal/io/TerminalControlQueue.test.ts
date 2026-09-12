import { describe, expect, it, vi } from "vitest";
import { TerminalControlQueue } from "../../../../src/features/desktop-terminal/runtime/TerminalControlQueue";

describe("terminal display controls", () => {
  it("preserves input order and coalesces only consecutive queued resize operations", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn().mockImplementationOnce(() => wait).mockResolvedValue(true);
    const queue = new TerminalControlQueue(send, vi.fn());
    queue.enqueue("input", "a");
    queue.enqueue("resize", 80);
    queue.enqueue("resize", 120);
    queue.enqueue("input", "b");
    queue.enqueue("resize", 90);
    release();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(4));
    expect(send.mock.calls).toEqual([["input", "a"], ["resize", 120], ["input", "b"], ["resize", 90]]);
    queue.close();
  });

  it("fails visibly on uncertain delivery without replaying input", async () => {
    const send = vi.fn().mockRejectedValue(new Error("delivery unknown"));
    const fail = vi.fn();
    const queue = new TerminalControlQueue(send, fail);
    queue.enqueue("input", "command");
    queue.enqueue("input", "next");
    await vi.waitFor(() => expect(fail).toHaveBeenCalledOnce());
    queue.enqueue("input", "later");
    expect(send).toHaveBeenCalledOnce();
  });

  it("bounds queued bytes before accepting a paste", () => {
    const send = vi.fn();
    const fail = vi.fn();
    new TerminalControlQueue(send, fail).enqueue("input", "a".repeat(300_000));
    expect(send).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
  });
});
