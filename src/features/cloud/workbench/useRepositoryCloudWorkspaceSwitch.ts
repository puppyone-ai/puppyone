import { useCallback, useMemo } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { createCloudDataService } from "../files/cloudDataPort";
import { useCloudWorkspaceSwitch } from "./useCloudWorkspaceSwitch";

type ResolvedContext = Extract<ProjectCloudContext, { status: "resolved" }>;

/** Header intent follows the current repository through sign-in and resolution;
 * it never enumerates projects or reuses an unrelated hosted selection. */
export function useRepositoryCloudWorkspaceSwitch({ enabled, scope, context, session, apiBaseUrl, onPrepared, initializationPending = false }: {
  enabled: boolean;
  scope: string;
  context: ProjectCloudContext;
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  onPrepared: (context: ResolvedContext, session: DesktopCloudSession) => void;
  initializationPending?: boolean;
}) {
  const { service, error } = useMemo(() => {
    if (context.status !== "resolved" || !session) return { service: null, error: null };
    try {
      return { service: createCloudDataService({ context, session, apiBaseUrl }), error: null };
    } catch (cause) {
      return { service: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [apiBaseUrl, context, session]);
  const onCommit = useCallback(() => {
    if (context.status === "resolved" && session) onPrepared(context, session);
  }, [context, onPrepared, session]);
  return useCloudWorkspaceSwitch({ enabled, scope: JSON.stringify([scope, apiBaseUrl]), session,
    service, providerError: error, initializationPending, onCommit });
}
