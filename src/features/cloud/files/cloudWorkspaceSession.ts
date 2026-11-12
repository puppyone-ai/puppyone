import { cloudApiRequest, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { cloudWorkspaceOpeningPhase, createCloudWorkspaceOpeningProgress } from "./cloudWorkspaceOpening";
import { cloudWorkspaceIdentity, inspectCloudWorkspaceHandoff, takeCloudWorkspaceHandoff, type CloudWorkspaceHandoff } from "./cloudWorkspaceHandoff";
import { workspaceFailure as failure, type WorkspaceEntry, type WorkspaceOpeningResult } from "./cloudWorkspaceProtocol";
import type { CloudEntry, CloudSandboxSettings, CloudScreenSession, CloudWorkbench } from "./contracts";
import { readCloudSandbox } from "../sandbox/cloudSandboxFeatures";
import { recordWorkspaceRequest } from "../../../performance/editingLatencyProbe";

type Opening = { result: Promise<WorkspaceOpeningResult>; progress: ReturnType<typeof createCloudWorkspaceOpeningProgress> };
const openings = new Map<string, Opening>();

async function paceStatusObservation(row: CloudWorkbench, started: number) {
  // Older servers may ignore wait_seconds. Rate-limit only fast, pending
  // replies; a long wait or a ready/error response needs no extra delay.
  if ((row.state === "running" && !row.operation?.pending) || row.operation?.error
    || ["retained", "cleanup_pending"].includes(row.state)) return;
  const pause = Math.max(0, 1_000 - (Date.now() - started));
  if (pause) await new Promise(resolve => setTimeout(resolve, pause));
}

export type CloudWorkspaceSession = ReturnType<typeof createCloudWorkspaceSession>;

/**
 * One pinned workbench: opening, readiness, authenticated requests and the
 * per-workspace controls. File bytes and their caches live in cloudWorkspaceFiles.
 */
export function createCloudWorkspaceSession({ session, context, apiBaseUrl, assertCurrent, prepared, onRequestFailed }: {
  session: DesktopCloudSession;
  context: Extract<ProjectCloudContext, { status: "resolved" }>;
  apiBaseUrl: string;
  assertCurrent: () => void;
  prepared?: CloudWorkspaceHandoff;
  /** Any failed request may mean stale bytes; the file layer drops its caches. */
  onRequestFailed: () => void;
}) {
  if (context.target.kind !== "project_root" || context.scopePath) throw failure("Live Cloud workspaces require access to the complete project.", 403);
  const endpoint = `/projects/${encodeURIComponent(context.projectId)}/workbench`;
  const identity = cloudWorkspaceIdentity(session, context, apiBaseUrl);
  let workspace: CloudWorkbench | null = null;
  let preparing: Promise<CloudWorkbench> | null = null;
  let handoff = prepared;
  let openingRoot: { entries: WorkspaceEntry[]; expiresAt: number } | undefined;
  const openingProgress = createCloudWorkspaceOpeningProgress();

  const request = async <T>(suffix: string, init: RequestInit = {}) => {
    assertCurrent();
    const started = performance.now();
    try {
      const value = await cloudApiRequest<T>(endpoint + suffix, session, undefined, init, apiBaseUrl);
      assertCurrent(); return value;
    } catch (error) {
      onRequestFailed();
      throw error;
    } finally {
      recordWorkspaceRequest(init.method ?? "GET", suffix, performance.now() - started);
    }
  };
  const accept = (row: CloudWorkbench) => {
    if (!row || row.project_id !== context.projectId || !row.id || !row.generation || typeof row.state !== "string") throw failure("Cloud returned a different workspace.");
    if (workspace && (workspace.id !== row.id || workspace.generation !== row.generation)) {
      throw failure("This Cloud workspace was replaced. Close and reopen this project; your unsaved draft is preserved.",
        409, "workbench_generation_changed");
    }
    if (row.state !== "running") throw failure("This Cloud workspace is unavailable. Retry to resume it.", 409, "workbench_not_running");
    workspace = { ...row }; return workspace;
  };
  async function waitForReady(initial: WorkspaceOpeningResult, progress: Opening["progress"]) {
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
      if (next.workspace.id !== row.id || next.workspace.generation !== row.generation) {
        throw failure("This workspace was replaced. Close and reopen the project.", 409, "workbench_generation_changed");
      }
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
      if (result.entries) openingRoot = { entries: result.entries, expiresAt: Date.now() + 5_000 };
      return row;
    } finally { unsubscribe(); }
  }
  async function ensure() {
    assertCurrent();
    if (workspace) return workspace;
    const value = inspectCloudWorkspaceHandoff(handoff, identity);
    if (value) return accept(value.workspace);
    if (!preparing) preparing = prepare().finally(() => { preparing = null; });
    return preparing;
  }

  return {
    identity,
    endpoint,
    request,
    ensure,
    openingProgress,
    current: () => workspace,
    /** The handed-off root listing, consumed once by the first root read. */
    takePreparedRoot: (): { entries: CloudEntry[] } | null => {
      if (!handoff) return null;
      const value = takeCloudWorkspaceHandoff(handoff, identity);
      handoff = undefined;
      if (!value) return null;
      accept(value.workspace);
      return value.root;
    },
    hasPreparedRoot: () => Boolean(handoff),
    /** Root entries returned by the opening request, valid for a few seconds. */
    takeOpeningRoot: (): WorkspaceEntry[] | null => {
      const root = openingRoot;
      openingRoot = undefined;
      return root && Date.now() < root.expiresAt ? root.entries : null;
    },
    forgetOpening: () => { handoff = undefined; openingRoot = undefined; },
    resume: () => prepare(true),
    /** Sandbox Profile and Features of the last accepted workspace row. */
    sandbox: () => readCloudSandbox(workspace?.sandbox),
    /** Store the owner's choices; returns the resolved sandbox view. */
    setSandboxSettings: async (settings: CloudSandboxSettings) => {
      const value = await request<unknown>("/sandbox", { method: "PUT", body: JSON.stringify(settings),
        headers: { "Content-Type": "application/json" } });
      const sandbox = readCloudSandbox(value);
      if (workspace) workspace = { ...workspace, sandbox };
      return sandbox;
    },
    /** A one-time ticket for the screen WebSocket; the session token never leaves the main process. */
    screenSession: async (): Promise<CloudScreenSession> => {
      const value = await request<{ ticket: string; protocol: string; ticket_protocol_prefix: string;
        transport: string }>("/screen/session", { method: "POST" });
      const url = new URL(`${apiBaseUrl.replace(/\/+$/, "")}${endpoint}/screen/stream`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return { url: url.toString(), transport: value.transport,
        protocols: [value.protocol, value.ticket_protocol_prefix + value.ticket] };
    },
  };
}
