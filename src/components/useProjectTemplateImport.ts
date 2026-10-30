import { useCallback, useEffect, useRef, useState } from "react";
import { useCloudAuthController } from "../features/cloud/hooks/useCloudAuthController";
import { getDesktopCloudApiBaseUrl } from "../lib/cloudApi";
import { readDesktopCloudAuthState, onDesktopCloudAuthStateChanged } from "../lib/cloudSession";
import type { MarketplaceTemplateDetail, WorkspaceCreateProjectRequest } from "../types/electron";

/**
 * Turns one template link into what the card shows. A public template needs no
 * account, so the account is read only for a template that says it needs one.
 */
export function useProjectTemplateImport(url: string, locale: string) {
  const [template, setTemplate] = useState<MarketplaceTemplateDetail | null>(null);
  const [resolving, setResolving] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const auth = useCloudAuthController({ cloudApiBaseUrl: optionalCloudApiBaseUrl() });
  const needsAccount = template?.requiresSignIn === true;

  useEffect(() => {
    if (!needsAccount) return undefined;
    let active = true;
    const sync = (state: Awaited<ReturnType<typeof readDesktopCloudAuthState>>) => {
      if (active) setSignedIn(Boolean(state.session && ["authenticated", "offline-authenticated", "refreshing"].includes(state.status)));
    };
    void readDesktopCloudAuthState().then(sync).catch(() => {});
    const unsubscribe = onDesktopCloudAuthStateChanged(sync);
    return () => { active = false; unsubscribe(); };
  }, [needsAccount]);

  const resolve = useCallback(async () => {
    const current = ++generation.current;
    setResolving(true); setError(null); setTemplate(null);
    try {
      const detail = await window.puppyoneDesktop?.resolveTemplateLink({ url, locale });
      if (detail && current === generation.current) setTemplate(detail);
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (current === generation.current) setResolving(false); }
  }, [locale, url]);

  useEffect(() => {
    void resolve();
    const requestGeneration = generation;
    return () => { requestGeneration.current++; };
  }, [resolve]);

  const source: WorkspaceCreateProjectRequest["source"] | null = template
    ? { kind: "template", ref: { sourceId: "marketplace", id: template.id, releaseId: template.releaseId } }
    : null;
  return { template, resolving, needsSignIn: needsAccount && !signedIn, error, retry: resolve, auth, source };
}

function optionalCloudApiBaseUrl() {
  // A public template stays available without Cloud configuration. The existing
  // sign-in controller reports missing configuration on user action.
  try { return getDesktopCloudApiBaseUrl(); } catch { return null; }
}
