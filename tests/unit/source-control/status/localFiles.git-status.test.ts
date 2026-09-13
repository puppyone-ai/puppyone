import { afterEach, describe, expect, it, vi } from "vitest";
import { getWorkspaceGitStatus } from "../../../../src/lib/localFiles";
import type { DesktopBridge } from "../../../support/electron/desktopBridge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local Git status cancellation bridge", () => {
  it("uses one request id for status and cancellation", async () => {
    let rejectStatus: ((reason: Error) => void) | null = null;
    const getGitStatus = vi.fn<DesktopBridge["getGitStatus"]>(() => new Promise<never>((_resolve, reject) => {
      rejectStatus = reject;
    }));
    const cancelGitStatus = vi.fn<NonNullable<DesktopBridge["cancelGitStatus"]>>(async () => {
      rejectStatus?.(new Error("main process cancelled"));
      return { ok: true };
    });
    vi.stubGlobal("window", {
      puppyoneDesktop: { getGitStatus, cancelGitStatus },
    });

    const controller = new AbortController();
    const status = getWorkspaceGitStatus("/workspace", { signal: controller.signal });
    await vi.waitFor(() => expect(getGitStatus).toHaveBeenCalledOnce());
    controller.abort();

    await expect(status).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelGitStatus).toHaveBeenCalledOnce();
    expect(cancelGitStatus.mock.calls[0][0].requestId)
      .toBe(getGitStatus.mock.calls[0][0].requestId);
    expect(getGitStatus.mock.calls[0][0].rootPath).toBe("/workspace");
  });

  it("does not invoke IPC for an already-cancelled request", async () => {
    const getGitStatus = vi.fn<DesktopBridge["getGitStatus"]>();
    const cancelGitStatus = vi.fn<NonNullable<DesktopBridge["cancelGitStatus"]>>();
    vi.stubGlobal("window", {
      puppyoneDesktop: { getGitStatus, cancelGitStatus },
    });
    const controller = new AbortController();
    controller.abort();

    await expect(getWorkspaceGitStatus("/workspace", { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(getGitStatus).not.toHaveBeenCalled();
    expect(cancelGitStatus).not.toHaveBeenCalled();
  });
});
