import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCloudProject, getCloudRepositoryContext, listCloudOrganizations, listCloudProjects,
  type DesktopCloudOrganization, type DesktopCloudProject, type DesktopCloudSession,
} from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import type { RepositoryTarget } from "../repositoryTarget";
import { createCloudDataService } from "./cloudDataPort";

type ResolvedContext = Extract<ProjectCloudContext, { status: "resolved" }>;
type Selection = { authority: string; context: ResolvedContext };
type Catalog = { authority: string; projects: DesktopCloudProject[]; organizations: DesktopCloudOrganization[] };
const LOCAL: ProjectCloudContext = { status: "local-only", projectId: null };

/** Homepage catalog and hosted selection. Header association owns a separate direct-switch intent. */
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<"list" | "open" | "create" | null>(null);
  const [reload, setReload] = useState(0);
  const createAttempts = useRef(new Map<string, string>());
  const lastAttempt = useRef<{ kind: "open"; target: RepositoryTarget } | { kind: "create"; orgId: string; name: string } | null>(null);
  const context = authority && selection?.authority === authority ? selection.context : LOCAL;
  const active = enabled && location === "cloud" && context.status === "resolved";

  useEffect(() => {
    // Revoke pending UI work on sign-out, account changes and environment changes.
    requestId.current++;
    setOpening(false);
    setLoading(false);
    setError(null);
    setCatalog(null);
    setSelection(null);
    lastAttempt.current = null;
    setLocation("local");
    createAttempts.current.clear();
  }, [authority]);

  useEffect(() => {
    if (!enabled) { setPickerOpen(false); return; }
    if (!pickerOpen || !authority || !session) return;
    let cancelled = false;
    setLoading(true);
    // Listing starts when a direct open reveals the picker. Do not erase a
    // failed open/create just because the background catalog finishes later.
    setError((previous) => previous === "list" ? null : previous);
    // Organization discovery is for the explicit create action; its failure
    // must not hide an otherwise accessible project catalog.
    void Promise.all([
      listCloudProjects(session, apiBaseUrl),
      listCloudOrganizations(session, undefined, apiBaseUrl).catch(() => []),
    ]).then(([projects, organizations]) => {
      if (!cancelled && current.current.authority === authority) setCatalog({ authority, projects, organizations });
    }, () => {
      if (!cancelled && current.current.authority === authority) setError("list");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Session refresh snapshots do not change account authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, authority, enabled, pickerOpen, reload]);

  const cancel = useCallback(() => {
    requestId.current++;
    lastAttempt.current = null;
    setPickerOpen(false);
    setOpening(false);
    setError(null);
  }, []);
  const browse = useCallback(() => {
    if (!current.current.enabled) return;
    requestId.current++;
    lastAttempt.current = null;
    setOpening(false);
    setError(null);
    setPickerOpen(true);
  }, []);
  const openTarget = useCallback(async (target: RepositoryTarget) => {
    const captured = current.current;
    if (!captured.authority || !captured.session) { browse(); return; }
    lastAttempt.current = { kind: "open", target };
    const id = ++requestId.current;
    const isCurrent = () => requestId.current === id && current.current.authority === captured.authority;
    setPickerOpen(true);
    setOpening(true);
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
      setPickerOpen(false);
    } catch {
      if (isCurrent()) setError("open");
    } finally { if (isCurrent()) setOpening(false); }
  }, [apiBaseUrl, browse]);
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
  }, [cancel]);
  const useLocal = useCallback(() => { cancel(); setLocation("local"); }, [cancel]);
  const create = useCallback(async (orgId: string, name: string) => {
    const captured = current.current;
    if (!captured.session || !captured.authority || !orgId || !name.trim()) return;
    lastAttempt.current = { kind: "create", orgId, name };
    const id = ++requestId.current;
    const isCurrent = () => requestId.current === id && current.current.authority === captured.authority;
    const input = { org_id: orgId, name: name.trim() };
    const key = JSON.stringify([captured.authority, input]);
    const operationId = createAttempts.current.get(key) ?? crypto.randomUUID();
    createAttempts.current.set(key, operationId);
    setOpening(true);
    setError(null);
    try {
      const project = await createCloudProject(captured.session, input, operationId, apiBaseUrl);
      if (!isCurrent()) return;
      setReload((value) => value + 1);
      // Keep the key on an ambiguous response/retry; opening never publishes local bytes.
      await openTarget({ kind: "project_root", project_id: project.id });
    } catch { if (isCurrent()) setError("create"); }
    finally { if (isCurrent()) setOpening(false); }
  }, [apiBaseUrl, openTarget]);
  return {
    active, context, pickerOpen: enabled && pickerOpen, loading, opening, error,
    projects: authority && catalog?.authority === authority ? catalog.projects : [],
    organizations: authority && catalog?.authority === authority ? catalog.organizations : [],
    browse, cancel, useLocal, openTarget, activatePrepared, create,
    retry: () => {
      const attempt = lastAttempt.current;
      if (error === "open" && attempt?.kind === "open") return openTarget(attempt.target);
      if (error === "create" && attempt?.kind === "create") return create(attempt.orgId, attempt.name);
      setReload((value) => value + 1);
    },
    refresh: () => setReload((value) => value + 1),
  };
}
export type AccountCloudWorkspace = ReturnType<typeof useAccountCloudWorkspace>;
