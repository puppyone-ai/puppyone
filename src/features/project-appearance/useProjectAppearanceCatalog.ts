import { useCallback, useEffect, useMemo, useState } from "react";
import type { Workspace } from "@puppyone/shared-ui";
import type { ProjectAppearance } from "../../types/electron";

const PROJECT_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

export function getProjectAppearanceIdentity(workspace: Workspace): string | null {
  const candidates = [workspace.workspaceInstanceId, workspace.id];
  return candidates.find((candidate) => (
    typeof candidate === "string" && PROJECT_IDENTITY_PATTERN.test(candidate)
  )) ?? null;
}

export function useProjectAppearanceCatalog(workspaces: readonly Workspace[]) {
  const identities = useMemo(() => Array.from(new Set(
    workspaces.flatMap((workspace) => {
      const identity = getProjectAppearanceIdentity(workspace);
      return identity ? [identity] : [];
    }),
  )), [workspaces]);
  const [appearances, setAppearances] = useState<ReadonlyMap<string, ProjectAppearance>>(
    () => new Map(),
  );
  const [pendingIdentity, setPendingIdentity] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    const client = window.puppyoneDesktop?.projectAppearance;
    if (!client) return undefined;
    let active = true;
    void client.list({ projectIdentities: identities }).then((items) => {
      if (!active) return;
      setAppearances(new Map(items.map((appearance) => [
        appearance.projectIdentity,
        appearance,
      ])));
    }).catch((error) => {
      console.error("Unable to load local Project appearances:", error);
    });
    return () => {
      active = false;
    };
  }, [identities]);

  useEffect(() => window.puppyoneDesktop?.projectAppearance?.onChanged((appearance) => {
    setAppearances((current) => {
      const next = new Map(current);
      next.set(appearance.projectIdentity, appearance);
      return next;
    });
  }), []);

  const chooseIcon = useCallback(async (projectIdentity: string) => {
    const client = window.puppyoneDesktop?.projectAppearance;
    if (!client || pendingIdentity) return;
    setMutationError(null);
    setPendingIdentity(projectIdentity);
    try {
      const result = await client.chooseIcon({ projectIdentity });
      if (result.status === "updated") {
        setAppearances((current) => new Map(current).set(projectIdentity, result.appearance));
      }
    } catch (error) {
      console.error("Unable to update the local Project icon:", error);
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingIdentity(null);
    }
  }, [pendingIdentity]);

  const resetIcon = useCallback(async (projectIdentity: string) => {
    const client = window.puppyoneDesktop?.projectAppearance;
    if (!client || pendingIdentity) return;
    setMutationError(null);
    setPendingIdentity(projectIdentity);
    try {
      const appearance = await client.resetIcon({ projectIdentity });
      setAppearances((current) => new Map(current).set(projectIdentity, appearance));
    } catch (error) {
      console.error("Unable to reset the local Project icon:", error);
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingIdentity(null);
    }
  }, [pendingIdentity]);

  const setEmoji = useCallback(async (projectIdentity: string, emoji: string) => {
    const client = window.puppyoneDesktop?.projectAppearance;
    if (!client || pendingIdentity) return;
    setMutationError(null);
    setPendingIdentity(projectIdentity);
    try {
      const appearance = await client.setEmoji({ projectIdentity, emoji });
      setAppearances((current) => new Map(current).set(projectIdentity, appearance));
    } catch (error) {
      console.error("Unable to update the local Project emoji:", error);
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingIdentity(null);
    }
  }, [pendingIdentity]);

  const clearMutationError = useCallback(() => setMutationError(null), []);

  return Object.freeze({
    appearances,
    chooseIcon,
    clearMutationError,
    mutationError,
    pendingIdentity,
    resetIcon,
    setEmoji,
  });
}
