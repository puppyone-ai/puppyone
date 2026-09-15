import type { DesktopBridge } from "../../../support/electron/desktopBridge";
/**
 * @vitest-environment happy-dom
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalAgentInstallations } from "../../../../src/features/local-agents/controller/useLocalAgentInstallations";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type LocatorView = ReturnType<typeof useLocalAgentInstallations>;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  delete (window as Window & { puppyoneDesktop?: unknown }).puppyoneDesktop;
});

describe("shared Local Agent installation controller", () => {
  it("shows a retry state when a known installation is found through an incomplete environment", async () => {
    const result = deferred<unknown>();
    installBridge(vi.fn(() => result.promise));
    const latest: { current: LocatorView | null } = { current: null };
    mount((value) => { latest.current = value; });
    await act(async () => {
      result.resolve({ ...snapshot(["codex"]), results: [{
        ...installationResult("codex"), reasonCode: "environment-unavailable",
      }] });
      await result.promise;
    });
    expect(latest.current?.ids).toEqual(["codex"]);
    expect(latest.current?.hasFailures).toBe(true);
  });
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
    expect(locate).toHaveBeenLastCalledWith({
      refresh: true,
      requestId: expect.stringMatching(/^local-agent-installation:/u),
    });
    expect(getAgentActivityEnrollment).not.toHaveBeenCalled();
    expect(setAgentActivityEnrollment).not.toHaveBeenCalled();
  });

  it("forces a new scan when the right sidebar launcher is presented again", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const locate = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    const harness = mount((value) => { latest.current = value; });

    await vi.waitFor(() => expect(locate).toHaveBeenCalledOnce());
    await act(async () => {
      first.resolve(snapshot(["claude"], 1));
      await first.promise;
    });
    expect(latest.current?.ids).toEqual(["claude"]);
    harness.setEnabled(false);
    harness.setEnabled(true);
    await vi.waitFor(() => expect(locate).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve(snapshot(["codex", "claude"], 2));
      await second.promise;
    });
    expect(latest.current?.ids).toEqual(["codex", "claude"]);
    expect(locate).toHaveBeenNthCalledWith(2, {
      refresh: true,
      requestId: expect.stringMatching(/^local-agent-installation:/u),
    });
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
      requestId: expect.stringMatching(/^local-agent-installation:/u),
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

  it("retains prior installation evidence when one product cannot be inspected", async () => {
    const locate = vi.fn()
      .mockResolvedValueOnce(snapshot(["codex"]))
      .mockResolvedValueOnce({
        ...snapshot([]),
        generation: 2,
        scanId: "local-agent-scan:2",
        results: [{
          agentId: "codex",
          displayName: "Codex",
          status: "failed",
          reasonCode: "permission-denied",
        }],
      });
    installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    mount((value) => { latest.current = value; });

    await vi.waitFor(() => expect(latest.current?.phase).toBe("ready"));
    await act(async () => { await latest.current?.refresh(); });
    expect(latest.current?.ids).toEqual(["codex"]);
    expect(latest.current?.hasFailures).toBe(true);
  });

  it("shows installed Agents incrementally and ignores another request's events", async () => {
    const final = deferred<Awaited<ReturnType<DesktopBridge["discoverLocalAgentInstallations"]>>>();
    const locate = vi.fn<DesktopBridge["discoverLocalAgentInstallations"]>(() => final.promise);
    const bridge = installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    mount((value) => { latest.current = value; });

    await vi.waitFor(() => expect(locate).toHaveBeenCalledOnce());
    const requestId = locate.mock.calls[0]?.[0]?.requestId;
    act(() => bridge.emitProgress({
      availableAgentIds: ["opencode", "codex"],
      completedAgentCount: 2,
      generation: 1,
      requestId,
      results: [installationResult("opencode"), installationResult("codex")],
      scanId: "local-agent-scan:1",
      totalAgentCount: 6,
    }));
    expect(latest.current?.phase).toBe("loading");
    expect(latest.current?.ids).toEqual(["codex", "opencode"]);

    act(() => bridge.emitProgress({
      availableAgentIds: ["hermes"],
      completedAgentCount: 6,
      generation: 1,
      requestId: "local-agent-installation:stale",
      results: [installationResult("hermes")],
      scanId: "local-agent-scan:1",
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
  act(() => root?.render(<Harness enabled onValue={onValue} />));
  return {
    setEnabled(enabled: boolean) {
      act(() => root?.render(<Harness enabled={enabled} onValue={onValue} />));
    },
  };
}

function Harness({ enabled, onValue }: { enabled: boolean; onValue: (value: LocatorView) => void }) {
  const value = useLocalAgentInstallations({ enabled });
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
      discoverLocalAgentInstallations: locate,
      onLocalAgentInstallationProgress: vi.fn((callback) => {
        progressCallback.current = callback;
        return () => { progressCallback.current = null; };
      }),
      onLocalAgentInstallationsChanged: vi.fn(() => () => {}),
      ...additionalBridgeMethods,
    },
  });
  return {
    emitProgress(event: unknown) {
      progressCallback.current?.(event);
    },
  };
}

function snapshot(
  ids: Awaited<ReturnType<DesktopBridge["discoverLocalAgentInstallations"]>>["availableAgentIds"],
  generation = 1,
): Awaited<ReturnType<DesktopBridge["discoverLocalAgentInstallations"]>> {
  return {
    schemaVersion: 1,
    generation,
    scanId: `local-agent-scan:${generation}`,
    requestedAt: "2026-08-15T00:00:00.000Z",
    completedAt: "2026-08-15T00:00:00.001Z",
    availableAgentIds: ids,
    results: ids.map(installationResult),
    source: "scan",
  };
}

function installationResult(agentId: Awaited<ReturnType<DesktopBridge["discoverLocalAgentInstallations"]>>["availableAgentIds"][number]) {
  return {
    agentId,
    displayName: agentId,
    status: "found" as const,
    source: "path-installation",
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
