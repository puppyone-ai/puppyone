/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceFolder, closeDocumentWorkingCopiesUnderResource, type Workspace } from "@puppyone/shared-ui";
import { useWorkbenchWorkspaceContentWatch } from "../../../../src/features/data-workspace/useWorkbenchWorkspaceContentWatch";
import type { WorkspaceChangedEvent } from "../src/types/electron";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "puppyoneDesktop");
  vi.restoreAllMocks();
});

describe("Workbench Workspace content watch", () => {
  it("releases a retired root and creates a fresh subscription when reopened", async () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const watchWorkspace = vi.fn(() => { const stop = vi.fn(); stops.push(stop); return { stop, ready: Promise.resolve({}) }; });
    Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: { watchWorkspace } });
    const folder = createWorkspaceFolder(workspace("reopen", "/workspace/reopen"));
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    function Probe({ visible }: { visible: boolean }) {
      useWorkbenchWorkspaceContentWatch({ folders: visible ? [folder] : [], storageIdentity: "reopen", onWorkspaceContentChanged: () => undefined });
      return null;
    }
    await act(async () => root.render(<Probe visible />));
    await act(async () => closeDocumentWorkingCopiesUnderResource("reopen", folder.uri));
    expect(stops[0]).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Probe visible={false} />));
    await act(async () => root.render(<Probe visible />));
    expect(watchWorkspace).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    expect(stops[1]).toHaveBeenCalledTimes(1);
  });

  it("owns every Folder watch outside Git and preserves the originating Folder identity", async () => {
    const callbacks = new Map<string, (event: WorkspaceChangedEvent) => void>();
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const watchWorkspace = vi.fn((rootPath: string, callback: (event: WorkspaceChangedEvent) => void) => {
      callbacks.set(rootPath, callback);
      const stop = vi.fn();
      stops.push(stop);
      return {
        stop,
        ready: Promise.resolve({ subscriptionId: rootPath, rootPath }),
      };
    });
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: { watchWorkspace },
    });

    const first = createWorkspaceFolder(workspace("first", "/workspace/first"));
    const second = createWorkspaceFolder(workspace("second", "/workspace/second"), { index: 1 });
    const onWorkspaceContentChanged = vi.fn();
    const onWorkspaceActivity = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Probe() {
      useWorkbenchWorkspaceContentWatch({
        folders: [first, second],
        onWorkspaceContentChanged,
        onWorkspaceActivity,
      });
      return null;
    }

    await act(async () => root.render(<Probe />));
    expect(watchWorkspace).toHaveBeenCalledTimes(2);

    await act(async () => callbacks.get(first.workspace.path)?.({
      rootPath: first.workspace.path,
      eventType: "change",
      path: "README.md",
    }));
    await act(async () => callbacks.get(second.workspace.path)?.({
      rootPath: second.workspace.path,
      eventType: "change",
      path: "README.md",
    }));

    expect(onWorkspaceContentChanged).toHaveBeenNthCalledWith(1, "README.md", first.id);
    expect(onWorkspaceContentChanged).toHaveBeenNthCalledWith(2, "README.md", second.id);
    expect(onWorkspaceActivity).toHaveBeenNthCalledWith(1, first);
    expect(onWorkspaceActivity).toHaveBeenNthCalledWith(2, second);

    await act(async () => callbacks.get(first.workspace.path)?.({
      rootPath: first.workspace.path,
      eventType: "error",
      path: null,
      error: "watch failed",
    }));
    expect(onWorkspaceContentChanged).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  });

  it("reconciles attached and detached Folders without accepting stale callbacks", async () => {
    const registrations: Array<{
      rootPath: string;
      callback: (event: WorkspaceChangedEvent) => void;
      stop: ReturnType<typeof vi.fn>;
    }> = [];
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        watchWorkspace: vi.fn((
          rootPath: string,
          callback: (event: WorkspaceChangedEvent) => void,
        ) => {
          const registration = { rootPath, callback, stop: vi.fn() };
          registrations.push(registration);
          return {
            stop: registration.stop,
            ready: Promise.resolve({ subscriptionId: rootPath, rootPath }),
          };
        }),
      },
    });
    const alpha = createWorkspaceFolder(workspace("alpha", "/workspace/alpha"));
    const beta = createWorkspaceFolder(workspace("beta", "/workspace/beta"), { index: 1 });
    const gamma = createWorkspaceFolder(workspace("gamma", "/workspace/gamma"), { index: 1 });
    const onWorkspaceContentChanged = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Probe({ folders }: { folders: readonly typeof alpha[] }) {
      useWorkbenchWorkspaceContentWatch({ folders, onWorkspaceContentChanged });
      return null;
    }

    await act(async () => root.render(<Probe folders={[alpha, beta]} />));
    const staleAlpha = registrations.find((entry) => entry.rootPath === alpha.workspace.path)!;
    await act(async () => root.render(<Probe folders={[beta, gamma]} />));
    expect(staleAlpha.stop).toHaveBeenCalledOnce();

    await act(async () => staleAlpha.callback({
      rootPath: alpha.workspace.path,
      eventType: "change",
      path: "stale.md",
    }));
    expect(onWorkspaceContentChanged).not.toHaveBeenCalled();

    const activeGamma = registrations.findLast((entry) => entry.rootPath === gamma.workspace.path)!;
    await act(async () => activeGamma.callback({
      rootPath: gamma.workspace.path,
      eventType: "change",
      path: "live.md",
    }));
    expect(onWorkspaceContentChanged).toHaveBeenCalledWith("live.md", gamma.id);

    await act(async () => root.unmount());
    expect(registrations.every((entry) => entry.stop.mock.calls.length === 1)).toBe(true);
  });
});

function workspace(id: string, path: string): Workspace {
  return {
    id,
    workspaceInstanceId: id,
    name: id,
    path,
    status: "recording",
  };
}
