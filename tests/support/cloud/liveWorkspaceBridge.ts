import { vi } from "vitest";
import { fileRevision, liveFile, liveWorkbench } from "../../fixtures/cloud/repositories/liveWorkspace";

export type LiveRequest = { method: string; path: string; body?: string; expectedSession?: { generation: string } };
export type LiveChangeEvent = { type: "change"; paths?: string[] } | { type: "reconnecting" } | { type: "unavailable"; message?: string };

const failure = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

/**
 * In-memory live workbench with nested folders, served through the Desktop
 * preload bridge exactly as Main would: workbench status/open, directory
 * listings, conditional writes, directory operations and change events.
 */
export function installLiveWorkspaceBridge(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const folders = new Set<string>();
  const addParents = (path: string) => {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) folders.add(parts.slice(0, index).join("/"));
  };
  for (const path of files.keys()) addParents(path);
  let row = liveWorkbench();
  const log: LiveRequest[] = [];
  const holds: { match: (request: LiveRequest) => boolean; release: Promise<void> }[] = [];
  let listener: ((event: { id: string; generation?: string } & LiveChangeEvent) => void) | null = null;
  let subscription: { id: string; generation: string } | null = null;

  const childrenOf = (directory: string) => {
    const prefix = directory ? `${directory}/` : "";
    const names = new Map<string, "file" | "directory">();
    for (const path of files.keys()) if (path.startsWith(prefix)) {
      const rest = path.slice(prefix.length);
      names.set(rest.split("/")[0]!, rest.includes("/") ? "directory" : "file");
    }
    for (const path of folders) if (path.startsWith(prefix) && path.length > prefix.length) {
      const rest = path.slice(prefix.length);
      if (!names.has(rest.split("/")[0]!)) names.set(rest.split("/")[0]!, "directory");
    }
    return [...names].map(([name, kind]) => ({ name, kind, size: kind === "file" ? Buffer.byteLength(files.get(`${prefix}${name}`) ?? "") : 0, modified_ns: "1" }));
  };

  const request = vi.fn(async (input: LiveRequest) => {
    log.push(input);
    for (const hold of holds) if (hold.match(input)) await hold.release;
    const url = new URL(input.path, "https://cloud-fixture.puppyone.ai/api/v1");
    const path = url.searchParams.get("path") ?? "";
    const body = input.body ? JSON.parse(input.body) : null;
    if (url.pathname.endsWith("/workbench")) {
      if (input.method === "POST") { row = { ...row, state: "running" }; return row; }
      return { workspace: row };
    }
    if (row.state !== "running" || url.searchParams.get("generation") !== row.generation) throw failure(409);
    if (url.pathname.endsWith("/files")) {
      if (input.method === "GET") {
        if (path && !folders.has(path)) throw failure(404);
        return { entries: childrenOf(path) };
      }
      if (body.action === "mkdir") { folders.add(body.path); addParents(body.path); }
      if (body.action === "remove") {
        for (const key of [...files.keys()]) if (key === body.path || key.startsWith(`${body.path}/`)) files.delete(key);
        for (const key of [...folders]) if (key === body.path || key.startsWith(`${body.path}/`)) folders.delete(key);
      }
      if (body.action === "move") {
        if (files.has(body.destination) || folders.has(body.destination)) throw failure(409);
        for (const key of [...files.keys()]) if (key === body.path || key.startsWith(`${body.path}/`)) {
          files.set(body.destination + key.slice(body.path.length), files.get(key)!); files.delete(key);
        }
        addParents(body.destination);
      }
      return {};
    }
    if (url.pathname.endsWith("/file")) {
      if (input.method === "PUT") {
        if ((files.has(body.path) ? fileRevision(files.get(body.path)!) : null) !== body.expected_revision) throw failure(409);
        const content = Buffer.from(body.content_base64, "base64").toString();
        files.set(body.path, content); addParents(body.path);
        return { revision: fileRevision(content) };
      }
      if (!files.has(path)) throw failure(404);
      return liveFile(path, files.get(path)!);
    }
    throw new Error(`Unexpected endpoint: ${input.path}`);
  });

  const stopCloudWorkspaceWatch = vi.fn(async () => {});
  window.puppyoneDesktop = {
    requestCloudSessionApi: request,
    watchCloudWorkspace: vi.fn(async (input: { id: string; generation: string }) => { subscription = input; return { id: input.id }; }),
    stopCloudWorkspaceWatch,
    onCloudWorkspaceEvent: vi.fn((callback: typeof listener) => { listener = callback; return () => { if (listener === callback) listener = null; }; }),
  } as unknown as NonNullable<typeof window.puppyoneDesktop>;

  return {
    files,
    folders,
    request,
    log,
    stopCloudWorkspaceWatch,
    row: () => row,
    setRow: (next: typeof row) => { row = next; },
    /** Requests issued after `mark`, as "METHOD endpoint?path". */
    requestsSince(mark: number) {
      return log.slice(mark).map((entry) => {
        const url = new URL(entry.path, "https://cloud-fixture.puppyone.ai/api/v1");
        const endpoint = url.pathname.replace(/^.*\/workbench/, "") || "/";
        return `${entry.method} ${endpoint}${url.searchParams.has("path") ? `?${url.searchParams.get("path")}` : ""}`;
      });
    },
    /** Hold matching requests until the returned release function runs. */
    hold(match: (request: LiveRequest) => boolean) {
      let release!: () => void;
      holds.push({ match, release: new Promise<void>((resolve) => { release = resolve; }) });
      return () => release();
    },
    subscribed: () => subscription,
    /** Deliver a workspace event to the active subscription, as Main does. */
    emit(event: LiveChangeEvent) {
      if (!subscription || !listener) throw new Error("No active Cloud workspace subscription.");
      listener({ id: subscription.id, ...(event.type === "change" ? { generation: subscription.generation } : {}), ...event });
    },
  };
}

export type LiveWorkspaceBridge = ReturnType<typeof installLiveWorkspaceBridge>;
