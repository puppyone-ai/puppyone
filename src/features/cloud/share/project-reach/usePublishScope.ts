import { useEffect, useRef, useState } from "react";
import { getWorkspacePublishScope } from "../../../../lib/localFiles";
import type { WorkspacePublishScope } from "../../../../types/electron";

export type PublishScopeState = Readonly<{
  loading: boolean;
  /** `null` while unknown, and on hosts that cannot answer the question. */
  scope: WorkspacePublishScope | null;
  failed: boolean;
}>;

/**
 * How many files and bytes the current choice would make reachable.
 *
 * The form states this before the user commits, so the numbers come from the
 * same ignore rules that will do the work. When the count cannot be taken the
 * form says so instead of showing a guess: an invented number here would be a
 * promise about what leaves this Mac.
 */
export function usePublishScope({
  rootPath,
  path,
  enabled = true,
}: {
  rootPath: string | null;
  path: string;
  enabled?: boolean;
}): PublishScopeState {
  const [state, setState] = useState<PublishScopeState>({ loading: false, scope: null, failed: false });
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!rootPath || !enabled) {
      setState({ loading: false, scope: null, failed: false });
      return undefined;
    }
    setState((previous) => ({ loading: true, scope: previous.scope, failed: false }));
    getWorkspacePublishScope(rootPath, path)
      .then((scope) => {
        if (request !== requestRef.current) return;
        setState({ loading: false, scope, failed: false });
      })
      .catch(() => {
        if (request !== requestRef.current) return;
        setState({ loading: false, scope: null, failed: true });
      });
    return () => {
      requestRef.current += 1;
    };
  }, [enabled, path, rootPath]);

  return state;
}
