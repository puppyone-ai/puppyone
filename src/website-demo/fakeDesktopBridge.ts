/**
 * A stand-in for the Electron preload bridge (`window.puppyoneDesktop`) so the
 * real renderer can run in a plain browser tab for the website demo.
 *
 * Only what the demo needs is implemented: an in-memory folder built from the
 * scenario, a terminal that replays the agent, and Git status for the files it
 * touched. Every other bridge method resolves to `null`, and every `on…` /
 * `subscribe` call returns a no-op unsubscribe, so the app renders as a quiet
 * local project with no account, updates, telemetry or Cloud.
 */
import { getFileSemanticKind, getPreferredMimeType } from "@puppyone/shared-ui";
import { createHostRpc } from "../../shared/item-host-contract/rpc.mjs";
import { createFakeAgentHost } from "./fakeAgentHost";
import type { DemoScenario } from "./scenario";

type DemoChange = "modified" | "created";

const ROOT = "/Users/demo/Projects";

function dirname(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

type Callback<T> = (value: T) => void;

/** Same shapes local-api/git builds from `git status --porcelain=v2`. */
function buildGitStatus(changed: Map<string, DemoChange>, branch: string) {
  const entries = [...changed].map(([path, kind]) => kind === "created"
    ? { path, oldPath: null, staged: "?", unstaged: "?", status: "untracked" }
    : { path, oldPath: null, staged: " ", unstaged: "M", status: "modified" });
  const resource = (path: string, kind: DemoChange) => {
    const group = kind === "created" ? "untracked" : "workingTree";
    return {
      id: `${group}:${path}`, group, path, oldPath: null,
      status: kind === "created" ? "untracked" : "modified",
      staged: false, conflict: false, letter: kind === "created" ? "U" : "M",
    };
  };
  const byKind = (kind: DemoChange) => [...changed].filter(([, k]) => k === kind).map(([p, k]) => resource(p, k));
  const groups = [
    { id: "workingTree", label: "Changes", resources: byKind("modified") },
    { id: "untracked", label: "Untracked Changes", resources: byKind("created") },
  ].filter((group) => group.resources.length > 0);
  return {
    isRepo: true,
    branch,
    headCommitId: "website-demo-head",
    totalCommits: 12,
    entries,
    stagedEntries: [],
    unstagedEntries: entries.filter((entry) => entry.status === "modified"),
    untrackedEntries: entries.filter((entry) => entry.status === "untracked"),
    branches: [],
    remotes: [],
    syncTarget: null,
    effectiveHosting: { kind: "local-only", remoteName: null, branchName: branch, ref: null, ready: false, reason: "local-only", identity: null },
    sourceControl: {
      input: { placeholder: "", defaultMessage: "" },
      groups,
      remote: {
        target: null, currentBranch: branch, upstream: null, ahead: 0, behind: 0,
        incomingPreview: [], outgoingPreview: [], canPull: false, canPush: false, canSync: false, canPublish: false, state: "no-remote",
      },
      actions: { canStageAll: groups.length > 0, canUnstageAll: false, canDiscardAll: groups.length > 0, canCommit: false },
    },
    commits: [],
    allCommits: [],
    statusLimit: 10_000,
    didHitStatusLimit: false,
  };
}

/** A Mac with nothing to update, sync or sign in to. */
const HOST_IDENTITY = {
  getPlatformCapabilities: async () => ({
    schemaVersion: 1,
    platform: "macos",
    arch: "arm64",
    primaryModifier: "meta",
    windowChrome: { mode: "overlay" },
    credentialStorage: { available: false, locked: false, strength: "unavailable", backend: null },
    documentConversion: { supportedInputs: [] },
    updater: { supported: false, installMode: "manual" },
  }),
  getBuildInfo: async () => ({
    schemaVersion: 1,
    product: "puppyone-desktop",
    channel: "stable",
    baseVersion: "0.0.0",
    version: "0.0.0",
    buildId: "website-demo",
    platformBuildNumber: null,
    commitSha: "website-demo",
    builtAt: new Date(0).toISOString(),
    sourceDirty: false,
  }),
  getWindowChromeState: async () => ({ fullScreen: false, maximized: false }),
  themes: {
    list: async () => ({ themes: [], diagnostics: [] }),
    openDirectory: async () => ({ opened: true }),
    create: async () => ({ created: true, themeId: "" }),
    syncNativeMenu: async () => ({ synced: true }),
    onSelectionRequested: () => () => {},
  },
  localAgentActivation: {
    read: async () => ({ epoch: "website-demo", revision: 0, operations: [] }),
    subscribe: () => () => {},
    plan: async () => null,
    start: async () => ({ epoch: "website-demo", revision: 0, operations: [] }),
    act: async () => ({ epoch: "website-demo", revision: 0, operations: [] }),
    openGuide: async () => {},
  },
};

export type FakeBridgeOptions = {
  locale: string;
  /** Show the finished state at once (prefers-reduced-motion). */
  instant?: boolean;
  /** The window is ready to be shown (chat connected, nothing played yet). */
  onReady?: () => void;
  /** Start the agent's run when this resolves; immediately if omitted. */
  startSignal?: Promise<void>;
  /** Called when the agent's run has finished. */
  onDone?: () => void;
};

export function createFakeDesktopBridge(scenario: DemoScenario, { locale, instant = false, onReady, startSignal, onDone }: FakeBridgeOptions) {
  const rootPath = `${ROOT}/${scenario.folder}`;
  const branch = scenario.branch ?? "main";
  const objectUrls = new Set<string>();
  const objectUrl = (content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    objectUrls.add(url);
    return url;
  };

  // ---- in-memory folder ----------------------------------------------------
  const files = new Map(Object.entries(scenario.files));
  const versions = new Map<string, number>();
  const changed = new Map<string, DemoChange>();
  const folders = new Set<string>();
  const indexFolders = (path: string) => {
    for (let dir = dirname(path); dir; dir = dirname(dir)) folders.add(dir);
  };
  for (const path of files.keys()) indexFolders(path);

  const workspace = {
    id: "local:website-demo",
    name: scenario.folder,
    path: rootPath,
    status: "protected" as const,
    commitCount: 12,
    lastModifiedAt: new Date().toISOString(),
    hydrationState: "ready" as const,
    cloudState: "local" as const,
    workspaceInstanceId: "website-demo",
    fsIdentity: "website-demo",
  };

  const node = (path: string) => {
    const isFolder = folders.has(path);
    const name = basename(path);
    const content = files.get(path) ?? "";
    return {
      id: path,
      name,
      path,
      type: isFolder ? "folder" : getFileSemanticKind(name),
      mimeType: isFolder ? null : getPreferredMimeType(name),
      size: isFolder ? null : `${new Blob([content]).size} B`,
      modified: String(Math.floor(Date.now() / 1000) - 600),
      preview: null,
      content: null,
      hasChildren: isFolder ? true : undefined,
      children: null,
    };
  };

  const children = (folderPath: string | null) => {
    const parent = folderPath ?? "";
    return [...folders, ...files.keys()]
      .filter((path) => dirname(path) === parent)
      .map(node)
      .sort((a, b) => {
        if ((a.type === "folder") !== (b.type === "folder")) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name, locale);
      });
  };

  const gitStatus = () => buildGitStatus(changed, branch);

  // ---- change notifications ------------------------------------------------
  const workspaceWatchers = new Set<Callback<unknown>>();
  const gitWatchers = new Set<Callback<unknown>>();
  const windowFocusWatchers = new Set<Callback<{ focused: boolean }>>();
  const terminalData = new Set<Callback<{ id: string; instanceId?: string; data: string }>>();

  const writeFile = (path: string, content: string) => {
    const isNew = !files.has(path);
    files.set(path, content);
    versions.set(path, (versions.get(path) ?? 0) + 1);
    indexFolders(path);
    if (!changed.has(path)) changed.set(path, isNew ? "created" : "modified");
    const event = { rootPath, eventType: isNew ? "add" : "change", path, paths: [path] };
    workspaceWatchers.forEach((callback) => callback(event));
    // Git refreshes only run in the focused window; inside an iframe the
    // embedding page holds focus, so report this window as the active one.
    windowFocusWatchers.forEach((callback) => callback({ focused: true }));
    gitWatchers.forEach((callback) => callback({ subscriptionId: "website-demo", rootPath, reason: "working-tree" }));
  };

  // ---- the agent, replayed in a terminal ------------------------------------
  // Output travels the same way as in the app: numbered "terminal-frame"
  // messages on a MessagePort, one in flight until the renderer acknowledges it.
  let terminal: { id: string; instanceId: string } | null = null;
  let channel: { port: MessagePort; connection: string; sequence: number; inFlight: boolean; queue: string[] } | null = null;
  const flush = () => {
    if (!channel || channel.inFlight || channel.queue.length === 0) return;
    channel.inFlight = true;
    channel.sequence += 1;
    channel.port.postMessage({
      type: "terminal-frame",
      connection: channel.connection,
      sequence: channel.sequence,
      entries: channel.queue.splice(0).map((data) => ({ data })),
    });
  };
  const print = (data: string) => {
    if (!channel) return;
    channel.queue.push(data);
    flush();
  };
  const connectTerminal = (id: string) => {
    const { port1, port2 } = new MessageChannel();
    const binding = { connection: `website-demo-terminal-${id}`, hostGeneration: "website-demo" };
    // Input, resize and appearance commands from the renderer all succeed.
    const host = createHostRpc({ generation: binding.connection, send: (message: unknown) => port1.postMessage(message), handle: async () => ({ ok: true }) });
    channel = { port: port1, connection: binding.connection, sequence: 0, inFlight: false, queue: [] };
    port1.onmessage = ({ data }) => {
      if (data?.type === "terminal-ack") {
        if (channel) channel.inFlight = false;
        flush();
        return;
      }
      void host.receive(data);
    };
    port1.start();
    window.postMessage({ type: "puppyone-session-port", binding }, "*", [port2]);
    window.setTimeout(play, 300);
    return binding;
  };
  // A terminal the visitor opens is an idle shell in the project folder; the
  // agent's run lives in the chat.
  const play = () => print(`\x1b[90m~/Projects/${scenario.folder}\x1b[0m $ `);

  // The Agent pane's chat: Main's own transcript code, fed by the scenario.
  const agentHost = createFakeAgentHost({
    scenario,
    rootPath,
    instant,
    readFile: (path) => files.get(path),
    writeFile: (path, content) => writeFile(path, content),
    onReady,
    startSignal,
    onDone,
  });

  const implemented: Record<string, unknown> = {
    ...agentHost,
    resourceDragSessionSupported: false,

    ...HOST_IDENTITY,
    getLocalizationBootstrap: async () => ({
      preference: locale,
      locale,
      direction: "ltr",
      systemLanguages: [locale],
    }),

    // ---- workspace -----------------------------------------------------
    getInitialWorkspace: async () => ({ workspaceId: workspace.id, path: rootPath, workspace, workspaces: [workspace], error: null }),
    getLastWorkspace: async () => ({ workspaceId: workspace.id, path: rootPath, workspace, workspaces: [workspace], error: null }),
    getRecentWorkspaces: async () => ({ workspaces: [workspace], errors: [], hydrated: true }),
    hydrateRecentWorkspaces: async () => ({ workspaces: [workspace], errors: [], hydrated: true }),
    listFolderChildren: async ({ folderPath }: { folderPath: string | null }) => children(folderPath),
    resolveNode: async ({ path }: { path: string }) => node(path),
    readFile: async ({ path }: { path: string }) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`Not found: ${path}`);
      return {
        path,
        name: basename(path),
        type: getFileSemanticKind(basename(path)),
        content,
        mimeType: getPreferredMimeType(basename(path)),
        size: `${new Blob([content]).size} B`,
        version: `website-demo-${versions.get(path) ?? 0}`,
      };
    },
    writeFile: async ({ path, content }: { path: string; content: string }) => {
      files.set(path, content);
      versions.set(path, (versions.get(path) ?? 0) + 1);
      return { ok: true, version: `website-demo-${versions.get(path)}` };
    },
    // HTML previews and media are served from in-memory blobs.
    createPreviewDocument: async ({ content }: { content: string }) => ({ url: objectUrl(content, "text/html") }),
    createSandboxedPreviewDocument: async ({ content }: { content: string }) => ({ url: objectUrl(content, "text/html") }),
    getFileUrl: async ({ path }: { path: string }) => ({ url: objectUrl(files.get(path) ?? "", getPreferredMimeType(basename(path)) ?? "application/octet-stream") }),
    revokeFileUrl: async ({ url }: { url: string }) => {
      if (objectUrls.delete(url)) URL.revokeObjectURL(url);
      return { revoked: true };
    },
    revokeSandboxedPreviewDocument: async ({ url }: { url: string }) => {
      if (objectUrls.delete(url)) URL.revokeObjectURL(url);
      return { revoked: true };
    },
    watchWorkspace: (_root: string, callback: Callback<unknown>) => {
      workspaceWatchers.add(callback);
      return {
        stop: () => workspaceWatchers.delete(callback),
        ready: Promise.resolve({ subscriptionId: "website-demo", rootPath }),
      };
    },

    // ---- git -----------------------------------------------------------
    getGitStatus: async () => gitStatus(),
    startGitRepositoryWatch: async () => ({ subscriptionId: "website-demo", rootPath, repository: true }),
    onGitRepositoryInvalidated: (callback: Callback<unknown>) => {
      gitWatchers.add(callback);
      return () => gitWatchers.delete(callback);
    },
    onGitRepositoryWindowFocus: (callback: Callback<{ focused: boolean }>) => {
      windowFocusWatchers.add(callback);
      return () => windowFocusWatchers.delete(callback);
    },

    // ---- terminal --------------------------------------------------------
    createTerminal: async (request: { id: string; cwd: string }) => {
      terminal = { id: request.id, instanceId: `website-demo-${request.id}` };
      return { id: request.id, instanceId: terminal.instanceId, pid: 4242, shell: "/bin/zsh", inputShell: "zsh", cwd: request.cwd || rootPath };
    },
    onTerminalData: (callback: Callback<{ id: string; instanceId?: string; data: string }>) => {
      terminalData.add(callback);
      return () => terminalData.delete(callback);
    },
    connectTerminalSession: async ({ id }: { id: string }) => ({ ok: true, value: connectTerminal(id) }),
    writeTerminal: async () => ({ ok: true }),
    resizeTerminal: async () => ({ ok: true }),
    updateTerminalAppearance: async () => ({ ok: true }),

    // ---- project sessions (one open project, no failures) ----------------
    readProjectSessions: async () => ({
      streamId: "website-demo",
      revision: 1,
      projects: [{ projectId: workspace.id, generation: "1", rootPath, state: "open", failures: [] }],
    }),
  };

  // Anything not implemented: callable, nestable, and harmless. Stubs are
  // memoized so `bridge.themes` is the same object on every render (a fresh
  // object each time would re-run every effect that depends on it).
  const stubs = new Map<string, unknown>();
  const stub = (name: string): unknown => {
    const existing = stubs.get(name);
    if (existing) return existing;
    const created = new Proxy(function () {}, {
      get(_target, key) {
        if (key === "then") return undefined;
        return stub(`${name}.${String(key)}`);
      },
      apply() {
        const leaf = name.slice(name.lastIndexOf(".") + 1);
        if (/^on[A-Z]/.test(leaf) || leaf === "subscribe") return () => {};
        return Promise.resolve(null);
      },
    });
    stubs.set(name, created);
    return created;
  };

  const bridge = new Proxy(implemented, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (key === "then") return undefined;
      return stub(key);
    },
    has() {
      return true;
    },
  }) as unknown as NonNullable<Window["puppyoneDesktop"]>;

  return { bridge, replay: play };
}
