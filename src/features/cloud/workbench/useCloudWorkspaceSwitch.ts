import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { cloudMessage, type CloudMessageDescriptor } from "../cloudPresentation";
import type { NativeCloudDataService } from "../files/cloudDataPort";

type SwitchIntent = { scope: string; attempt: number };
type Preparation = { intent: SwitchIntent; service: NativeCloudDataService | null; error: CloudMessageDescriptor | null };

/** Prepare an authenticated provider before changing the visible workbench. */
export function useCloudWorkspaceSwitch({
  enabled, scope, session, service, providerError, initializationPending, onCommit,
}: {
  enabled: boolean;
  /** Current repository and API host; signing in never chooses another repository. */
  scope: string;
  session: DesktopCloudSession | null;
  service: NativeCloudDataService | null;
  providerError: string | null;
  initializationPending: boolean;
  onCommit: () => void;
}) {
  const [intent, setIntent] = useState<SwitchIntent | null>(null);
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const current = useRef({ enabled, scope, intent, session, service, initializationPending, onCommit });
  current.current = { enabled, scope, intent, session, service, initializationPending, onCommit };
  const cancel = useCallback(() => {
    // Revoke immediately, including a response arriving before the next render.
    current.current.intent = null;
    setIntent(null);
    setPreparation(null);
  }, []);
  const request = useCallback(() => {
    if (!enabled) return;
    const next = { scope, attempt: 0 };
    current.current.intent = next;
    setPreparation(null);
    setIntent(next);
  }, [enabled, scope]);
  const retry = useCallback(() => {
    setPreparation(null);
    setIntent((previous) => previous ? { ...previous, attempt: previous.attempt + 1 } : null);
  }, []);

  useEffect(() => {
    if (!intent) return;
    if (!enabled || intent.scope !== scope) { cancel(); return; }
    if (!session || initializationPending) { setPreparation(null); return; }
    if (!service) {
      setPreparation(providerError ? { intent, service, error: cloudMessage("remote-unresolvable") } : null);
      return;
    }
    let cancelled = false;
    setPreparation({ intent, service, error: null });
    const isCurrent = () => !cancelled && current.current.intent === intent
      && current.current.enabled && current.current.scope === intent.scope
      && current.current.service === service && current.current.session === session
      && !current.current.initializationPending;
    // A resolved project alone is insufficient: verify actual file access.
    const resume = intent.attempt > 0 ? service.resume?.() : undefined;
    void Promise.resolve(resume).then(() => service.dataPort.listChildren(null)).then(() => {
      if (!isCurrent()) return;
      current.current.onCommit();
      cancel();
    }, (cause: unknown) => {
      if (!isCurrent()) return;
      const status = cause && typeof cause === "object" && "status" in cause
        ? Number(cause.status) : null;
      // Project authorization has already succeeded. A missing file route or
      // unavailable workspace must not be presented as a missing Git project.
      setPreparation({ intent, service, error: cloudMessage(status === 401 ? "remote-sign-in"
        : status === 403 ? "remote-not-authorized" : "workspace-open-failed") });
    });
    return () => { cancelled = true; };
  }, [cancel, enabled, initializationPending, intent, onCommit, providerError, scope, service, session]);

  const pending = Boolean(enabled && intent?.scope === scope);
  const prepared = preparation?.intent === intent && preparation.service === service ? preparation : null;
  return { pending, requestedLocation: pending ? "cloud" as const : undefined,
    checking: Boolean(pending && session && service && !initializationPending && !prepared?.error),
    error: prepared?.error ?? null, request, cancel, retry };
}

export type CloudWorkspaceSwitch = ReturnType<typeof useCloudWorkspaceSwitch>;
