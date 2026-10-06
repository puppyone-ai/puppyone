import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context";
import { repositoryTargetKey } from "../repositoryTarget";
import { CloudAgentController, type CloudAgentState } from "./CloudAgentController";
import { CloudAgentClient, cloudRunActive } from "./cloudAgentClient";

const EMPTY: CloudAgentState = { open: false, draft: "", loading: false, submitting: false, resolving: null,
  sessionId: null, agentId: null, pending: null, runs: [], sessions: [], error: null, reconnecting: false };
const subscribeEmpty = () => () => undefined;
const readEmpty = () => EMPTY;

export function useCloudAgentWorkspace({ context, session, apiBaseUrl, active, onPublication }: {
  context: ProjectCloudContext | null; session: DesktopCloudSession | null; apiBaseUrl: string;
  active: boolean; onPublication: () => void;
}) {
  const controllers = useRef(new Map<string, CloudAgentController>());
  const publication = useRef(onPublication);
  publication.current = onPublication;
  const target = context?.status === "resolved" ? context.target : null;
  const storageKey = JSON.stringify(["cloud-agent-v1", apiBaseUrl, session?.user_id,
    target?.project_id, target ? repositoryTargetKey(target) : null]);
  const key = JSON.stringify([storageKey, session?.session_generation]);
  const controller = useMemo(() => {
    if (!target || !session) return null;
    let entry = controllers.current.get(key);
    if (!entry) {
      entry = new CloudAgentController(new CloudAgentClient(target, session, apiBaseUrl), storageKey);
      controllers.current.set(key, entry);
    }
    return entry;
  }, [key, storageKey, apiBaseUrl, target, session]);
  const state = useSyncExternalStore(controller?.subscribe ?? subscribeEmpty,
    controller?.getSnapshot ?? readEmpty, controller?.getSnapshot ?? readEmpty);
  const working = cloudRunActive(state.runs[state.runs.length - 1]);
  const observing = active && (state.open || working);
  useEffect(() => {
    if (!observing || !controller) return;
    return controller.observe(() => publication.current());
  }, [observing, controller]);
  return { controller, state, open: active && state.open, toggle: controller?.toggle,
    setOpen: controller?.setOpen };
}
