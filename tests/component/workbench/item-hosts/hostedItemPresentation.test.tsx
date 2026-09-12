/** @vitest-environment happy-dom */
import { EventEmitter } from "node:events";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { attachNativeSurfaceView } from "../../../../electron/main/native-surfaces/view-attachment.mjs";
import type { ItemHostBridge, ItemHostEvent, ItemHostState } from "../../../../shared/item-host-contract/types";
import { HostedItem, projectItemHosts } from "../../../../src/features/app-shell/auxiliary-workbench/host/HostedItemPool";
import { HostedItemView } from "../../../../src/features/app-shell/auxiliary-workbench/host/HostedItemView";
import { ProjectWorkbenchStore } from "../../../../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";

vi.mock("@puppyone/localization/react", () => ({ useLocalization: () => ({ t: (key: string) => key, direction: "ltr" }) }));

let root: Root | null = null;
const cleanups: Array<() => void> = [];
afterEach(() => {
  act(() => root?.unmount()); root = null;
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.replaceChildren();
  delete window.puppyoneDesktop;
});

function fixture() {
  const state: ItemHostState = { itemId: "terminal-1", generation: "display-1", display: "ready", execution: "ready" };
  const bridge: ItemHostBridge = {
    create: vi.fn(async () => state), configure: vi.fn(async () => {}), focus: vi.fn(),
    close: vi.fn(async () => {}), recover: vi.fn(async () => ({ ...state, generation: "display-2" })),
    setGeometry: vi.fn(), onState: () => () => {}, onEvent: () => () => {}, respond: vi.fn(),
  };
  const project = new ProjectWorkbenchStore({ projectId: "project-a", generation: "open-1", rootPath: "/fixture" });
  const identity = { itemId: state.itemId, kind: "terminal" as const, projectContext: project.context };
  const host = new HostedItem(identity, bridge);
  host.update(state);
  return { state, bridge, project, host };
}
const geometry = { revision: 1, visible: true, bounds: { x: 500, y: 40, width: 400, height: 700 } };

it("revokes an old mount's geometry, configuration, focus and cleanup rights", async () => {
  const { host, bridge } = fixture();
  const old = host.bindPresentation();
  old.geometry(geometry);
  const current = host.bindPresentation();
  current.geometry(geometry);
  old.geometry({ ...geometry, visible: false });
  await old.configure({ presented: false }); old.focus(); old.release();
  expect(bridge.setGeometry).toHaveBeenCalledTimes(2);
  expect(bridge.setGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ presentationId: 2, revision: 2, visible: true }));
  expect(bridge.configure).not.toHaveBeenCalled();
  expect(bridge.focus).not.toHaveBeenCalled();
  current.release(); current.release();
  expect(bridge.setGeometry).toHaveBeenCalledTimes(3);
  expect(bridge.setGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 3, visible: false }));
});

it("replays geometry into a recovered display without replaying focus or execution", async () => {
  const { host, bridge } = fixture();
  const binding = host.bindPresentation();
  binding.geometry(geometry);
  binding.focus();
  await host.recover();
  expect(bridge.setGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ generation: "display-2", revision: 2, visible: true }));
  expect(bridge.focus).toHaveBeenCalledTimes(1);
  expect(bridge.create).not.toHaveBeenCalled();
  const listener = vi.fn(); host.eventListeners.add(listener);
  const event: ItemHostEvent = { itemId: "terminal-1", generation: "display-2", type: "focus-changed",
    payload: { presentationId: 1, sequence: 1, focused: true, activate: true } };
  host.event({ ...event, generation: "display-1" });
  host.event({ ...event, payload: { ...event.payload as object, presentationId: 0 } });
  expect(listener).not.toHaveBeenCalled();
  host.event(event);
  expect(listener).toHaveBeenCalledTimes(1);
  binding.release(); host.event(event);
  expect(listener).toHaveBeenCalledTimes(1);
});

it("hides the current presentation before disposal and makes late React cleanup inert", async () => {
  const { host, bridge } = fixture();
  const binding = host.bindPresentation();
  binding.geometry(geometry);
  host.dispose();
  binding.release(); binding.geometry(geometry); binding.focus();
  await binding.configure({ presented: true });
  expect(bridge.setGeometry).toHaveBeenCalledTimes(2);
  expect(bridge.setGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  expect(bridge.configure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ presented: false, commandTarget: false }));
  expect(bridge.focus).not.toHaveBeenCalled();
});

it("shows retained native content on remount and same-size relocation, including StrictMode", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
  let x = 500;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    x, y: 40, left: x, top: 40, right: x + 400, bottom: 740, width: 400, height: 700, toJSON: () => ({}),
  }));
  const view = { webContents: { isDestroyed: () => false }, setVisible: vi.fn(), setBounds: vi.fn() };
  const windowFixture = Object.assign(new EventEmitter(), {
    webContents: { id: 1 }, isVisible: () => true, getContentSize: () => [1000, 800],
    contentView: { addChildView() {}, removeChildView() {} },
  });
  const attachment = attachNativeSurfaceView({ window: windowFixture, view, nativeSurfaceOcclusion: undefined, nativeSurfacePointerPassthrough: undefined, onPointerDown: undefined, onVisibilityChange: undefined });
  cleanups.push(() => attachment.dispose());
  const { bridge, project } = fixture();
  vi.mocked(bridge.setGeometry).mockImplementation((request) => attachment.geometry(request));
  Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: { itemHosts: bridge } });
  const pool = projectItemHosts(project);
  cleanups.push(() => project.dispose());
  await pool.prepare("terminal-1", "terminal");
  const focusChanged = vi.fn();
  const render = async (layoutRevision: number, focusRequest = 0) => {
    if (!root) { const container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
    await act(async () => root!.render(<StrictMode><HostedItemView project={project}
      item={{ id: "terminal-1", kind: "terminal", rootId: "/fixture", contextId: "project-a" }}
      presentation={{ presented: true, sidebarVisible: true, commandTarget: true, domFocused: false }}
      layoutRevision={layoutRevision} focusRequest={focusRequest} onContentFocusChange={focusChanged}
      onPresentationChange={() => {}} /></StrictMode>));
  };
  await render(1);
  expect(attachment.isVisible()).toBe(true);
  expect(bridge.focus).not.toHaveBeenCalled();
  act(() => root!.unmount()); root = null;
  expect(attachment.isVisible()).toBe(false);
  await render(1);
  expect(attachment.isVisible()).toBe(true);
  expect(bridge.create).toHaveBeenCalledTimes(1);
  x = 0;
  await render(2);
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 40, width: 400, height: 700 });
  await render(2, 1);
  expect(bridge.focus).toHaveBeenCalledTimes(1);
  const host = pool.get("terminal-1")!;
  const request = vi.mocked(bridge.setGeometry).mock.lastCall![0];
  act(() => host.event({ itemId: "terminal-1", generation: host.state.generation, type: "focus-changed",
    payload: { presentationId: request.presentationId, sequence: 1, focused: true, activate: true } }));
  expect(focusChanged).toHaveBeenLastCalledWith(true, true);
  await render(3, 1);
  expect(bridge.focus).toHaveBeenCalledTimes(1);
  const revisions = vi.mocked(bridge.setGeometry).mock.calls.map(([request]) => request.revision);
  expect(revisions.every((value, index) => index === 0 || value > revisions[index - 1])).toBe(true);
});
