import type { DesktopBridge } from "../../../support/electron/desktopBridge";
/**
 * @vitest-environment happy-dom
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalAgentInstallations } from "../../../../src/features/local-agents/controller/useLocalAgentInstallations";
import { TerminalLauncher } from "../../../../src/features/desktop-terminal/ui/TerminalLauncher";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type LocatorView = ReturnType<typeof useLocalAgentInstallations>;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  delete (window as Window & { puppyoneDesktop?: unknown }).puppyoneDesktop;
  vi.useRealTimers();
});

describe("shared Local Agent installation controller", () => {
  it("only shows discovery feedback for the initial scan and an explicit refresh, never a reopened launcher", async () => {
    vi.useFakeTimers();
    const first = deferred<unknown>(); const refreshed = deferred<unknown>();
    const locate = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(refreshed.promise);
    installBridge(locate);
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const render = (enabled: boolean) => act(() => root?.render(withTestLocalization(<SessionLauncher enabled={enabled} />)));
    render(true);
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector(".desktop-terminal-launcher-discovery")?.textContent).toBe("Checking local agents…");
    await act(async () => { first.resolve(snapshot(["codex"])); await first.promise; });
    render(false); render(true);
    act(() => {
      vi.advanceTimersByTime(60_000);
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(locate).toHaveBeenCalledOnce();
    expect(container.querySelector(".desktop-terminal-launcher-discovery")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>(".desktop-terminal-launcher-tool")?.disabled).toBe(false);
    act(() => container.querySelector<HTMLButtonElement>(".desktop-terminal-launcher-scan")?.click());
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector(".desktop-terminal-launcher-discovery")?.textContent).toBe("Refreshing agents…");
    expect(locate).toHaveBeenCalledTimes(2);
    await act(async () => { refreshed.resolve(snapshot(["codex", "claude"], 2)); await refreshed.promise; });
    expect(container.querySelector(".desktop-terminal-launcher-discovery")).toBeNull();
  });

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

  it("reuses the session result on reopen, remount, window focus and visibility changes", async () => {
    const first = deferred<unknown>();
    const locate = vi.fn().mockReturnValueOnce(first.promise);
    installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    const harness = mount((value) => { latest.current = value; });

    await vi.waitFor(() => expect(locate).toHaveBeenCalledOnce());
    await act(async () => {
      first.resolve(snapshot(["claude"], 1));
      await first.promise;
    });
    expect(latest.current?.ids).toEqual(["claude"]);
    for (let index = 0; index < 3; index++) {
      harness.setEnabled(false);
      harness.setEnabled(true);
    }
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => root?.unmount());
    mount(value => { latest.current = value; });
    expect(latest.current?.ids).toEqual(["claude"]);
    expect(latest.current?.phase).toBe("ready");
    expect(locate).toHaveBeenCalledOnce();
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

  it("rejects regressing counts, malformed progress and old scans across progress, broadcasts and invoke", async () => {
    const final = deferred<unknown>();
    const locate = vi.fn().mockReturnValue(final.promise);
    const bridge = installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    mount(value => { latest.current = value; });
    const requestId = locate.mock.calls[0]?.[0]?.requestId;
    const progress = { ...snapshot(["codex", "opencode"], 3), requestId, completedAgentCount: 2, totalAgentCount: 8 };
    act(() => bridge.emitProgress(progress));
    expect(latest.current?.progress?.completedAgentCount).toBe(2);
    const accepted = latest.current;
    for (const invalid of [
      { ...progress, ...snapshot(["claude"], 3), completedAgentCount: 1 },
      { ...progress, ...snapshot(["claude"], 2), completedAgentCount: 1 },
      { ...progress, scanId: "other-scan" },
      { ...progress, completedAgentCount: 3 },
      { ...progress, availableAgentIds: ["claude"] },
      { ...progress, totalAgentCount: 9 },
    ]) act(() => bridge.emitProgress(invalid));
    act(() => bridge.emitChanged(snapshot(["claude"], 2)));
    expect(latest.current).toBe(accepted);
    act(() => bridge.emitChanged(snapshot(["hermes"], 4)));
    // An initial scan's broadcast can arrive before its invoke response; it
    // must not rename that same cold request to a background refresh.
    expect(latest.current?.refreshing).toBe(false);
    act(() => bridge.emitProgress(progress));
    await act(async () => { final.resolve(snapshot(["codex"], 3)); await final.promise; });
    expect(latest.current?.ids).toEqual(["hermes"]);
    expect(latest.current?.snapshot?.generation).toBe(4);
    expect(latest.current?.phase).toBe("ready");
    expect(latest.current?.progress).toBeNull();
  });

  it("retains results while refreshing, clears old warnings, and removes only definitive missing installations", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const locate = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const bridge = installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    mount(value => { latest.current = value; });
    await act(async () => {
      first.resolve({ ...snapshot(["codex", "claude"]), results: [
        { ...installationResult("codex"), reasonCode: "environment-unavailable" }, installationResult("claude"),
      ] });
      await first.promise;
    });
    expect(latest.current?.hasFailures).toBe(true);
    act(() => { void latest.current?.refresh(); });
    expect(latest.current?.ids).toEqual(["codex", "claude"]);
    expect(latest.current?.hasFailures).toBe(false);
    expect(latest.current?.refreshing).toBe(true);
    act(() => bridge.emitProgress({ ...snapshot(["hermes"], 2), requestId: locate.mock.calls[1]?.[0]?.requestId,
      completedAgentCount: 1, totalAgentCount: 8 }));
    expect(latest.current?.ids).toEqual(["codex", "claude", "hermes"]);
    await act(async () => {
      second.resolve({ ...snapshot(["hermes"], 2), results: [
        { agentId: "codex", displayName: "Codex", status: "failed" },
        { agentId: "claude", displayName: "Claude", status: "not-found" }, installationResult("hermes"),
      ] });
      await second.promise;
    });
    expect(latest.current?.ids).toEqual(["codex", "hermes"]);
    expect(latest.current?.hasFailures).toBe(true);
    expect(latest.current?.progress).toBeNull();
  });

  it("finishes the initial scan while hidden and receives other windows' explicit refreshes", async () => {
    const final = deferred<unknown>();
    const locate = vi.fn(() => final.promise);
    const bridge = installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    const harness = mount(value => { latest.current = value; });
    harness.setEnabled(false);
    await act(async () => { final.resolve(snapshot(["codex"])); await final.promise; });
    act(() => bridge.emitChanged(snapshot(["codex", "claude"], 2)));
    harness.setEnabled(true);
    expect(latest.current?.ids).toEqual(["codex", "claude"]);
    expect(latest.current?.phase).toBe("ready");
    expect(locate).toHaveBeenCalledOnce();
  });

  it("reopening during the first scan keeps the same request and progressive results", async () => {
    const final = deferred<unknown>();
    const locate = vi.fn((_request?: { requestId?: string; refresh?: boolean }) => final.promise);
    const bridge = installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    const harness = mount(value => { latest.current = value; });
    harness.setEnabled(false);
    harness.setEnabled(true);
    act(() => bridge.emitProgress({ ...snapshot(["codex"]), requestId: locate.mock.calls[0]?.[0]?.requestId,
      completedAgentCount: 1, totalAgentCount: 8 }));
    expect(latest.current?.ids).toEqual(["codex"]);
    expect(locate).toHaveBeenCalledOnce();
    await act(async () => { final.resolve(snapshot(["codex"])); await final.promise; });
    expect(latest.current?.phase).toBe("ready");
  });

  it.each(["empty", "failed"])("does not silently retry a %s first result on reopen", async (outcome) => {
    const locate = vi.fn().mockImplementation(async () => {
      if (outcome === "failed") throw new Error("IPC unavailable");
      return snapshot([]);
    });
    installBridge(locate);
    const latest: { current: LocatorView | null } = { current: null };
    const harness = mount(value => { latest.current = value; });
    await act(async () => {});
    harness.setEnabled(false); harness.setEnabled(true);
    expect(locate).toHaveBeenCalledOnce();
    expect(latest.current?.phase).toBe(outcome === "empty" ? "ready" : "error");
    locate.mockResolvedValueOnce(snapshot(["codex"], 2));
    await act(async () => { await latest.current?.refresh(); });
    expect(locate).toHaveBeenCalledTimes(2);
    expect(latest.current?.ids).toEqual(["codex"]);
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

function SessionLauncher({ enabled }: { enabled: boolean }) {
  const discovery = useLocalAgentInstallations({ enabled });
  return enabled ? <TerminalLauncher agentMode="terminal" discoveryPhase={discovery.phase}
    discoveryRefreshing={discovery.refreshing} discoveryHasFailures={discovery.hasFailures}
    availableAgentIds={discovery.ids} onLaunch={() => {}} onRefresh={discovery.refresh} /> : null;
}

function installBridge(
  locate: ReturnType<typeof vi.fn>,
  additionalBridgeMethods: Record<string, unknown> = {},
) {
  const progressCallback: { current: ((event: unknown) => void) | null } = { current: null };
  const changedCallback: { current: ((event: unknown) => void) | null } = { current: null };
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: {
      discoverLocalAgentInstallations: locate,
      onLocalAgentInstallationProgress: vi.fn((callback) => {
        progressCallback.current = callback;
        return () => { progressCallback.current = null; };
      }),
      onLocalAgentInstallationsChanged: vi.fn((callback) => {
        changedCallback.current = callback;
        return () => { changedCallback.current = null; };
      }),
      ...additionalBridgeMethods,
    },
  });
  return {
    emitChanged(event: unknown) { changedCallback.current?.(event); },
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
