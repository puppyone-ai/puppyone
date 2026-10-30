import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { abortSync, finishSync, publishWorkspace, syncWorkspace, type WorkspaceSync } from "./workspaceGit";

export type HandoffNotice = "current" | "broughtIn" | "updated" | "noChanges" | "behind" | "undone"
  | "busy" | "stopped" | "failed" | "unresolved";
export type WorkspaceHandoff = Readonly<{
  pending: boolean;
  notice: HandoffNotice | null;
  /** Files changed on both sides, waiting for a person. */
  waiting: readonly string[];
  bringIn: (sourceRef: string | null) => Promise<void>;
  finish: () => Promise<void>;
  undo: () => Promise<void>;
  update: () => Promise<void>;
}>;

function refusal(error: unknown): HandoffNotice {
  const { code } = error as { code?: string };
  if (code === "workspace_busy") return "busy";
  if (code === "workbench_not_running") return "stopped";
  return "failed";
}

/** Work moves between machines only as branches; this is the person's side of that. */
export function useWorkspaceHandoff({ session, projectId, apiBaseUrl }: {
  session: DesktopCloudSession; projectId: string; apiBaseUrl: string;
}): WorkspaceHandoff {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<HandoffNotice | null>(null);
  const [waiting, setWaiting] = useState<readonly string[]>([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const attempt = useCallback(async (work: () => Promise<void>) => {
    setPending(true);
    setNotice(null);
    try { await work(); }
    catch (error) { if (mounted.current) setNotice(refusal(error)); }
    finally { if (mounted.current) setPending(false); }
  }, []);
  const settle = useCallback((result: WorkspaceSync, done: HandoffNotice) => {
    if (!mounted.current) return;
    setWaiting(result.status === "conflict" ? result.paths ?? [] : []);
    if (result.status !== "conflict") setNotice(result.status === "up_to_date" ? "current" : done);
  }, []);

  const bringIn = useCallback((sourceRef: string | null) => attempt(async () => {
    settle(await syncWorkspace(session, projectId, sourceRef, apiBaseUrl), "broughtIn");
  }), [apiBaseUrl, attempt, projectId, session, settle]);
  const finish = useCallback(() => attempt(async () => {
    const result = await finishSync(session, projectId, apiBaseUrl);
    settle(result, "broughtIn");
    if (result.status === "conflict" && mounted.current) setNotice("unresolved");
  }), [apiBaseUrl, attempt, projectId, session, settle]);
  const undo = useCallback(() => attempt(async () => {
    settle(await abortSync(session, projectId, apiBaseUrl), "undone");
  }), [apiBaseUrl, attempt, projectId, session, settle]);
  const update = useCallback(() => attempt(async () => {
    const { status } = await publishWorkspace(session, projectId, apiBaseUrl);
    if (!mounted.current) return;
    if (status === "published") setNotice("updated");
    else if (status === "no_changes") setNotice("noChanges");
    else if (status === "rejected") setNotice("behind");
    else if (status === "merging") setNotice("unresolved");
    else setNotice("failed");
  }), [apiBaseUrl, attempt, projectId, session]);

  return { pending, notice, waiting, bringIn, finish, undo, update };
}
