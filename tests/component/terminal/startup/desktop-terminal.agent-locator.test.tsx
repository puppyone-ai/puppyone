import type { DesktopBridge } from "../../../support/electron/desktopBridge";
/**
 * @vitest-environment happy-dom
 */
import { act, useEffect } from "react";
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
    const latest: { current: LocatorView | null } = { current: null };
    mount((value) => { latest.current = value; });

    await vi.waitFor(() => expect(latest.current?.phase).toBe("ready"));
    expect(latest.current?.ids).toEqual(["codex"]);
    expect(getAgentActivityEnrollment).not.toHaveBeenCalled();
    expect(setAgentActivityEnrollment).not.toHaveBeenCalled();

    await act(async () => {
      await latest.current?.refresh();
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
    const latest: { current: LocatorView | null } = { current: null };
    mount((value) => { latest.current = value; });

    await vi.waitFor(() => expect(locate).toHaveBeenCalledTimes(1));
    await act(async () => {
      void latest.current?.refresh();
    });
    expect(locate).toHaveBeenNthCalledWith(2, {
      refresh: true,
      requestId: expect.stringMatching(/^terminal-agent-location:/u),
    });

    await act(async () => {
      second.resolve(snapshot(["codex"]));
      await second.promise;
    });
    expect(latest.current?.ids).toEqual(["codex"]);

    await act(async () => {
      first.resolve(snapshot(["opencode"]));
      await first.promise;
    });
    expect(latest.current?.ids).toEqual(["codex"]);
  });

  it("retains the last successful list when refresh fails", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const locate = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    mount((value) => { latest.current = value; });

    await vi.waitFor(() => expect(locate).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.resolve(snapshot(["claude"]));
      await first.promise;
    });
    expect(latest.current?.ids).toEqual(["claude"]);
    await act(async () => {
      const refresh = latest.current?.refresh();
      second.reject(new Error("IPC unavailable"));
      await refresh;
    });
    expect(latest.current?.phase).toBe("error");
    expect(latest.current?.ids).toEqual(["claude"]);
  });

  it("shows installed Agents incrementally and ignores another request's events", async () => {
    const final = deferred<Awaited<ReturnType<DesktopBridge["locateTerminalAgents"]>>>();
    const locate = vi.fn<DesktopBridge["locateTerminalAgents"]>(() => final.promise);
    const bridge = installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    mount((value) => { latest.current = value; });

    await vi.waitFor(() => expect(locate).toHaveBeenCalledOnce());
    const requestId = locate.mock.calls[0]?.[0]?.requestId;
    act(() => bridge.emitProgress({
      availableAgentIds: ["opencode", "codex"],
      completedAgentCount: 2,
      requestId,
      totalAgentCount: 6,
    }));
    expect(latest.current?.phase).toBe("loading");
    expect(latest.current?.ids).toEqual(["codex", "opencode"]);

    act(() => bridge.emitProgress({
      availableAgentIds: ["hermes"],
      completedAgentCount: 6,
      requestId: "terminal-agent-location:stale",
      totalAgentCount: 6,
    }));
    expect(latest.current?.ids).toEqual(["codex", "opencode"]);

    await act(async () => {
      final.resolve(snapshot(["codex", "opencode", "hermes"]));
      await final.promise;
    });
    expect(latest.current?.phase).toBe("ready");
    expect(latest.current?.ids).toEqual(["codex", "opencode", "hermes"]);
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
  const progressCallback: { current: ((event: unknown) => void) | null } = { current: null };
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: {
      locateTerminalAgents: locate,
      onTerminalAgentLocationProgress: vi.fn((callback) => {
        progressCallback.current = callback;
        return () => { progressCallback.current = null; };
      }),
      ...additionalBridgeMethods,
    },
  });
  return {
    emitProgress(event: unknown) {
      progressCallback.current?.(event);
    },
  };
}

function snapshot(ids: Awaited<ReturnType<DesktopBridge["locateTerminalAgents"]>>["availableAgentIds"]): Awaited<ReturnType<DesktopBridge["locateTerminalAgents"]>> {
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
