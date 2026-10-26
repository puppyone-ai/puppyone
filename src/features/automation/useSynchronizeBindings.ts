import { useCallback, useEffect, useRef, useState } from "react";
import {
  listSynchronizeBindings,
  type DesktopCloudSession,
  type DesktopCloudSynchronizeBinding,
} from "../../lib/cloudApi";

type State = {
  key: string;
  bindings: DesktopCloudSynchronizeBinding[];
  loading: boolean;
  error: string | null;
};

/** Route-owned source data, isolated from Access and from previous accounts. */
export function useSynchronizeBindings(
  projectId: string,
  session: DesktopCloudSession,
  onSessionChange: (session: DesktopCloudSession | null) => void,
) {
  const key = JSON.stringify([session.api_base_url, session.user_id, session.session_generation, projectId]);
  const [state, setState] = useState<State>({ key, bindings: [], loading: true, error: null });
  const request = useRef(0);
  const reload = useCallback(async () => {
    const id = ++request.current;
    setState((current) => ({
      key, bindings: current.key === key ? current.bindings : [], loading: true, error: null,
    }));
    try {
      const bindings = await listSynchronizeBindings(session, projectId, onSessionChange, session.api_base_url);
      if (request.current === id) setState({ key, bindings, loading: false, error: null });
    } catch (error) {
      if (request.current === id) setState((current) => ({
        ...current, loading: false, error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }, [key, session, projectId, onSessionChange]);

  useEffect(() => {
    void reload().catch(() => undefined);
    return () => { request.current += 1; };
  }, [reload]);

  return {
    bindings: state.key === key ? state.bindings : [],
    loading: state.key !== key || state.loading,
    error: state.key === key ? state.error : null,
    reload,
  };
}
