import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCloudRepositoryContext, type DesktopCloudSession,
} from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import type { RepositoryTarget } from "../repositoryTarget";
import { createCloudDataService } from "./cloudDataPort";
import { rememberCloudProjectOpen } from "./homepageCloudHistory";

type ResolvedContext = Extract<ProjectCloudContext, { status: "resolved" }>;
type Selection = { authority: string; context: ResolvedContext };
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
  const [error, setError] = useState<"open" | null>(null);
  const lastAttempt = useRef<RepositoryTarget | null>(null);
  const context = authority && selection?.authority === authority ? selection.context : LOCAL;
  const active = enabled && location === "cloud" && context.status === "resolved";

  useEffect(() => () => { requestId.current++; }, []);
  useEffect(() => {
    // Revoke pending UI work on sign-out, account changes and environment changes.
    requestId.current++;
    setOpeningTarget(null);
    setError(null);
    setSelection(null);
    lastAttempt.current = null;
    setLocation("local");
  }, [authority]);

  const cancel = useCallback(() => {
    requestId.current++;
    lastAttempt.current = null;
    setOpeningTarget(null);
    setError(null);
  }, []);
  const openTarget = useCallback(async (target: RepositoryTarget) => {
    const captured = current.current;
    if (!captured.authority || !captured.session) return;
    lastAttempt.current = target;
    const id = ++requestId.current;
    const isCurrent = () => requestId.current === id && current.current.authority === captured.authority;
    setOpeningTarget(target);
    setError(null);
    try {
      const result = await getCloudRepositoryContext(captured.session, target.project_id, target, undefined, apiBaseUrl);
      if (!isCurrent()) return;
      if (result.project.id !== target.project_id || result.target.project_id !== target.project_id
        || result.target.kind !== target.kind
        || (target.kind === "scope" && (result.target.kind !== "scope" || result.target.scope_id !== target.scope_id))) {
        throw new Error("Cloud returned a different repository target.");
      }
      const resolved: ResolvedContext = { status: "resolved", projectId: result.project.id,
        projectName: result.project.name, target: result.target, scopePath: result.scope_path,
        capabilities: result.project.capabilities ?? [] };
      const provider = createCloudDataService({ context: resolved, session: captured.session, apiBaseUrl, isCurrent });
      await provider.dataPort.listChildren(null);
      if (!isCurrent()) return;
      setSelection({ authority: captured.authority, context: resolved });
      setLocation("cloud");
      rememberCloudProjectOpen(apiBaseUrl, captured.session.user_id, resolved.target);
    } catch {
      if (isCurrent()) setError("open");
    } finally { if (isCurrent()) setOpeningTarget(null); }
  }, [apiBaseUrl]);
  // The repository switch controller has already authorized this exact target
  // and read its root. Commit it without opening or fetching the account catalog.
  const activatePrepared = useCallback((resolved: ResolvedContext, expectedSession: DesktopCloudSession) => {
    const captured = current.current;
    if (!captured.authority || !captured.session
      || captured.session.user_id !== expectedSession.user_id
      || captured.session.session_generation !== expectedSession.session_generation
      || captured.session.api_base_url !== expectedSession.api_base_url) return;
    cancel();
    setSelection({ authority: captured.authority, context: resolved });
    setLocation("cloud");
    rememberCloudProjectOpen(apiBaseUrl, captured.session.user_id, resolved.target);
  }, [apiBaseUrl, cancel]);
  const useLocal = useCallback(() => { cancel(); setLocation("local"); }, [cancel]);
  return {
    active, context, openingTarget, opening: Boolean(openingTarget), error,
    cancel, useLocal, openTarget, activatePrepared,
    retry: () => { if (lastAttempt.current) return openTarget(lastAttempt.current); },
  };
}
export type AccountCloudWorkspace = ReturnType<typeof useAccountCloudWorkspace>;
