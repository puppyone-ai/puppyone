import { useEffect, useState } from "react";
import {
  isCloudSessionForApiBase,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import { restoreDesktopCloudSession } from "../../../lib/cloudSession";
import type { CloudEnvironment } from "../environment";
import type { CloudAuthState } from "./cloudAuthTypes";
import { resolveCloudAuthState } from "./resolveCloudAuthState";

export function useCloudSessionForEnvironment({
  cloudSession,
  sessionRestoring,
  environment,
  onCloudSessionChange,
}: {
  cloudSession: DesktopCloudSession | null;
  sessionRestoring: boolean;
  environment: CloudEnvironment;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
}): CloudAuthState {
  const [environmentSessionRestoring, setEnvironmentSessionRestoring] = useState(false);
  const effectiveSession = isCloudSessionForApiBase(cloudSession, environment.apiBaseUrl)
    ? cloudSession
    : null;

  useEffect(() => {
    if (!environment.apiBaseUrl || sessionRestoring || effectiveSession) {
      setEnvironmentSessionRestoring(false);
      return undefined;
    }

    let cancelled = false;
    setEnvironmentSessionRestoring(true);
    restoreDesktopCloudSession(environment.apiBaseUrl)
      .then((restoredSession) => {
        if (cancelled || !restoredSession) return;
        if (isCloudSessionForApiBase(restoredSession, environment.apiBaseUrl)) {
          onCloudSessionChange(restoredSession);
        }
      })
      .catch(() => {
        // The signed-out state lets the user authenticate against this workspace host.
      })
      .finally(() => {
        if (!cancelled) setEnvironmentSessionRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    effectiveSession,
    environment.apiBaseUrl,
    onCloudSessionChange,
    sessionRestoring,
  ]);

  return resolveCloudAuthState({
    cloudSession,
    sessionRestoring,
    environmentRestoring: environmentSessionRestoring,
    environment,
  });
}
