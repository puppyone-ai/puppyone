import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  getCloudRepositoryContext, type DesktopCloudSession,
} from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import type { RepositoryTarget } from "../repositoryTarget";
import { createCloudDataService } from "../files/cloudDataPort";
import type { CloudWorkspaceHandoff } from "../files/cloudWorkspaceHandoff";
import type { CloudWorkspaceOpeningProgress } from "../files/cloudWorkspaceOpening";
import { CloudOpeningError, describeCloudOpeningFailure, type CloudOpeningFailure } from "../cloudOpeningFailure";

type ResolvedContext = Extract<ProjectCloudContext, { status: "resolved" }>;
type Selection = { authority: string; context: ResolvedContext; prepared?: CloudWorkspaceHandoff };
/** What the pending open has learned so far; it never grants the project surface. */
type Preparation = { projectName: string; progress?: CloudWorkspaceOpeningProgress };
const LOCAL: ProjectCloudContext = { status: "local-only", projectId: null };

/** Hosted selection only. Homepage listing and Header association own separate navigation surfaces. */
export function useAccountCloudWorkspace({ enabled, session, apiBaseUrl, shown, onShow }: {
  enabled: boolean;
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  /** Which project the window shows, which the window owns. */
  shown: "local" | "cloud";
  onShow: (location: "local" | "cloud") => void;
}) {
  const authority = enabled && session
    ? JSON.stringify([apiBaseUrl, session.user_id, session.session_generation]) : null;
  const current = useRef({ authority, session, enabled, onShow });
  current.current = { authority, session, enabled, onShow };
  const requestId = useRef(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [openingTarget, setOpeningTarget] = useState<RepositoryTarget | null>(null);
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [failure, setFailure] = useState<CloudOpeningFailure | null>(null);
  const error = failure ? "open" as const : null;
  const lastAttempt = useRef<RepositoryTarget | null>(null);
  const context = authority && selection?.authority === authority ? selection.context : LOCAL;
  const active = enabled && shown === "cloud" && context.status === "resolved";

  useEffect(() => () => { requestId.current++; }, []);
  useEffect(() => {
    // Revoke pending UI work on sign-out, account changes and environment changes.
    requestId.current++;
    setOpeningTarget(null);
    setPreparation(null);
    setFailure(null);
    setSelection(null);
    lastAttempt.current = null;
    current.current.onShow("local");
  }, [authority]);

  const cancel = useCallback(() => {
    requestId.current++;
    lastAttempt.current = null;
    setOpeningTarget(null);
    setPreparation(null);
    setFailure(null);
  }, []);
  const openTarget = useCallback(async (target: RepositoryTarget, canCommit: () => boolean = () => true, reportFailure = false) => {
    const captured = current.current;
    const { authority: capturedAuthority, session: capturedSession } = captured;
    if (!capturedAuthority || !capturedSession) return;
    lastAttempt.current = target;
    const id = ++requestId.current;
    const isCurrent = () => requestId.current === id && current.current.authority === captured.authority && canCommit();
    setOpeningTarget(target);
    setPreparation(null);
    setFailure(null);
    const attempt = async () => {
      let stage: "project" | "workspace" = "project";
      try {
        const result = await getCloudRepositoryContext(capturedSession, target.project_id, target, undefined, apiBaseUrl);
        if (!isCurrent()) return null;
        if (result.project.id !== target.project_id || result.target.project_id !== target.project_id
          || result.target.kind !== target.kind
          || (target.kind === "scope" && (result.target.kind !== "scope" || result.target.scope_id !== target.scope_id))) {
          throw Object.assign(new Error("Cloud returned a different repository target."), { code: "repository_target_mismatch" });
        }
        const resolved: ResolvedContext = { status: "resolved", projectId: result.project.id,
          projectName: result.project.name, target: result.target, scopePath: result.scope_path,
          capabilities: result.project.capabilities ?? [] };
        stage = "workspace";
        const provider = createCloudDataService({ context: resolved, session: capturedSession, apiBaseUrl, isCurrent });
        setPreparation({ projectName: resolved.projectName || resolved.projectId, progress: provider.openingProgress });
        await provider.dataPort.listChildren(null);
        if (!isCurrent()) return null;
        // The window renders what it shows at once, so the project must be here first.
        const selection = { authority: capturedAuthority, context: resolved, prepared: provider.handoff?.() };
        flushSync(() => setSelection(selection));
        current.current.onShow("cloud");
        return null;
      } catch (cause) {
        return describeCloudOpeningFailure(cause, stage);
      }
    };
    try {
      let openingFailure = await attempt();
      // A workspace that moved while opening (replaced, paused, fenced, or its
      // authorization revision changed) is opened again once before the user
      // hears about it; a second move is reported.
      if (openingFailure?.reopen && isCurrent()) openingFailure = await attempt();
      if (openingFailure && isCurrent()) {
        setFailure(openingFailure);
        if (reportFailure) throw new CloudOpeningError(openingFailure);
      }
    } finally { if (requestId.current === id) { setOpeningTarget(null); setPreparation(null); } }
  }, [apiBaseUrl]);
  const useLocal = useCallback(() => { cancel(); current.current.onShow("local"); }, [cancel]);
  return {
    active, context, prepared: selection?.authority === authority ? selection?.prepared : undefined,
    openingTarget, opening: Boolean(openingTarget), preparation, error, failure,
    cancel, useLocal, openTarget,
    retry: () => { if (lastAttempt.current) return openTarget(lastAttempt.current); },
    /** The target `retry` would reopen, for a host that sends retries through its own navigation. */
    lastAttemptedTarget: () => lastAttempt.current,
  };
}
export type AccountCloudWorkspace = ReturnType<typeof useAccountCloudWorkspace>;
