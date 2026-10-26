import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context";
import { repositoryTargetKey } from "../repositoryTarget";
import { type CloudAgentState } from "./CloudAgentController";
import { CloudAgentClient } from "./cloudAgentClient";
import { CloudAgentWorkbench } from "./CloudAgentWorkbench";

const EMPTY: CloudAgentState = { open: false, draft: "", loading: false, submitting: false, resolving: null,
  sessionId: null, agentId: null, pending: null, runs: [], sessions: [], error: null, reconnecting: false };
const subscribeEmpty = () => () => undefined;
const readEmpty = () => EMPTY;
const readNoWorkbench = () => null;

function workspaceIdentity(context: ProjectCloudContext | null, session: DesktopCloudSession | null, apiBaseUrl: string) {
  const target = context?.status === "resolved" ? context.target : null;
  const storageKey = JSON.stringify(["cloud-agent-v1", apiBaseUrl, session?.user_id,
    target?.project_id, target ? repositoryTargetKey(target) : null]);
  return { target, storageKey, key: JSON.stringify([storageKey, session?.session_generation]) };
}

function useWorkbenchWorking(workbench: CloudAgentWorkbench | null) {
  useSyncExternalStore(workbench?.store.subscribe ?? subscribeEmpty,
    workbench?.store.getSnapshot ?? readNoWorkbench, workbench?.store.getSnapshot ?? readNoWorkbench);
  return Boolean(workbench?.working);
}

export function useCloudAgentWorkspace({ context, session, apiBaseUrl, active, onPublication }: {
  context: ProjectCloudContext | null; session: DesktopCloudSession | null; apiBaseUrl: string;
  active: boolean; onPublication: () => void;
}) {
  const workbenches = useRef(new Map<string, CloudAgentWorkbench>());
  const publication = useRef(onPublication);
  publication.current = onPublication;
  const { target, storageKey, key } = workspaceIdentity(context, session, apiBaseUrl);
  const workbench = useMemo(() => {
    if (!target || !session) return null;
    let entry = workbenches.current.get(key);
    if (!entry) {
      entry = new CloudAgentWorkbench(new CloudAgentClient(target, session, apiBaseUrl), storageKey, session.session_generation);
      workbenches.current.set(key, entry);
    }
    return entry;
  }, [key, storageKey, apiBaseUrl, target, session]);
  const controller = workbench?.primary ?? null;
  const working = useWorkbenchWorking(workbench);
  const state = useSyncExternalStore(controller?.subscribe ?? subscribeEmpty,
    controller?.getSnapshot ?? readEmpty, controller?.getSnapshot ?? readEmpty);
  // Retain the actor's conversation and execution, but leave its pane closed
  // when the location or identity changes so returning requires an explicit open.
  useEffect(() => {
    const close = () => { if (controller?.getSnapshot().open) controller.setOpen(false); };
    if (!active) close();
    return close;
  }, [active, controller]);
  const observing = active && (state.open || working);
  useEffect(() => {
    if (!observing || !workbench) return;
    return workbench.observe(() => publication.current());
  }, [observing, workbench]);
  return { controller, state, workbench, open: active && state.open, toggle: controller?.toggle,
    setOpen: controller?.setOpen };
}
