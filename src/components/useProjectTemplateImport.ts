import { useCallback, useEffect, useRef, useState } from "react";
import { useCloudAuthController } from "../features/cloud/hooks/useCloudAuthController";
import { getDesktopCloudApiBaseUrl } from "../lib/cloudApi";
import { readDesktopCloudAuthState, onDesktopCloudAuthStateChanged } from "../lib/cloudSession";
import type { MarketplaceTemplateDetail, WorkspaceCreateProjectRequest } from "../types/electron";

export function useProjectTemplateImport(initialUrl: string | null, locale: string, onResolved: (detail: MarketplaceTemplateDetail) => void) {
  const [mode, setMode] = useState(Boolean(initialUrl));
  const [url, setUrl] = useState(initialUrl || "");
  const [template, setTemplate] = useState<MarketplaceTemplateDetail | null>(null);
  const [resolving, setResolving] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const resolvedCallback = useRef(onResolved);
  resolvedCallback.current = onResolved;
  const auth = useCloudAuthController({ cloudApiBaseUrl: optionalCloudApiBaseUrl() });

  useEffect(() => {
    let active = true;
    const sync = (state: Awaited<ReturnType<typeof readDesktopCloudAuthState>>) => {
      if (active) setSignedIn(Boolean(state.session && ["authenticated", "offline-authenticated", "refreshing"].includes(state.status)));
    };
    void readDesktopCloudAuthState().then(sync).catch(() => {});
    const unsubscribe = onDesktopCloudAuthStateChanged(sync);
    return () => { active = false; unsubscribe(); };
  }, []);

  const resolve = useCallback(async (value: string) => {
    const current = ++generation.current;
    setResolving(true); setError(null); setTemplate(null);
    try {
      const detail = await window.puppyoneDesktop?.resolveTemplateLink({ url: value, locale });
      if (detail && current === generation.current) { setTemplate(detail); resolvedCallback.current(detail); }
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (current === generation.current) setResolving(false); }
  }, [locale]);

  useEffect(() => {
    if (initialUrl) { setMode(true); setUrl(initialUrl); void resolve(initialUrl); }
    const requestGeneration = generation;
    return () => { requestGeneration.current++; };
  }, [initialUrl, resolve]);

  const source: WorkspaceCreateProjectRequest["source"] = mode && template
    ? { kind: "template", ref: { sourceId: "marketplace", id: template.id, releaseId: template.releaseId } }
    : { kind: "template", ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 1 } };
  return { mode, setMode, url, setUrl, template, setTemplate, resolving, signedIn, error, setError, resolve, auth, source, canCreate: !mode || Boolean(template && signedIn) };
}

export type ProjectTemplateImportController = ReturnType<typeof useProjectTemplateImport>;

function optionalCloudApiBaseUrl() {
  // Creating an ordinary local project remains available without Cloud configuration.
  // The existing sign-in controller reports missing configuration on user action.
  try { return getDesktopCloudApiBaseUrl(); } catch { return null; }
}
