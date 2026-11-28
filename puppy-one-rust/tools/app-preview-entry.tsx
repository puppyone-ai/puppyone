// The product's App Preview (AppPreviewViewer with its setup, state and
// logs views and the sandboxed app frame) running in the native viewer's
// WebView. Bundled against the product sources by
// tools/import-app-preview.mjs.
//
// `appPreview` is the desktop controller (src/lib/localFiles.ts): detection
// and setup run here over the native workspace reads; the runtime (trust,
// processes, static serving, logs) is the native one, reached by request.
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalizationProvider } from "@puppyone/localization/react";
import { AppPreviewViewer } from "./src/shared-ui/editor/viewers/app/AppPreviewViewer";
import {
  createAppPreviewManifestContentFromSetup,
  detectAppPreviewSetup,
} from "./src/features/data-workspace/appPreviewCreation";
import { parseAppPreviewManifest } from "./shared/appPreviewManifest.js";
import type { AppPreviewController, AppPreviewResult, DataNode, FileContent } from "./src/shared-ui/core/types";
import { DesktopTooltipLayer } from "./src/components/DesktopTooltipLayer";

type Boot = Readonly<{
  text: string; name: string; path: string; available: boolean;
  locale: string; direction: "ltr" | "rtl"; messages: Record<string, string>;
}>;
type Inbound = { type: "reset"; text: string }
  | { type: "reply"; request: number; ok: boolean; value?: unknown; error?: string }
  | { type: "runtime"; state: AppPreviewResult };

declare global {
  interface Window {
    __PUPPYONE_APP_PREVIEW: Boot;
    __puppyoneAppPreview?: (message: Inbound) => void;
    ipc?: { postMessage: (message: string) => void };
  }
}

const boot = window.__PUPPYONE_APP_PREVIEW;
const post = (message: object) => window.ipc?.postMessage(JSON.stringify(message));
let nextRequest = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
function request<T>(method: string, fields: Record<string, unknown> = {}): Promise<T> {
  const id = ++nextRequest;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    post({ type: method, request: id, ...fields });
  });
}
const listeners = new Set<(state: AppPreviewResult) => void>();
const listChildren = (path: string | null) => request<DataNode[]>("list", { path });
const readFile = (path: string) => request<FileContent>("read", { path });

// `preflightAppPreviewLaunch` (src/lib/localFiles.ts).
function parentPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? null : normalized.slice(0, slash) || null;
}
function joinPaths(base: string | null, relative: string): string {
  return [base, relative].filter((value): value is string => Boolean(value && value !== ".")).join("/");
}
function packageScriptOf(command: readonly string[]): string | null {
  const executable = command[0]?.split(/[\\/]/).at(-1)?.toLowerCase().replace(/\.cmd$/, "");
  if (!executable || !new Set(["npm", "pnpm", "yarn", "bun"]).has(executable)) return null;
  if (command[1] !== "run") return null;
  const script = command[2];
  return script && !script.startsWith("-") ? script : null;
}
async function preflight(appPath: string, launch: NonNullable<ReturnType<typeof parseAppPreviewManifest>["launch"]>) {
  const appDirectory = parentPath(appPath);
  if (launch.kind === "existing-url") return;
  if (launch.kind === "static-file") {
    await readFile(joinPaths(appDirectory, launch.path)).catch(() => {
      throw new Error(`HTML file not found: ${launch.path}`);
    });
    return;
  }
  const workingDirectory = joinPaths(appDirectory, launch.cwd);
  const children = await listChildren(workingDirectory || null).catch(() => {
    throw new Error(`Working folder not found: ${launch.cwd}`);
  });
  const script = packageScriptOf(launch.command);
  if (!script) return;
  const packageNode = children.find((node) => node.type !== "folder" && node.name === "package.json");
  if (!packageNode) throw new Error(`No package.json was found in ${launch.cwd}.`);
  const packageFile = await readFile(packageNode.path);
  let scripts: unknown;
  try {
    scripts = JSON.parse(packageFile.content ?? "")?.scripts;
  } catch {
    throw new Error(`package.json in ${launch.cwd} is not valid JSON.`);
  }
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts) || typeof (scripts as Record<string, unknown>)[script] !== "string") {
    throw new Error(`Package script not found: ${script}`);
  }
}

const controller: AppPreviewController = {
  detect: (path) => detectAppPreviewSetup({ listChildren, readFile: (filePath) => readFile(filePath) }, path),
  configure: async ({ path, name, setup, expectedContent }) => {
    const content = createAppPreviewManifestContentFromSetup(name, setup);
    const manifest = parseAppPreviewManifest(content, { appPath: path });
    if (manifest.launch) await preflight(path, manifest.launch);
    // The native side rereads the file and refuses a changed one.
    return request("configure", { path, content, expected: expectedContent });
  },
  start: (path) => request<AppPreviewResult>("start", { path }),
  restart: (path) => request<AppPreviewResult>("restart", { path }),
  stop: (path) => request<AppPreviewResult>("stop", { path }),
  getLogs: (path) => request<string>("logs", { path }),
  openExternal: (path) => request<void>("openExternal", { path }),
  subscribeRuntime: (listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

function App() {
  const [content, setContent] = useState(boot.text);
  useEffect(() => {
    window.__puppyoneAppPreview = (message) => {
      if (message.type === "reset") setContent(message.text);
      else if (message.type === "reply") {
        const waiting = pending.get(message.request);
        pending.delete(message.request);
        if (message.ok) waiting?.resolve(message.value);
        else waiting?.reject(new Error(message.error ?? "App Preview failed."));
      } else if (message.type === "runtime") {
        for (const listener of listeners) listener(message.state);
      }
    };
    post({ type: "ready" });
    return () => { window.__puppyoneAppPreview = undefined; };
  }, []);
  const document = useMemo(() => ({ name: boot.name, path: boot.path, type: "app" }) as never, []);
  return <section className="editor-host app-preview-host">
    <AppPreviewViewer document={document} content={content} loading={false} error={null}
      appPreview={boot.available ? controller : undefined} />
  </section>;
}

function Root() {
  const state = useMemo(() => ({ preference: boot.locale, locale: boot.locale, direction: boot.direction,
    systemLanguages: [boot.locale] }) as never, []);
  const client = useMemo(() => ({
    setLanguagePreference: async () => state,
    onLocaleChanged: () => () => undefined,
  }), [state]);
  const loadCatalog = useCallback(async () => ({ catalog: boot.messages, fallbackCatalog: boot.messages }), []);
  return <LocalizationProvider initialState={state} initialCatalog={boot.messages} fallbackCatalog={boot.messages}
    loadCatalog={loadCatalog} client={client} onDiagnostic={() => undefined}>
    <App />
    <DesktopTooltipLayer />
  </LocalizationProvider>;
}

document.documentElement.lang = boot.locale;
document.documentElement.dir = boot.direction;
createRoot(document.getElementById("root")!).render(<Root />);
