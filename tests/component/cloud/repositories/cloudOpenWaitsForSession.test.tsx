/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowProjectNavigation } from "../../../../src/app/useWindowProjectNavigation";
import { windowProjectStore } from "../../../../src/features/app-shell/window-project/windowProjectStore";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = { user_id: "alice", session_generation: "one" } as DesktopCloudSession;
const openTarget = vi.fn(async () => undefined);
const noop = () => undefined;
let select: (projectId: string) => Promise<void>;
let cancel: () => void;
let root: Root;

function Harness({ restoring, current }: { restoring: boolean; current: DesktopCloudSession | null }) {
  const cancelRef = { current: noop };
  const navigation = useWindowProjectNavigation({
    accountCloud: { openTarget, lastAttemptedTarget: () => null } as never,
    activeCloudSession: current, cloudSessionRestoring: restoring, cancelAccountCloudOpen: noop, cancelProjectNavigationRef: cancelRef,
    cloudEnabled: true, cloudHeaderActive: false, drainWorkspaceNavigation: async () => true, initialCloudProject: null,
    lastProjectViewRef: { current: "data" }, navigateDesktopView: noop, openDroppedWorkspace: async () => undefined,
    openLocalWorkspace: noop, openWorkspacePath: async () => undefined, projectEntryFlow: { openLauncher: noop },
    restoringWorkspace: false, selectCloudProjectRef: { current: async () => undefined }, setSwitcherOpen: noop,
    t: (id) => id,
  });
  select = navigation.selectCloudProject;
  cancel = cancelRef.current;
  return null;
}
const render = (restoring: boolean, current: DesktopCloudSession | null) => act(async () => root.render(<Harness restoring={restoring} current={current} />));

beforeEach(() => {
  openTarget.mockClear();
  windowProjectStore.setState({ failure: null, opening: null });
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

describe("opening a Cloud project from the cached list", () => {
  it("waits for the session instead of reporting that nobody is signed in", async () => {
    await render(true, null);
    await act(async () => { void select("cloud-a"); });
    expect(openTarget).not.toHaveBeenCalled();
    expect(windowProjectStore.getState().failure).toBeNull();

    await render(false, session);
    expect(openTarget).toHaveBeenCalledExactlyOnceWith({ kind: "project_root", project_id: "cloud-a" }, expect.any(Function), true);
  });

  it("fails as signed out only once the session is known to be gone", async () => {
    await render(true, null);
    await act(async () => { void select("cloud-a"); });
    await render(false, null);
    expect(openTarget).not.toHaveBeenCalled();
    expect(windowProjectStore.getState().failure?.target).toEqual({ kind: "cloud", projectId: "cloud-a" });
  });

  it("does not open a project the user has since left", async () => {
    await render(true, null);
    await act(async () => { void select("cloud-a"); });
    await act(async () => cancel());
    await render(false, session);
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("opens at once when the session is already known", async () => {
    await render(false, session);
    await act(async () => { await select("cloud-a"); });
    expect(openTarget).toHaveBeenCalledOnce();
  });
});
