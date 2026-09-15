/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDesktopUpdates,
  type DesktopUpdatesController,
} from "../../../../src/features/updates/useDesktopUpdates";
import type {
  DesktopUpdateState,
  DesktopUpdateStatus,
} from "../../../../src/types/electron";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let latest: DesktopUpdatesController | null = null;

beforeEach(() => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  latest = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  latest = null;
  document.body.replaceChildren();
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
});

describe("useDesktopUpdates automatic-download preference", () => {
  it("loads the main-process state and delegates update actions", async () => {
    const unsubscribe = vi.fn();
    const checkForUpdates = vi.fn(async () => createState("not-available"));
    const updateNow = vi.fn(async () => createState("downloaded"));
    installBridge({
      checkForUpdates,
      getUpdateState: vi.fn(async () => createState("idle")),
      onUpdateStateChanged: vi.fn(() => unsubscribe),
      setAutomaticallyDownloadUpdates: vi.fn(),
      updateNow,
    });

    await mount();

    expect(latest?.state.status).toBe("idle");
    expect(latest?.automaticDownloadPreferenceAvailable).toBe(true);

    await act(async () => latest?.checkForUpdates());
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(latest?.state.status).toBe("not-available");

    await act(async () => latest?.updateNow());
    expect(updateNow).toHaveBeenCalledOnce();
    expect(latest?.state.status).toBe("downloaded");

    act(() => root?.unmount());
    root = null;
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("exposes saving state and commits the main-process response", async () => {
    let resolvePreference: ((state: DesktopUpdateState) => void) | null = null;
    const preferenceResult = new Promise<DesktopUpdateState>((resolve) => {
      resolvePreference = resolve;
    });
    const setAutomaticallyDownloadUpdates = vi.fn(() => preferenceResult);
    installBridge({
      getUpdateState: vi.fn(async () => createState("idle")),
      onUpdateStateChanged: vi.fn(() => () => {}),
      setAutomaticallyDownloadUpdates,
    });
    await mount();

    let operation: Promise<void> | undefined;
    await act(async () => {
      operation = latest?.setAutomaticallyDownloadUpdates(false);
      await Promise.resolve();
    });

    expect(setAutomaticallyDownloadUpdates).toHaveBeenCalledWith({ enabled: false });
    expect(latest?.automaticDownloadPreferenceSaving).toBe(true);
    expect(latest?.automaticDownloadPreferenceError).toBe(false);

    await act(async () => {
      resolvePreference?.({
        ...createState("idle"),
        automaticallyDownloadUpdates: false,
      });
      await operation;
    });

    expect(latest?.state.automaticallyDownloadUpdates).toBe(false);
    expect(latest?.automaticDownloadPreferenceSaving).toBe(false);
    expect(latest?.automaticDownloadPreferenceError).toBe(false);
  });

  it("keeps the last confirmed state and exposes a persistence failure", async () => {
    installBridge({
      getUpdateState: vi.fn(async () => createState("idle")),
      onUpdateStateChanged: vi.fn(() => () => {}),
      setAutomaticallyDownloadUpdates: vi.fn(async () => {
        throw new Error("preference disk full");
      }),
    });
    await mount();

    await act(async () => latest?.setAutomaticallyDownloadUpdates(false));

    expect(latest?.state.automaticallyDownloadUpdates).toBe(true);
    expect(latest?.automaticDownloadPreferenceSaving).toBe(false);
    expect(latest?.automaticDownloadPreferenceError).toBe(true);
  });
});

function Harness() {
  latest = useDesktopUpdates();
  return null;
}

async function mount() {
  await act(async () => {
    root?.render(<Harness />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function installBridge(methods: Record<string, unknown>) {
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: methods,
  });
}

function createState(status: DesktopUpdateStatus): DesktopUpdateState {
  return {
    status,
    currentVersion: "1.4.0",
    channel: "stable",
    automaticallyDownloadUpdates: true,
    availableVersion: status === "downloaded" ? "1.5.0" : null,
    updateInfo: null,
    progress: null,
    blockers: [],
    error: null,
    reason: null,
    lastCheckedAt: null,
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}
