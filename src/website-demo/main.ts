/**
 * Website demo entry: install the in-memory desktop bridge, seed the window
 * state a visitor should see, then boot the unmodified renderer (src/main.tsx)
 * and drive it the way a person would (open the Agent pane, start a chat).
 *
 * Query parameters:
 *   lang    – app locale (en, zh-Hans, ja, …); default en
 *   theme   – light | dark | system; default system
 *   motion  – "reduce" shows the finished state at once
 *   embed   – "1": wait for the embedding page to send the scenario
 *   nodirect – "1": boot only, without opening the Agent pane (debugging)
 *
 * Messages (window.postMessage, embedded mode):
 *   demo -> page  { type: "puppyone-demo:hello" }      ready for a scenario
 *   page -> demo  { type: "puppyone-demo:scenario", scenario }
 *   demo -> page  { type: "puppyone-demo:ready" }      the window can be shown
 *   page -> demo  { type: "puppyone-demo:play" }       start the agent's run
 *   demo -> page  { type: "puppyone-demo:done" }       the agent finished
 *
 * Only the puppyone website (and a page on this machine, while developing) can
 * drive an embedded demo; VITE_WEBSITE_DEMO_EMBED_ORIGINS adds more pages, such
 * as a test site, as a comma-separated list of origins. Any other page that
 * frames the demo gets a window that never starts.
 */
import { createWorkspaceResourceUri, createWorkspaceRootUri } from "@puppyone/shared-ui";
import { createFakeDesktopBridge } from "./fakeDesktopBridge";
import { DEFAULT_SCENARIO, parseDemoScenario, type DemoScenario } from "./scenario";

const params = new URLSearchParams(window.location.search);
const locale = params.get("lang") ?? "en";
const theme = (["light", "dark"] as const).find((value) => value === params.get("theme")) ?? "system";
const instant = params.get("motion") === "reduce";
const embedded = params.get("embed") === "1" && window.parent !== window;

const EMBED_ORIGINS = new Set([
  "https://www.puppyone.ai",
  "https://puppyone.ai",
  ...(import.meta.env.VITE_WEBSITE_DEMO_EMBED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
]);
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const canEmbed = (origin: string) => EMBED_ORIGINS.has(origin) || LOOPBACK_ORIGIN.test(origin);

/** Embedded: ask the page for the scenario (it owns the words). */
function receiveScenario(): Promise<{ scenario: DemoScenario; parentOrigin: string }> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== "puppyone-demo:scenario") return;
      if (!canEmbed(event.origin)) return console.warn("website demo: ignored a page that may not embed it");
      const scenario = parseDemoScenario(event.data.scenario);
      if (!scenario) return console.warn("website demo: ignored a malformed scenario");
      window.removeEventListener("message", onMessage);
      resolve({ scenario, parentOrigin: event.origin });
    };
    window.addEventListener("message", onMessage);
    // Says nothing but "ready", so it can go to whichever page framed the demo.
    window.parent.postMessage({ type: "puppyone-demo:hello" }, "*");
  });
}

const embedding = embedded ? await receiveScenario() : null;
const scenario = embedding?.scenario ?? DEFAULT_SCENARIO;
const notifyParent = (type: string) => {
  if (embedding) window.parent.postMessage({ type }, embedding.parentOrigin);
};
/** Embedded: the page starts the run once the window has opened. */
const startSignal = embedding
  ? new Promise<void>((resolve) => {
    window.addEventListener("message", (event) => {
      if (event.source === window.parent && event.origin === embedding.parentOrigin
        && event.data?.type === "puppyone-demo:play") resolve();
    });
  })
  : undefined;

// ---- seed window state ------------------------------------------------------
// Each demo window keeps its own storage. Several run side by side on the
// homepage (one per folder) and share an origin; with one localStorage they
// would read each other's open editors. Nothing persists between visits.
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => Array.from(items.keys())[index] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem: (key, value) => { items.set(key, String(value)); },
  };
}
Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
const seed = (key: string, value: unknown) =>
  window.localStorage.setItem(`puppyone.desktop.${key}`, typeof value === "string" ? value : JSON.stringify(value));

seed("headerCoachmarks.v1", { agent: true, changes: true });
seed("firstRunSignInCompleted.v1", "true");
seed("rightSidebarSurface", "chat");
seed("explorerWidth", "200");
seed("rightSidebarWidth", "360");
seed("appearance", {
  schemaVersion: 6,
  activeRootThemeId: "default",
  shared: {
    typography: { version: 11, contentFont: { mode: "follow-theme" }, codeFontId: "builtin:geist-mono", terminalFontId: "builtin:terminal-system-mono", scale: "medium" },
    pointerCursors: false,
    showFileIcons: true,
    loadingPlaceholderStyle: "rounded",
    fileIconTheme: "default",
    sidebarNavigationLayout: "bottom-horizontal",
  },
  byRootTheme: {
    default: { requestedColorMode: theme, requestedSubThemeIds: { light: "default.neutral", dark: "default.neutral" } },
  },
  bySurface: { markdown: { headingScale: "theme", strongColor: "theme", strongWeight: "theme" } },
});

const rootUri = createWorkspaceRootUri("website-demo");
if (scenario.open) {
  const editorId = createWorkspaceResourceUri(rootUri, scenario.open);
  seed("editor-workbench.v3:composition:local:website-demo", {
    group: {
      editors: [{ id: editorId, resource: editorId, resourceUri: editorId, rootUri, label: scenario.open.split("/").pop() }],
      activeEditorId: editorId,
      mostRecentlyUsed: [editorId],
    },
    layout: { root: { kind: "pane", id: "editor-pane-1", editorId }, activePaneId: "editor-pane-1" },
  });
}

// ---- boot the real app ---------------------------------------------------------
const { bridge } = createFakeDesktopBridge(scenario, {
  locale,
  instant,
  startSignal,
  onReady: () => notifyParent("puppyone-demo:ready"),
  onDone: () => notifyParent("puppyone-demo:done"),
});
window.puppyoneDesktop = bridge;
document.documentElement.dataset.websiteDemo = "";
await import("../main");

// ---- macOS window controls (drawn by the OS in the real app) -------------------
const lights = document.createElement("div");
lights.className = "website-demo-traffic-lights";
lights.setAttribute("aria-hidden", "true");
lights.innerHTML = "<i></i><i></i><i></i>";
document.body.append(lights);

// ---- drive the UI like a visitor would ------------------------------------------
function waitFor<T>(find: () => T | null | undefined, timeout = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const tick = () => {
      const found = find();
      if (found) return resolve(found);
      if (performance.now() - started > timeout) return reject(new Error("website demo: timed out"));
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

const treeRow = (path: string) =>
  document.querySelector<HTMLElement>(`[role="treeitem"][data-explorer-path="${createWorkspaceResourceUri(rootUri, path)}"]`);

async function direct() {
  await waitFor(() => document.querySelector('[role="treeitem"]'));

  // Reveal the open document in the file tree.
  const parts = scenario.open?.split("/").slice(0, -1) ?? [];
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const folder = parts.slice(0, depth).join("/");
    const row = await waitFor(() => treeRow(folder));
    if (row.getAttribute("aria-expanded") === "false") row.click();
  }

  // Open the Agent pane and start a chat with the agent.
  const toggle = await waitFor(() => document.querySelector<HTMLElement>(".desktop-titlebar-terminal"));
  if (toggle.getAttribute("aria-pressed") !== "true") toggle.click();
  const agent = await waitFor(() => document.querySelector<HTMLElement>(".desktop-terminal-launcher-tool"));
  agent.click();

}

if (params.get("nodirect") !== "1") void direct().catch((error) => console.warn(error));
