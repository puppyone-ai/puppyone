/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSettingsView } from "../../../../src/features/settings/main/RepositorySettingsViews";
import { useGitAutoCommitSettings } from "../../../../src/features/source-control/useGitAutoCommitSettings";
import type { GitAutoCommitSnapshot, GitStatusSnapshot } from "../src/types/electron";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const workspaceRoot = "/workspace/project";
let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  await act(async () => { await Promise.resolve(); });
  delete window.puppyoneDesktop;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Git Auto Commit settings", () => {
  it("renders no feature controls when the optional preload capability is absent", async () => {
    await renderGitSettings(true);

    expect(container.textContent).not.toContain("Automatic local commits");
    expect(container.querySelector('input[aria-label="Enable for this workspace"]')).toBeNull();
  });

  it("keeps workspace controls hidden until the global experiment is enabled", async () => {
    const bridge = installBridge(snapshot());
    await renderGitSettings(false);

    expect(bridge.getGitAutoCommitSettings).toHaveBeenCalledWith({ rootPath: workspaceRoot });
    expect(container.textContent).not.toContain("Automatic local commits");
  });

  it("requires confirmation and sends only the bounded workspace policy", async () => {
    const bridge = installBridge(snapshot());
    const confirm = vi.fn(() => false);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    await renderGitSettings(true);
    await vi.waitFor(() => expect(findToggle()).not.toBeNull());

    await act(async () => findToggle().click());
    expect(confirm).toHaveBeenCalledOnce();
    expect(bridge.setGitAutoCommitWorkspacePolicy).not.toHaveBeenCalled();
    expect(findToggle().checked).toBe(false);

    confirm.mockReturnValue(true);
    await act(async () => findToggle().click());
    await vi.waitFor(() => expect(findToggle().checked).toBe(true));
    expect(bridge.setGitAutoCommitWorkspacePolicy).toHaveBeenLastCalledWith({
      rootPath: workspaceRoot,
      enabled: true,
    });

    const select = container.querySelector<HTMLSelectElement>("select.desktop-settings-select")!;
    await act(async () => {
      select.value = "900000";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(bridge.setGitAutoCommitWorkspacePolicy).toHaveBeenLastCalledWith({
      rootPath: workspaceRoot,
      minimumIntervalMs: 900_000,
    });
  });

  it("renders structured runtime events and a quiet inline mutation error", async () => {
    const bridge = installBridge(snapshot({
      workspacePolicy: policy({ enabled: true }),
      effectiveEnabled: true,
    }));
    await renderGitSettings(true);
    bridge.emit(snapshot({
      workspacePolicy: policy({ enabled: true }),
      effectiveEnabled: true,
      runtime: {
        state: "idle",
        nextEligibleAt: null,
        lastResult: {
          outcome: "committed",
          reason: "untracked-files-committed",
          commitId: "a".repeat(40),
          pathCount: 2,
          retryable: false,
        },
      },
    }));
    await vi.waitFor(() => expect(container.textContent).toContain("Committed locally"));
    expect(container.textContent).toContain("untracked-files-committed");
    expect(container.textContent).toContain("aaaaaaaa");

    bridge.setGitAutoCommitWorkspacePolicy.mockRejectedValueOnce(new Error("policy write failed"));
    await act(async () => findToggle().click());
    await vi.waitFor(() => expect(container.querySelector('[role="alert"], .danger')).not.toBeNull());
    expect(container.textContent).toContain("policy write failed");
  });

  it("refreshes on demand, reports initial load failure, and disposes subscriptions", async () => {
    const bridge = installBridge(snapshot());
    await act(async () => {
      root?.render(<HookProbe rootPath={workspaceRoot} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("disabled"));

    bridge.setCurrent(snapshot({
      runtime: { state: "idle", nextEligibleAt: null, lastResult: null },
    }));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    await vi.waitFor(() => expect(container.textContent).toContain("idle"));

    await act(async () => {
      root?.render(<HookProbe rootPath="/workspace/second" />);
      await Promise.resolve();
    });
    expect(bridge.unsubscribe).toHaveBeenCalledOnce();

    bridge.getGitAutoCommitSettings.mockRejectedValueOnce(new Error("initial load failed"));
    await act(async () => {
      root?.render(<HookProbe rootPath="/workspace/failing" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("initial load failed"));
  });
});

function HookProbe({ rootPath }: { rootPath: string }) {
  const settings = useGitAutoCommitSettings(rootPath, true);
  return (
    <button type="button" onClick={() => void settings.refresh()}>
      {settings.error ?? settings.snapshot?.runtime?.state ?? "empty"}
    </button>
  );
}

async function renderGitSettings(experimentalOptIn: boolean) {
  await act(async () => {
    root?.render(withTestLocalization(
      <GitSettingsView
        workspaceRoot={workspaceRoot}
        experimentalOptIn={experimentalOptIn}
        status={gitStatus()}
        loading={false}
        error={null}
        copiedRemoteKey={null}
        copyError={null}
        onCopyRemoteUrl={async () => undefined}
        onRefresh={() => undefined}
      />,
    ));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findToggle(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(
    'input[aria-label="Enable for this workspace"]',
  )!;
}

function installBridge(initial: GitAutoCommitSnapshot) {
  let current = initial;
  const listeners = new Set<(value: GitAutoCommitSnapshot) => void>();
  const unsubscribe = vi.fn((listener: (value: GitAutoCommitSnapshot) => void) => {
    listeners.delete(listener);
  });
  const bridge = {
    getGitAutoCommitSettings: vi.fn(async () => current),
    setGitAutoCommitWorkspacePolicy: vi.fn(async (request: {
      enabled?: boolean;
      minimumIntervalMs?: number;
    }) => {
      current = snapshot({
        ...current,
        workspacePolicy: policy({ ...current.workspacePolicy, ...request }),
        effectiveEnabled: request.enabled ?? current.effectiveEnabled,
      });
      listeners.forEach((listener) => listener(current));
      return current;
    }),
    onGitAutoCommitStateChanged: vi.fn((listener: (value: GitAutoCommitSnapshot) => void) => {
      listeners.add(listener);
      return () => unsubscribe(listener);
    }),
    emit(next: GitAutoCommitSnapshot) {
      current = next;
      act(() => listeners.forEach((listener) => listener(next)));
    },
    setCurrent(next: GitAutoCommitSnapshot) {
      current = next;
    },
    unsubscribe,
  };
  Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: bridge });
  return bridge;
}

function snapshot(overrides: Partial<GitAutoCommitSnapshot> = {}): GitAutoCommitSnapshot {
  return {
    available: true,
    experimentalOptIn: true,
    repository: true,
    workspacePolicy: policy(),
    effectiveEnabled: false,
    runtime: { state: "disabled", nextEligibleAt: null, lastResult: null },
    ...overrides,
  };
}

function policy(overrides: Partial<NonNullable<GitAutoCommitSnapshot["workspacePolicy"]>> = {}) {
  return {
    enabled: false,
    scope: "untracked-only" as const,
    minimumIntervalMs: 300_000,
    quietPeriodMs: 60_000,
    updatedAt: null,
    ...overrides,
  };
}

function gitStatus(): GitStatusSnapshot {
  return {
    isRepo: true,
    branch: "main",
    headCommitId: "1".repeat(40),
    totalCommits: 1,
    entries: [],
    stagedEntries: [],
    unstagedEntries: [],
    untrackedEntries: [],
    branches: [],
    remotes: [],
    syncTarget: null,
    effectiveHosting: {
      kind: "local-only",
      remoteName: null,
      branchName: "main",
      ref: "refs/heads/main",
      ready: true,
      reason: "local-only",
      identity: null,
    },
    sourceControl: {} as GitStatusSnapshot["sourceControl"],
    commits: [],
    allCommits: [],
    statusLimit: 10_000,
    didHitStatusLimit: false,
  };
}
