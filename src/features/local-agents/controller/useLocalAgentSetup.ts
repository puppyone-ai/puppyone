import { useEffect, useRef, useState } from "react";
import type { LocalAgentSetupPreferences, LocalAgentSetupRequest, LocalAgentSetupSnapshot } from "../../../../shared/local-agent-installation/setup-types";
import type { LocalAgentInstallationStoreSnapshot } from "../application/LocalAgentInstallationStore";

let nextClientId = 0;

/** Shares installation lifecycle: no additional focus listeners or polling. */
export function useLocalAgentSetup({ enabled, surface, eligibleInstallationIds, hiddenAgentIds, preferences, discovery }: {
  enabled: boolean;
  surface: "chat" | "terminal";
  eligibleInstallationIds: readonly string[];
  hiddenAgentIds: readonly string[];
  preferences: LocalAgentSetupPreferences;
  discovery: LocalAgentInstallationStoreSnapshot;
}) {
  const [clientId] = useState(() => `local-agent-setup:${++nextClientId}`);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<{ key: string; snapshot: LocalAgentSetupSnapshot | null; error: boolean } | null>(null);
  const bridge = window.puppyoneDesktop?.localAgentSetup;
  const scanning = discovery.phase === "idle" || discovery.phase === "loading";
  const request: LocalAgentSetupRequest = {
    clientId, surface, eligibleInstallationIds, hiddenAgentIds, preferences,
  };
  const requestJson = JSON.stringify(request);
  // Idle→loading and cumulative broadcasts belong to the same scan. Only its
  // final generation should request another projection, not another App probe.
  const generation = scanning ? 0 : discovery.snapshot?.generation ?? 0;
  const key = `${requestJson}:${generation}:${revision}:${scanning ? "scanning" : discovery.phase}`;
  const latestKey = useRef(key);
  latestKey.current = key;

  useEffect(() => {
    if (!enabled || !bridge) return;
    let current = true;
    void bridge.inspect(JSON.parse(requestJson) as LocalAgentSetupRequest).then((snapshot) => {
      if (!current) return;
      setView(validSnapshot(snapshot) && snapshot.installationGeneration >= generation
        ? { key, snapshot, error: false } : { key, snapshot: null, error: true });
    }).catch(() => { if (current) setView({ key, snapshot: null, error: true }); });
    return () => { current = false; };
  }, [enabled, bridge, requestJson, generation, key]);

  useEffect(() => {
    if (!enabled || !bridge) return;
    return () => { void bridge.release(clientId).catch(() => {}); };
  }, [enabled, bridge, clientId]);

  const busy = scanning || view?.key !== key;
  return {
    supported: Boolean(bridge),
    snapshot: view?.snapshot ?? null,
    busy,
    error: view?.key === key && view.error,
    async openGuide(setupId: string, mode: "manual" | "recommendation") {
      if (!bridge || !view?.snapshot || busy || !enabled) return "stale" as const;
      const status = (await bridge.act({ clientId, revision: view.snapshot.revision, setupId, actionId: "open-guide", mode })).status;
      if (latestKey.current !== key) return "stale" as const;
      if (status === "stale" || status === "detected") setRevision((value) => value + 1);
      return status;
    },
  };
}

function validSnapshot(value: LocalAgentSetupSnapshot) {
  return value && typeof value.revision === "string" && value.revision.length <= 100
    && Number.isSafeInteger(value.installationGeneration) && Array.isArray(value.entries) && value.entries.length <= 8
    && value.entries.every((entry) => typeof entry.setupId === "string" && entry.setupId.length <= 80
      && typeof entry.displayName === "string" && entry.displayName.length <= 160
      && typeof entry.recommended === "boolean" && typeof entry.companionPresent === "boolean"
      && ["found", "not-found", "unknown"].includes(entry.status)
      && ["external-cli", "app-bundled-runtime", "companion-managed-runtime"].includes(entry.strategy));
}
