import { initializeDesktopPreferences, desktopPreferencesStore } from "../../../src/preferencesStore";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { createAgentProcessService } from "../../../electron/main/item-hosts/agent-process-service.mjs";
import type { createUtilityHost } from "../../../electron/main/item-hosts/utility-host.mjs";
import { createItemLifecycleSupervisor } from "../../../electron/main/item-hosts/item-lifecycle-supervisor.mjs";
import { registerItemLifecycleIpc } from "../../../electron/main/ipc/item-lifecycle-ipc.mjs";
import type { ItemExecutionRequest, ItemLifecyclePort } from "../../../shared/item-host-contract/lifecycle";
import { AuxiliaryWorkbenchPanel } from "../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { ProjectWorkbenchStore } from "../../../src/lib/workbench/ProjectWorkbenchStore";
import type { AuxiliaryWorkbenchContribution } from "../../../src/lib/workbench/types";
import type { AgentClientPort } from "../../../src/features/desktop-agent/application/AgentClientPort";
import { createManagedAgentClient } from "../../../src/features/desktop-agent/infrastructure/electron/agentExecutionClient";
import { createProjectAgentClientProvider } from "../../../src/features/desktop-agent/infrastructure/electron/electronAgentClient";
import { AgentChatWorkbenchItem, requestCloseAgentChatWorkbenchItem } from "../../../src/features/desktop-agent/workbench/AgentChatWorkbenchItem";
import { createAgentChatCloseAdapter } from "../../../src/features/desktop-agent/workbench/agentChatCloseAdapter";
import { projectAgentControllers } from "../../../src/features/desktop-agent/workbench/projectAgentControllers";
import type { AgentSessionFrame } from "../../../src/features/desktop-agent/agentTypes";
import { createServiceHarness, createSender } from "./agentServiceHarness.mjs";
import { stripBidiIsolation, testT, withTestLocalization } from "../react/localization";

type NativeHarness = ReturnType<typeof createServiceHarness>;
type Adapter = NativeHarness["adapters"][number];
type Host = {
  native: NativeHarness;
  itemId: string | null;
  cleanup: ReturnType<typeof Promise.withResolvers<void>>;
  call: ReturnType<typeof vi.fn<(method: string, args?: unknown[]) => Promise<unknown>>>;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  exited: boolean;
  generation: ReturnType<typeof crypto.randomUUID>;
  ready: Promise<unknown>;
  exit: Promise<unknown>;
  pid: number;
  attachPort: ReturnType<typeof vi.fn<(port: unknown, binding: unknown) => void>>;
  diagnostics: ReturnType<typeof createUtilityHost>["diagnostics"];
};

/** Only native execution and the OS-exit gate are fixtures. All lifecycle, Actor,
 * feed, replica, contribution policy and Workbench UI are production objects. */
export async function createAgentWorkbenchLifecycleHarness({ holdCreation = false, holdFirstAttach = false } = {}) {
  const context = { projectId: "fixture-project", generation: "open-1", rootPath: "/workspace" };
  const project = new ProjectWorkbenchStore(context);
  const catalog = createServiceHarness({ capabilities: { manualApprovals: true, queue: true } });
  const lifecycle = createItemLifecycleSupervisor();
  const hosts: Host[] = [];
  const subscribers = new Set<(frame: AgentSessionFrame) => void>();
  let transform = (frame: AgentSessionFrame): AgentSessionFrame | null => frame;
  const creationGate = holdCreation ? Promise.withResolvers<void>() : null;
  const initialAttachGate = holdFirstAttach ? Promise.withResolvers<void>() : null;
  const owner = createSender(890);
  const createHost = vi.fn(() => {
    const ordinal = hosts.length + 1;
    const native = createServiceHarness({
      capabilities: { manualApprovals: true, queue: true },
      configureAdapter: (adapter: Adapter) => {
        const create = adapter.createSession.getMockImplementation()!;
        adapter.createSession.mockImplementation(async (...args: unknown[]) => {
          const result = await create(...args);
          if (ordinal === 1 && creationGate) await creationGate.promise;
          return { ...result, title: `Fixture chat ${ordinal}` };
        });
        let turn = 0;
        adapter.startTurn.mockImplementation(async () => {
          const turnId = `turn-${++turn}`;
          adapter.emit({ type: "turn.started", turnId, providerSessionId: "thread-1", payload: { status: "running" } });
          return { turnId };
        });
      },
    });
    const nativeOwner = createSender(owner.id);
    nativeOwner.send.mockImplementation((channel: string, frame: AgentSessionFrame) => {
      if (channel !== "agent:session-frame") return;
      const value = transform(frame);
      if (value) for (const subscriber of subscribers) subscriber(value);
    });
    const exited = Promise.withResolvers<void>();
    const host: Host = {
      native, itemId: null, exited: false, cleanup: Promise.withResolvers<void>(),
      generation: crypto.randomUUID(), ready: Promise.resolve(), exit: exited.promise,
      pid: 90000 + hosts.length, attachPort: vi.fn(() => {}),
      diagnostics: () => ({ pid: host.pid, generation: host.generation, exited: host.exited,
        closing: host.close.mock.calls.length > 0, failure: null, health: { state: "responsive", lastSeen: 0, probeSent: false }, nativeProcesses: [],
        pending: 0, pendingBytes: 0, incoming: 0, incomingBytes: 0, closed: host.exited }),
      call: vi.fn(async (method: string, args: unknown[] = []) => {
        const request = args[0] as Record<string, unknown>;
        host.itemId ??= typeof request?.itemId === "string" ? request.itemId : null;
        const invoke = Reflect.get(native.service, method) as (...input: unknown[]) => Promise<unknown>;
        return invoke(nativeOwner, ...args);
      }),
      close: vi.fn(async () => {
        // Cooperative cancellation begins immediately; OS cleanup confirmation
        // may arrive much later. A queued command must never escape this seal.
        await native.service.closeAll();
        await host.cleanup.promise;
        host.exited = true;
        exited.resolve();
      }),
    };
    hosts.push(host);
    return host;
  });
  const processService = createAgentProcessService({
    createHost, lifecycle, catalogService: catalog.service,
    conversationCatalog: catalog.persistence, attachmentStore: {},
    utilityProcess: null, modulePath: "fixture-in-process-host", budget: null, appVersion: "test",
  });
  type Handler = (event: { sender: { id: number } }, request: ItemExecutionRequest) => Promise<unknown>;
  const handlers = new Map<string, Handler>();
  registerItemLifecycleIpc({
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    lifecycle, projectSessions: { require: () => context }, manage: () => {},
  });
  const management = {
    terminateItemExecution: vi.fn((request: ItemExecutionRequest) =>
      handlers.get("item-execution:terminate")!({ sender: owner }, request)),
  };
  const ports = new Map<string, ReturnType<typeof createBasePort>>();
  function createBasePort(itemId: string) {
    let attaches = 0;
    const sender = { ...owner, hostItemId: itemId };
    const invoke = async (method: string, request: unknown) => {
      const call = Reflect.get(processService, method) as (...args: unknown[]) => unknown;
      return call(sender, request, context.rootPath);
    };
    return {
      discoverAgentRuntimes: vi.fn((request: unknown) => invoke("discoverProviders", request)),
      createAgentSession: vi.fn((request: unknown) => invoke("createSession", request)),
      openAgentSession: vi.fn((request: unknown) => invoke("openSession", request)),
      resumeAgentSession: vi.fn((request: unknown) => invoke("resumeSession", request)),
      attachAgentSession: vi.fn(async (request: unknown) => {
        const receipt = await invoke("attachSession", request);
        if (++attaches === 1 && initialAttachGate) await initialAttachGate.promise;
        return receipt;
      }),
      acknowledgeAgentSession: vi.fn((request: unknown) => invoke("acknowledgeSession", request)),
      readAgentSessionWatermark: vi.fn((request: unknown) => invoke("readSessionWatermark", request)),
      detachAgentSession: vi.fn((request: unknown) => invoke("detachSession", request)),
      startAgentTurn: vi.fn((request: unknown) => invoke("startTurn", request)),
      interruptAgentTurn: vi.fn((request: unknown) => invoke("interruptTurn", request)),
      closeAgentSession: vi.fn((request: unknown) => invoke("closeSession", request)),
      resolveAgentApproval: vi.fn((request: unknown) => invoke("resolveApproval", request)),
      revokeAgentAttachments: vi.fn(async () => ({ revoked: 0 })),
      onAgentSessionFrame: (listener: (frame: AgentSessionFrame) => void) => {
        subscribers.add(listener);
        return () => { subscribers.delete(listener); };
      },
    };
  }
  const registry = projectAgentControllers(project, {
    // The production project client binds instance/project identity; the managed
    // client binds creation/termination before the asynchronous native create.
    createClient: (itemId: string) => {
      const base = createBasePort(itemId);
      ports.set(itemId, base);
      const managed = createManagedAgentClient(base as unknown as AgentClientPort,
        management as unknown as ItemLifecyclePort, context, itemId);
      return createProjectAgentClientProvider(context, () => managed);
    },
  });
  initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  desktopPreferencesStore.getState().setAgentPreferredRuntime("codex");
  const contribution: AuxiliaryWorkbenchContribution = {
    kind: "agent-chat", label: "Chat", createLabel: "New chat", maximumItems: 8,
    minimumSize: { width: 280, height: 260 },
    initialSnapshot: { title: "New chat", accessibleLabel: "New chat", detail: null, iconKey: null,
      status: "idle", running: false, resourceId: null },
    renderItem: props => <AgentChatWorkbenchItem {...props} hiddenRuntimeIds={[]} onOpenAccount={() => {}} onOpenModelConnections={() => {}} />,
    close: createAgentChatCloseAdapter(testT, ({ project, item }) => requestCloseAgentChatWorkbenchItem(project, item.id)),
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(withTestLocalization(<AuxiliaryWorkbenchPanel store={project}
    contributions={[contribution]} active renderLauncher={() => <div data-empty-workbench />} />)));
  await act(async () => { await project.create("agent-chat", null); });
  const itemId = container.querySelector<HTMLElement>('[role="tabpanel"]')!.dataset.terminalSessionPaneId!;
  const controller = registry.get(itemId);
  await act(async () => { await controller.initializeForRuntime("codex"); });
  function native(item = itemId) {
    const host = hosts.find(entry => entry.itemId === item);
    if (!host) throw new Error("The Chat has no native execution.");
    return host;
  }
  function adapter(item = itemId) { return native(item).native.adapters.find(entry => !entry.disposed)!; }
  function emit(type: string, payload = {}, id: string | null = null, turnId = "turn-1", item = itemId) {
    adapter(item).emit({ type, payload, itemId: id, turnId, providerSessionId: "thread-1" });
  }
  async function send(text = "First request", item = itemId) {
    const target = registry.get(item);
    act(() => target.setDraft(text));
    // Actual Composer action drives first preparation and submission.
    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
    if (sendButton.disabled) throw new Error("The healthy Chat cannot send.");
    await act(async () => { sendButton.click(); });
  }
  async function close(item = itemId, confirm = true) {
    const label = project.getSnapshot().snapshots.get(item)?.title ?? "New chat";
    const button = [...container.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
      .find(entry => stripBidiIsolation(entry.getAttribute("aria-label")) === `Close ${label}`);
    if (!button) throw new Error("The Chat close action is unavailable.");
    await act(async () => { button.click(); });
    const dialog = document.querySelector(".desktop-workbench-close-dialog");
    if (dialog && confirm) {
      const action = dialog.querySelector<HTMLButtonElement>(".desktop-dialog-footer button:last-child")!;
      if (action.disabled) throw new Error("The confirmation is blocked.");
      await act(async () => { action.click(); });
    }
  }
  async function addChat() {
    const previous = new Set(project.getSnapshot().topology.items.map(item => item.id));
    await act(async () => { await project.create("agent-chat", null); });
    const item = project.getSnapshot().topology.items.find(item => !previous.has(item.id))!;
    await act(async () => { await registry.get(item.id).initializeForRuntime("codex"); });
    return item.id;
  }
  return {
    project, registry, controller, itemId, container, ports, management, lifecycle, processService, hosts,
    native, adapter, emit, send, close, addChat, subscribers,
    setTransform: (next: typeof transform) => { transform = next; },
    creationGate, initialAttachGate,
    async dispose() {
      creationGate?.resolve();
      initialAttachGate?.resolve();
      for (const host of hosts) host.cleanup.resolve();
      act(() => root.unmount());
      project.dispose();
      await processService.closeAll();
      await catalog.service.closeAll();
      container.remove();
    },
  };
}
