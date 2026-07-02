import { useEffect, useState } from "react";
import {
  getCloudHistory,
  type DesktopCloudHistory,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";

export type CloudBranchesDataState = {
  history: DesktopCloudHistory | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

type CloudBranchesDataInternalState = Omit<CloudBranchesDataState, "reload"> & {
  contextKey: string | null;
};

export function useCloudBranchesData({
  session,
  projectId,
  apiBaseUrl,
  enabled = true,
  revisionKey,
  onSessionChange,
}: {
  session: DesktopCloudSession;
  projectId: string;
  apiBaseUrl: string | null;
  enabled?: boolean;
  revisionKey?: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}): CloudBranchesDataState {
  const [reloadToken, setReloadToken] = useState(0);
  const contextKey = enabled
    ? [session.user_email, session.api_base_url ?? "", apiBaseUrl ?? "", projectId, revisionKey ?? ""].join("\n")
    : `disabled:${projectId}`;
  const [state, setState] = useState<CloudBranchesDataInternalState>(() => createCloudBranchesDataState());

  useEffect(() => {
    if (!enabled) {
      setState(createCloudBranchesDataState({ contextKey }));
      return undefined;
    }

    let cancelled = false;
    const load = async () => {
      setState((current) => ({
        ...current,
        loading: true,
        error: null,
        contextKey,
      }));

      try {
        const history = await getCloudHistory(session, projectId, 80, onSessionChange, apiBaseUrl);
        if (cancelled) return;
        setState({
          history,
          loading: false,
          error: null,
          contextKey,
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          history: null,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load branch history.",
          contextKey,
        });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, contextKey, enabled, onSessionChange, projectId, reloadToken, session, revisionKey]);

  const reload = async () => {
    setReloadToken((token) => token + 1);
  };

  if (state.contextKey !== contextKey) {
    return {
      ...toPublicCloudBranchesDataState(createCloudBranchesDataState({ loading: enabled })),
      reload,
    };
  }

  return {
    ...toPublicCloudBranchesDataState(state),
    reload,
  };
}

function createCloudBranchesDataState(
  overrides: Partial<CloudBranchesDataInternalState> = {},
): CloudBranchesDataInternalState {
  return {
    history: null,
    loading: false,
    error: null,
    contextKey: null,
    ...overrides,
  };
}

function toPublicCloudBranchesDataState({
  contextKey,
  ...publicState
}: CloudBranchesDataInternalState): Omit<CloudBranchesDataState, "reload"> {
  void contextKey;
  return publicState;
}
