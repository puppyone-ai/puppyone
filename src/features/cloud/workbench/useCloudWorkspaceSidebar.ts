import { useCallback, useEffect, useState } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { useCloudAgentWorkspace } from "../agent/useCloudAgentWorkspace";
import type { ProjectCloudContext } from "../project/context";

/** The two Cloud surfaces share one auxiliary pane; closing it never stops a run. */
export function useCloudWorkspaceSidebar({ context, session, apiBaseUrl, active, agent }: {
  context: ProjectCloudContext | null;
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  active: boolean;
  agent: Pick<ReturnType<typeof useCloudAgentWorkspace>, "open" | "setOpen">;
}) {
  const scope = active && session && context?.status === "resolved"
    ? JSON.stringify([apiBaseUrl, session.user_id, session.session_generation, context.target]) : null;
  const [historyScope, setHistoryScope] = useState<string | null>(null);
  const historyOpen = scope !== null && historyScope === scope;
  const setAgentOpen = agent.setOpen;
  useEffect(() => { setHistoryScope(null); }, [scope]);
  const close = useCallback(() => {
    setHistoryScope(null);
    setAgentOpen?.(false);
  }, [setAgentOpen]);
  const toggleHistory = useCallback(() => {
    if (!scope || context?.status !== "resolved" || context.target.kind !== "project_root") return;
    setAgentOpen?.(false);
    setHistoryScope(current => current === scope ? null : scope);
  }, [context, scope, setAgentOpen]);
  const toggleAgent = useCallback(() => {
    if (!scope) return;
    setHistoryScope(null);
    setAgentOpen?.(!agent.open);
  }, [agent.open, scope, setAgentOpen]);
  const setOpen = useCallback((open: boolean) => {
    if (!open) close();
  }, [close]);
  return { scope, historyOpen, open: Boolean(scope && (historyOpen || agent.open)), close, setOpen, toggleHistory, toggleAgent };
}

export type CloudWorkspaceSidebarController = ReturnType<typeof useCloudWorkspaceSidebar>;
