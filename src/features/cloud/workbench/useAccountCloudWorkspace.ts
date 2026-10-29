import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCloudRepositoryContext, type DesktopCloudSession,
} from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import type { RepositoryTarget } from "../repositoryTarget";
import { createCloudDataService } from "../files/cloudDataPort";
import type { CloudWorkspaceHandoff } from "../files/cloudWorkspaceHandoff";
import { CloudOpeningError, describeCloudOpeningFailure, type CloudOpeningFailure } from "../cloudOpeningFailure";

type ResolvedContext = Extract<ProjectCloudContext, { status: "resolved" }>;
type Selection = { authority: string; context: ResolvedContext; prepared?: CloudWorkspaceHandoff };
const LOCAL: ProjectCloudContext = { status: "local-only", projectId: null };

/** Hosted selection only. Homepage listing and Header association own separate navigation surfaces. */
export function useAccountCloudWorkspace({ enabled, session, apiBaseUrl }: {
  enabled: boolean;
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
}) {
  const authority = enabled && session
    ? JSON.stringify([apiBaseUrl, session.user_id, session.session_generation]) : null;
  const current = useRef({ authority, session, enabled });
  current.current = { authority, session, enabled };
  const requestId = useRef(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [location, setLocation] = useState<"local" | "cloud">("local");
  const [openingTarget, setOpeningTarget] = useState<RepositoryTarget | null>(null);
  const [failure, setFailure] = useState<CloudOpeningFailure | null>(null);
  const error = failure ? "open" as const : null;
  const lastAttempt = useRef<RepositoryTarget | null>(null);
  const context = authority && selection?.authority === authority ? selection.context : LOCAL;
  const active = enabled && location === "cloud" && context.status === "resolved";

  useEffect(() => () => { requestId.current++; }, []);
  useEffect(() => {
    // Revoke pending UI work on sign-out, account changes and environment changes.
    requestId.current++;
    setOpeningTarget(null);
    setFailure(null);
    setSelection(null);
    lastAttempt.current = null;
    setLocation("local");
  }, [authority]);

  const cancel = useCallback(() => {
    requestId.current++;
    lastAttempt.current = null;
    setOpeningTarget(null);
    setFailure(null);
  }, []);
  const openTarget = useCallback(async (target: RepositoryTarget, canCommit: () => boolean = () => true, reportFailure = false) => {
    const captured = current.current;
    if (!captured.authority || !captured.session) return;
    lastAttempt.current = target;
    const id = ++requestId.current;
    const isCurrent = () => requestId.current === id && current.current.authority === captured.authority && canCommit();
    setOpeningTarget(target);
    setFailure(null);
    let stage: "project" | "workspace" = "project";
    try {
      const result = await getCloudRepositoryContext(captured.session, target.project_id, target, undefined, apiBaseUrl);
      if (!isCurrent()) return;
      if (result.project.id !== target.project_id || result.target.project_id !== target.project_id
        || result.target.kind !== target.kind
        || (target.kind === "scope" && (result.target.kind !== "scope" || result.target.scope_id !== target.scope_id))) {
        throw Object.assign(new Error("Cloud returned a different repository target."), { code: "repository_target_mismatch" });
      }
      const resolved: ResolvedContext = { status: "resolved", projectId: result.project.id,
        projectName: result.project.name, target: result.target, scopePath: result.scope_path,
        capabilities: result.project.capabilities ?? [] };
      stage = "workspace";
      const provider = createCloudDataService({ context: resolved, session: captured.session, apiBaseUrl, isCurrent });
      await provider.dataPort.listChildren(null);
      if (!isCurrent()) return;
      setSelection({ authority: captured.authority, context: resolved, prepared: provider.handoff?.() });
      setLocation("cloud");
    } catch (cause) {
      if (isCurrent()) {
        const openingFailure = describeCloudOpeningFailure(cause, stage);
        setFailure(openingFailure);
        if (reportFailure) throw new CloudOpeningError(openingFailure);
      }
    } finally { if (requestId.current === id) setOpeningTarget(null); }
  }, [apiBaseUrl]);
  const useLocal = useCallback(() => { cancel(); setLocation("local"); }, [cancel]);
  return {
    active, context, prepared: selection?.authority === authority ? selection?.prepared : undefined,
    openingTarget, opening: Boolean(openingTarget), error, failure,
    cancel, useLocal, openTarget,
    retry: () => { if (lastAttempt.current) return openTarget(lastAttempt.current); },
  };
}
export type AccountCloudWorkspace = ReturnType<typeof useAccountCloudWorkspace>;
