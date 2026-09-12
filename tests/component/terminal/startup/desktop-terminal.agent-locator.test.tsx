/**
 * @vitest-environment happy-dom
 */
import React, { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTerminalAgentLocator } from "../../../../src/features/desktop-terminal/controller/useTerminalAgentLocator";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type LocatorView = ReturnType<typeof useTerminalAgentLocator>;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  delete (window as Window & { puppyoneDesktop?: unknown }).puppyoneDesktop;
});

describe("Terminal Agent locator controller", () => {
  it("detects local Agents without reading or changing activity Hook enrollment", async () => {
    const locate = vi.fn(async () => snapshot(["codex"]));
    const getAgentActivityEnrollment = vi.fn();
    const setAgentActivityEnrollment = vi.fn();
    installBridge(locate, {
      getAgentActivityEnrollment,
      setAgentActivityEnrollment,
    });
    let latest: LocatorView | null = null;
    mount((value) => { latest = value; });

    await vi.waitFor(() => expect(latest?.phase).toBe("ready"));
    expect(latest?.ids).toEqual(["codex"]);
    expect(getAgentActivityEnrollment).not.toHaveBeenCalled();
    expect(setAgentActivityEnrollment).not.toHaveBeenCalled();

    await act(async () => {
      await latest?.refresh();
    });
    expect(locate).toHaveBeenCalledTimes(2);
    expect(getAgentActivityEnrollment).not.toHaveBeenCalled();
    expect(setAgentActivityEnrollment).not.toHaveBeenCalled();
  });

  it("ignores an older discovery response after a forced refresh", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const locate = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    installBridge(locate);
    let latest: LocatorView | null = null;
    mount((value) => { latest = value; });

    await vi.waitFor(() => expect(locate).toHaveBeenCalledTimes(1));
    await act(async () => {
      void latest?.refresh();
    });
    expect(locate).toHaveBeenNthCalledWith(2, {
      refresh: true,
      requestId: expect.stringMatching(/^terminal-agent-location:/u),
    });

    await act(async () => {
      second.resolve(snapshot(["codex"]));
      await second.promise;
    });
    expect(latest?.ids).toEqual(["codex"]);

    await act(async () => {
      first.resolve(snapshot(["opencode"]));
      await first.promise;
    });
    expect(latest?.ids).toEqual(["codex"]);
  });

  it("retains the last successful list when refresh fails", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const locate = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    installBridge(locate);
    let latest: LocatorView | null = null;
    mount((value) => { latest = value; });

    await vi.waitFor(() => expect(locate).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.resolve(snapshot(["claude"]));
      await first.promise;
    });
    expect(latest?.ids).toEqual(["claude"]);
    await act(async () => {
      const refresh = latest?.refresh();
      second.reject(new Error("IPC unavailable"));
      await refresh;
    });
    expect(latest?.phase).toBe("error");
    expect(latest?.ids).toEqual(["claude"]);
  });

  it("shows installed Agents incrementally and ignores another request's events", async () => {
    const final = deferred<unknown>();
    const locate = vi.fn(() => final.promise);
    const bridge = installBridge(locate);
    let latest: LocatorView | null = null;
    mount((value) => { latest = value; });

    await vi.waitFor(() => expect(locate).toHaveBeenCalledOnce());
    const requestId = locate.mock.calls[0]?.[0]?.requestId;
    act(() => bridge.emitProgress({
      availableAgentIds: ["opencode", "codex"],
      completedAgentCount: 2,
      requestId,
      totalAgentCount: 6,
    }));
    expect(latest?.phase).toBe("loading");
    expect(latest?.ids).toEqual(["codex", "opencode"]);

    act(() => bridge.emitProgress({
      availableAgentIds: ["hermes"],
      completedAgentCount: 6,
      requestId: "terminal-agent-location:stale",
      totalAgentCount: 6,
    }));
    expect(latest?.ids).toEqual(["codex", "opencode"]);

    await act(async () => {
      final.resolve(snapshot(["codex", "opencode", "hermes"]));
      await final.promise;
    });
    expect(latest?.phase).toBe("ready");
    expect(latest?.ids).toEqual(["codex", "opencode", "hermes"]);
  });
});

function mount(onValue: (value: LocatorView) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<Harness onValue={onValue} />));
}

function Harness({ onValue }: { onValue: (value: LocatorView) => void }) {
  const value = useTerminalAgentLocator({ enabled: true });
  useEffect(() => onValue(value), [onValue, value]);
  return null;
}

function installBridge(
  locate: ReturnType<typeof vi.fn>,
  additionalBridgeMethods: Record<string, unknown> = {},
) {
  let progressCallback: ((event: unknown) => void) | null = null;
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: {
      locateTerminalAgents: locate,
      onTerminalAgentLocationProgress: vi.fn((callback) => {
        progressCallback = callback;
        return () => { progressCallback = null; };
      }),
      ...additionalBridgeMethods,
    },
  });
  return {
    emitProgress(event: unknown) {
      progressCallback?.(event);
    },
  };
}

function snapshot(ids: string[]) {
  return {
    availableAgentIds: ids,
    scannedAt: "2026-08-15T00:00:00.000Z",
    source: "scan",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
