import { useEffect, useState } from "react";
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
  // Switching the active project reorders/recreates workspace projections.
  // Appearance loading depends on membership, not that presentation order.
  // Valid identities cannot contain the newline separator.
  const identitiesKey = Array.from(new Set(
    workspaces.flatMap((workspace) => {
      const identity = getProjectAppearanceIdentity(workspace);
      return identity ? [identity] : [];
    }),
  )).sort().join("\n");
  const [appearances, setAppearances] = useState<ReadonlyMap<string, ProjectAppearance>>(
    () => new Map(),
  );

  useEffect(() => {
    const client = window.puppyoneDesktop?.projectAppearance;
    if (!client) return undefined;
    let active = true;
    const projectIdentities = identitiesKey ? identitiesKey.split("\n") : [];
    void client.list({ projectIdentities }).then((items) => {
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
  }, [identitiesKey]);

  useEffect(() => window.puppyoneDesktop?.projectAppearance?.onChanged((appearance) => {
    setAppearances((current) => {
      const next = new Map(current);
      next.set(appearance.projectIdentity, appearance);
      return next;
    });
  }), []);

  return Object.freeze({
    appearances,
  });
}
