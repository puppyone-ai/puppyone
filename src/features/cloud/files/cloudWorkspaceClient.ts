import { cloudApiRequest, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { getFileSemanticKind } from "@puppyone/shared-ui";
import type { CloudEntry } from "./contracts";
import { cloudWorkspaceOpeningPhase, createCloudWorkspaceOpeningProgress } from "./cloudWorkspaceOpening";
import { cloudWorkspaceIdentity, inspectCloudWorkspaceHandoff, takeCloudWorkspaceHandoff, type CloudWorkspaceHandoff } from "./cloudWorkspaceHandoff";

import type { CloudWorkbench } from "./contracts";
export type { CloudWorkbench } from "./contracts";
export type WorkspaceEntry = { name: string; kind: string; size: number; modified_ns: string };
type FileReply = WorkspaceEntry & { content_base64: string; revision: string };
export type WorkspaceVersion = { workspace: string; generation: string; revision: string };
type OpeningResult = { workspace: CloudWorkbench; entries?: WorkspaceEntry[] };
type Opening = { result: Promise<OpeningResult>; progress: ReturnType<typeof createCloudWorkspaceOpeningProgress> };
const openings = new Map<string, Opening>();
const limit = 8 * 1024 * 1024;
const failure = (message: string, status = 409, code?: string, retryable = true) => Object.assign(new Error(message), { status, code, retryable });

async function paceStatusObservation(row: CloudWorkbench, started: number) {
  // Older servers may ignore wait_seconds. Rate-limit only fast, pending
  // replies; a long wait or a ready/error response needs no extra delay.
  if ((row.state === "running" && !row.operation?.pending) || row.operation?.error
    || ["retained", "cleanup_pending"].includes(row.state)) return;
  const pause = Math.max(0, 1_000 - (Date.now() - started));
  if (pause) await new Promise(resolve => setTimeout(resolve, pause));
}

export function parseWorkspaceVersion(value: string): WorkspaceVersion {
  if (!value.startsWith("cloud-workspace:")) throw failure("Reload this file before saving: its workspace revision is unavailable.");
  const result = JSON.parse(value.slice(16)) as WorkspaceVersion;
  if (typeof result.workspace !== "string" || !result.workspace || typeof result.generation !== "string"
    || !result.generation || !/^[a-f0-9]{64}$/.test(result.revision)) throw failure("Invalid workspace revision.");
  return result;
}
export function decodeWorkspaceBytes(value: string) {
  if (typeof value !== "string" || value.length > Math.ceil(limit / 3) * 4) throw failure("File exceeds the 8 MiB workspace preview limit.", 413);
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (bytes.length > limit) throw failure("File exceeds the 8 MiB workspace preview limit.", 413);
  return bytes;
}
export function encodeWorkspaceBytes(bytes: Uint8Array) {
  if (bytes.length > limit) throw failure("File exceeds the 8 MiB workspace editor limit.", 413);
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}

/** Live files only. No provider SDK, Git publication or published-content fallback. */
export function createCloudWorkspaceClient(session: DesktopCloudSession,
  context: Extract<ProjectCloudContext, { status: "resolved" }>, apiBaseUrl: string,
  assertCurrent: () => void = () => {}, prepared?: CloudWorkspaceHandoff) {
  if (context.target.kind !== "project_root" || context.scopePath) throw failure("Live Cloud workspaces require access to the complete project.", 403);
  const endpoint = `/projects/${encodeURIComponent(context.projectId)}/workbench`;
  const identity = cloudWorkspaceIdentity(session, context, apiBaseUrl);
  let workspace: CloudWorkbench | null = null;
  let preparing: Promise<CloudWorkbench> | null = null;
  const openingProgress = createCloudWorkspaceOpeningProgress();
  const directories = new Map<string, { entries: CloudEntry[] }>();
  const reads = new Map<string, Promise<FileReply>>();
  const listings = new Map<string, Promise<{ entries: CloudEntry[] }>>();
  let cacheEpoch = 0;
  let activeSubscriptions = 0;
  let openingRoot: { entries: CloudEntry[]; expiresAt: number } | undefined;
  const request = async <T>(suffix: string, init: RequestInit = {}) => {
    assertCurrent();
    try {
      const value = await cloudApiRequest<T>(endpoint + suffix, session, undefined, init, apiBaseUrl);
      assertCurrent(); return value;
    } catch (error) {
      invalidate();
      throw error;
    }
  };
  const accept = (row: CloudWorkbench) => {
    if (!row || row.project_id !== context.projectId || !row.id || !row.generation || typeof row.state !== "string") throw failure("Cloud returned a different workspace.");
    if (workspace && (workspace.id !== row.id || workspace.generation !== row.generation)) {
      throw failure("This Cloud workspace was replaced. Close and reopen this project; your unsaved draft is preserved.");
    }
    if (row.state !== "running") throw failure("This Cloud workspace is unavailable. Retry to resume it.");
    workspace = { ...row }; return workspace;
  };
  async function waitForReady(initial: OpeningResult, progress: Opening["progress"]) {
    let result = initial;
    let row = result.workspace;
    const deadline = Math.min(Date.now() + 620_000,
      row.operation?.pending && row.operation.deadline ? Date.parse(row.operation.deadline) : Infinity);
    while (true) {
      assertCurrent();
      if (!row || row.project_id !== context.projectId || !row.id || !row.generation) {
        throw failure("Cloud returned a different workspace.");
      }
      if (row.operation?.error) {
        throw failure("This workspace could not be opened.", 503, row.operation.error, row.operation.retryable);
      }
      if (row.state === "running" && !row.operation?.pending) return result;
      if (["retained", "cleanup_pending"].includes(row.state)) {
        throw failure("This workspace needs recovery.", 409, "workbench_requires_recovery", false);
      }
      progress.set(cloudWorkspaceOpeningPhase(row.operation));
      if (!Number.isFinite(deadline) || Date.now() >= deadline) {
        throw failure("This workspace did not become ready in time.", 504, "workbench_start_timeout");
      }
      const started = Date.now();
      const next = await request<{workspace: CloudWorkbench | null; entries?: WorkspaceEntry[]}>("?wait_seconds=20");
      if (!next.workspace) throw failure("This workspace is unavailable.", 404);
      if (next.workspace.id !== row.id || next.workspace.generation !== row.generation) throw failure("This workspace was replaced. Close and reopen the project.");
      row = next.workspace;
      result = { ...next, workspace: row };
      await paceStatusObservation(row, started);
    }
  }
  async function prepare(force = false) {
    openingProgress.set("checking");
    let pending = openings.get(identity);
    if (!pending) {
      const progress = createCloudWorkspaceOpeningProgress();
      const result = (async () => {
        const status = await request<{workspace: CloudWorkbench | null; entries?: WorkspaceEntry[]}>("");
        assertCurrent();
        if (status.workspace && ["retained", "cleanup_pending"].includes(status.workspace.state)) {
          throw failure("This workspace needs recovery.", 409, "workbench_requires_recovery", false);
        }
        // A user opening is the only wake request. Polling never creates or
        // resumes compute, including when a pending pause needs to finish first.
        // A subsequent file request proves actual readiness for running hosts.
        if (!force && status.workspace?.state === "running"
          && !status.workspace.operation?.pending && !status.workspace.operation?.error) return { ...status, workspace: status.workspace };
        // The server waits through startup and connection in one request.
        progress.set("connecting");
        return waitForReady({ workspace: await request<CloudWorkbench>("", { method: "POST" }) }, progress);
      })();
      pending = { result, progress };
      openings.set(identity, pending);
      void result.finally(() => { if (openings.get(identity) === pending) openings.delete(identity); }).catch(() => {});
    }
    // Coalesced clients observe the same opening without issuing another request.
    const progress = pending.progress;
    const update = () => openingProgress.set(progress.getSnapshot());
    const unsubscribe = progress.subscribe(update);
    update();
    try {
      const result = await pending.result; assertCurrent();
      const row = accept(result.workspace);
      if (result.entries) openingRoot = { entries: result.entries.map(entry => map(entry, "")), expiresAt: Date.now() + 5_000 };
      return row;
    } finally { unsubscribe(); }
  }
  async function ensure() {
    assertCurrent();
    if (workspace) return workspace;
    const handoff = inspectCloudWorkspaceHandoff(prepared, identity);
    if (handoff) return accept(handoff.workspace);
    if (!preparing) preparing = prepare().finally(() => { preparing = null; });
    return preparing;
  }
  async function query(path: string) {
    const row = await ensure();
    return new URLSearchParams({ generation: row.generation, path });
  }
  const version = (revision: string) => {
    const row = workspace!;
    const value = `cloud-workspace:${JSON.stringify({ workspace: row.id, generation: row.generation, revision })}`;
    parseWorkspaceVersion(value); return value;
  };
  const map = (entry: WorkspaceEntry, parent: string): CloudEntry => {
    if (!entry || !entry.name || /[/\\\0]/.test(entry.name) || [".", "..", ".git"].includes(entry.name)) throw failure("Invalid workspace directory entry.");
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    return { path, name: entry.name, type: entry.kind === "directory" ? "folder" : getFileSemanticKind(path), size_bytes: entry.size };
  };
  const invalidate = () => { cacheEpoch++; prepared = undefined; openingRoot = undefined; directories.clear(); reads.clear(); listings.clear(); };
  async function list(path: string) {
    assertCurrent();
    if (!path && prepared) {
      const handoff = takeCloudWorkspaceHandoff(prepared, identity);
      prepared = undefined;
      if (handoff) {
        accept(handoff.workspace);
        directories.set(path, handoff.root);
        return handoff.root;
      }
    }
    const cached = directories.get(path);
    if (activeSubscriptions > 0 && cached) return cached;
    let pending = listings.get(path);
    if (!pending) {
      const epoch = cacheEpoch;
      pending = (async () => {
        if (!path) {
          await ensure();
          assertCurrent();
          const root = openingRoot;
          openingRoot = undefined;
          if (root && Date.now() < root.expiresAt) {
            const value = { entries: root.entries };
            if (epoch === cacheEpoch) directories.set(path, value);
            return value;
          }
        }
        const parameters = await query(path);
        if (!path) openingProgress.set("files");
        const result = await request<{entries: WorkspaceEntry[]}>(`/files?${parameters}`);
        const value = { entries: result.entries.map(entry => map(entry, path)) };
        if (epoch === cacheEpoch) {
          directories.set(path, value);
          if (directories.size > 128) directories.delete(directories.keys().next().value!);
        }
        return value;
      })();
      listings.set(path, pending);
      void pending.finally(() => { if (listings.get(path) === pending) listings.delete(path); }).catch(() => {});
    }
    const value = await pending; assertCurrent(); return value;
  }
  async function stat(path: string): Promise<CloudEntry> {
    if (!path) { await ensure(); return { path, name: context.projectName ?? context.projectId, type: "folder", exists: true }; }
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const value = (await list(parent)).entries.find(entry => entry.path === path);
    if (!value) throw failure("Cloud file not found.", 404);
    return value;
  }
  async function read(path: string) {
    let pending = reads.get(path);
    if (!pending) {
      pending = (async () => request<FileReply>(`/file?${await query(path)}`))();
      reads.set(path, pending);
      void pending.finally(() => { if (reads.get(path) === pending) reads.delete(path); }).catch(() => {});
    }
    const result = await pending; assertCurrent();
    const bytes = decodeWorkspaceBytes(result.content_base64);
    if (result.name !== path.split("/").at(-1) || result.size !== bytes.length) throw failure("Cloud returned a different file.");
    return { bytes, version: version(result.revision), entry: { ...map(result, path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""), path } };
  }
  async function write(path: string, content: string, baseline: string | null) {
    const row = await ensure();
    const base = baseline === null ? null : parseWorkspaceVersion(baseline);
    if (base && (base.workspace !== row.id || base.generation !== row.generation)) throw failure("The file belongs to a different workspace generation. Reload before saving.");
    const result = await request<{revision: string}>(`/file?${await query(path)}`, { method: "PUT",
      body: JSON.stringify({ path, content_base64: encodeWorkspaceBytes(new TextEncoder().encode(content)), expected_revision: base?.revision ?? null }) });
    invalidate(); return { path, version: version(result.revision) };
  }
  async function change(action: "mkdir" | "move" | "remove", path: string, destination?: string) {
    await request(`/files?${await query(path)}`, { method: "POST", body: JSON.stringify({ action, path, ...(destination ? { destination } : {}) }) });
    invalidate();
  }
  function watch(onChange: () => void, onError: (error: Error) => void) {
    const bridge = window.puppyoneDesktop;
    let stopped = false;
    const id = crypto.randomUUID();
    let off: (() => void) | undefined;
    let subscribed = false;
    const release = () => { if (subscribed) { subscribed = false; activeSubscriptions--; invalidate(); } };
    const failed = (error: unknown) => { release(); if (!stopped) onError(error instanceof Error ? error : new Error(String(error))); };
    void ensure().then(async row => {
      if (stopped) return;
      if (!bridge?.watchCloudWorkspace || !bridge.onCloudWorkspaceEvent) throw new Error("Cloud file notifications are unavailable. Restart the desktop app.");
      off = bridge.onCloudWorkspaceEvent(event => {
        if (stopped || event.id !== id) return;
        try {
          assertCurrent();
          if (event.type === "change" && event.generation === row.generation) { invalidate(); onChange(); }
          else if (event.type === "reconnecting") { invalidate(); }
          else if (event.type === "unavailable") failed(new Error(event.message || "Cloud workspace connection interrupted. Retry to reconnect."));
        } catch (error) { failed(error); }
      });
      subscribed = true; activeSubscriptions++;
      await bridge.watchCloudWorkspace({ id, apiBaseUrl, projectId: context.projectId, generation: row.generation,
        expectedSession: { userId: session.user_id, generation: session.session_generation } });
      if (stopped) await bridge.stopCloudWorkspaceWatch({ id });
    }).catch(failed);
    return () => { stopped = true; release(); off?.(); void bridge?.stopCloudWorkspaceWatch?.({ id }).catch(() => {}); };
  }
  return { ensure, list, stat, read, write, change, invalidate, watch, openingProgress,
    handoff: (): CloudWorkspaceHandoff | undefined => {
      assertCurrent();
      const root = directories.get("");
      if (!workspace || !root) return undefined;
      const epoch = cacheEpoch;
      return { identity, workspace, root, expiresAt: Date.now() + 5_000,
        isValid: () => epoch === cacheEpoch };
    },
    peekDirectory: (path: string) => directories.get(path),
    resume: async () => { const row = await prepare(true); invalidate(); return row; },
    readText: async (path: string) => { const result = await read(path); return { ...result, content: new TextDecoder("utf-8", { fatal: true }).decode(result.bytes) }; },
  };
}
