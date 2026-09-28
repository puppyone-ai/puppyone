import { useCallback, useEffect, useRef, useState } from "react";

export type HeaderCoachmarkId = "agent" | "changes";

export const HEADER_COACHMARKS_STORAGE_KEY = "puppyone.desktop.headerCoachmarks.v1";

type HeaderCoachmarkProgress = Record<HeaderCoachmarkId, boolean>;

const EMPTY_PROGRESS: HeaderCoachmarkProgress = Object.freeze({
  agent: false,
  changes: false,
});

export function useHeaderCoachmarks({
  agentOpen,
  alwaysShow = false,
  changesOpen,
  localChangeCount,
  workspaceEntryId,
  workspaceScopeId,
}: {
  agentOpen: boolean;
  alwaysShow?: boolean;
  changesOpen: boolean;
  localChangeCount: number | null;
  workspaceEntryId: string | null;
  workspaceScopeId: string | null;
}) {
  const [progress, setProgress] = useState<HeaderCoachmarkProgress>(readHeaderCoachmarkProgress);
  const [active, setActive] = useState<HeaderCoachmarkId | null>(null);
  const lastWorkspaceEntryRef = useRef<string | null>(null);
  const previousWorkspaceScopeRef = useRef<string | null>(null);
  const previousLocalChangeCountRef = useRef<number | null>(null);
  const lastChangesReplayScopeRef = useRef<string | null>(null);
  const pendingChangesRef = useRef(false);

  const acknowledge = useCallback((id: HeaderCoachmarkId) => {
    if (id === "changes") pendingChangesRef.current = false;
    if (!alwaysShow) {
      setProgress((current) => {
        if (current[id]) return current;
        const next = { ...current, [id]: true };
        writeHeaderCoachmarkProgress(next);
        return next;
      });
    }
    setActive((current) => {
      if (current !== id) return current;
      if (id === "agent" && pendingChangesRef.current) {
        pendingChangesRef.current = false;
        return "changes";
      }
      return null;
    });
  }, [alwaysShow]);

  const agentTriggerKey = alwaysShow
    ? workspaceScopeId && `always:${workspaceScopeId}`
    : workspaceEntryId && `once:${workspaceEntryId}`;

  useEffect(() => {
    if (!agentTriggerKey || lastWorkspaceEntryRef.current === agentTriggerKey) return;
    if ((!alwaysShow && progress.agent) || agentOpen) return;
    lastWorkspaceEntryRef.current = agentTriggerKey;
    setActive((current) => current ?? "agent");
  }, [agentOpen, agentTriggerKey, alwaysShow, progress.agent]);

  useEffect(() => {
    if (previousWorkspaceScopeRef.current === workspaceScopeId) return;
    previousWorkspaceScopeRef.current = workspaceScopeId;
    previousLocalChangeCountRef.current = null;
    lastChangesReplayScopeRef.current = null;
    pendingChangesRef.current = false;
  }, [workspaceScopeId]);

  useEffect(() => {
    if (localChangeCount === null) {
      previousLocalChangeCountRef.current = null;
      lastChangesReplayScopeRef.current = null;
      return;
    }

    const previous = previousLocalChangeCountRef.current;
    previousLocalChangeCountRef.current = localChangeCount;
    if (alwaysShow) {
      if (localChangeCount === 0) {
        lastChangesReplayScopeRef.current = null;
        return;
      }
      if (!workspaceScopeId || lastChangesReplayScopeRef.current === workspaceScopeId || changesOpen) return;
      lastChangesReplayScopeRef.current = workspaceScopeId;
    } else {
      lastChangesReplayScopeRef.current = null;
      const firstRealChangeAppeared = previous === 0 && localChangeCount > 0;
      if (!firstRealChangeAppeared || progress.changes || changesOpen) return;
    }
    setActive((current) => {
      if (!current) return "changes";
      if (current !== "changes") pendingChangesRef.current = true;
      return current;
    });
  }, [alwaysShow, changesOpen, localChangeCount, progress.changes, workspaceScopeId]);

  useEffect(() => {
    if (agentOpen) acknowledge("agent");
  }, [acknowledge, agentOpen]);

  useEffect(() => {
    if (changesOpen) acknowledge("changes");
  }, [acknowledge, changesOpen]);

  return { active, acknowledge };
}

export function readHeaderCoachmarkProgress(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): HeaderCoachmarkProgress {
  try {
    const parsed = JSON.parse(storage.getItem(HEADER_COACHMARKS_STORAGE_KEY) ?? "null") as Partial<HeaderCoachmarkProgress> | null;
    return {
      agent: parsed?.agent === true,
      changes: parsed?.changes === true,
    };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

function writeHeaderCoachmarkProgress(progress: HeaderCoachmarkProgress) {
  try {
    window.localStorage.setItem(HEADER_COACHMARKS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage is a convenience. A denied write must not block the workspace.
  }
}
