import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AGENT_CHAT_CREATION_RECIPES, filterAgentChatCreationRecipesByLocalAgentIds } from "../../app-shell/auxiliary-workbench/agentChatCreationRecipes";
import type { LocalAgentInstallationId } from "../../../../shared/local-agent-installation/types";
import type { LocalAgentInstallationDiscoveryPhase } from "../../local-agents/model/localAgentInstallationAvailability";
import { TerminalLauncher } from "./TerminalLauncher";
import { LocalAgentSetupSection } from "../../local-agents/ui/LocalAgentSetupSection";
import { useLocalAgentActivation } from "../../local-agents/activation/LocalAgentActivationStore";
import { DesktopOverlayPortal } from "../../app-shell/DesktopOverlayPortal";
import type { LocalAgentSetupPreferences } from "../../../../shared/local-agent-installation/setup-types";
import { resolveAppearance } from "../../appearance/resolveAppearance";
import { applySurfaceAppearanceToElement, resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../appearance/AppearanceRuntime";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../../typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../markdown/markdownPresentation";
import "./desktop-terminal.css";

export function TerminalLauncherVisualSmokeHarness() {
  const query = new URLSearchParams(window.location.search);
  const width = clamp(Number(query.get("width")) || 420, 280, 760);
  const theme = query.get("theme") === "light" ? "light" : "dark";
  const scale = query.get("scale") === "small" ? "small" : query.get("scale") === "large" ? "large" : "medium";
  const appearance = useMemo(() => resolveSurfaceAppearance({
    appearance: resolveAppearance({ interfaceStyle: "default", themeMode: theme,
      sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" }),
    typography: resolveTypography({ ...DEFAULT_TYPOGRAPHY_PREFERENCES, scale }),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
    loadingAnimationPreset: "ikun", lightThemePreset: "neutral", darkThemePreset: "default",
    pointerCursors: false, diffMarkers: "color",
  }), [theme, scale]);
  // Like the real shell, resolve inherited semantic tokens at the document
  // boundary; changing only a nested preview's palette leaves stale root aliases.
  useLayoutEffect(() => { applySurfaceAppearanceToElement(document.documentElement, appearance); }, [appearance]);
  const agentMode = query.get("agentMode") === "chat" ? "chat" : "terminal";
  const [selection, setSelection] = useState<string | null>(null);
  const setupScenario = query.get("scenario") === "setup";
  const activation = useLocalAgentActivation();
  const discoveryScenario = setupScenario || query.get("scenario") === "discovery";
  const [setupPreferences, setSetupPreferences] = useState<LocalAgentSetupPreferences>({ enabled: true, dismissedSetupIds: [], snoozedUntil: {} });
  const [discovery, setDiscovery] = useState<{
    phase: LocalAgentInstallationDiscoveryPhase; ids: LocalAgentInstallationId[];
    completed: number; refreshing: boolean; failed: boolean;
  }>(() => ({ phase: discoveryScenario ? "loading" : "ready", ids: discoveryScenario ? [] : ["codex", "claude", "cursor", "opencode", "pi", "hermes"],
    completed: 0, refreshing: false, failed: false }));
  useEffect(() => {
    if (!discoveryScenario) return;
    Object.assign(window, { __launcherDiscoverySmoke: { setDiscovery } });
    return () => { Reflect.deleteProperty(window, "__launcherDiscoverySmoke"); };
  }, [discoveryScenario]);
  const usableIds = discovery.ids.filter(id => !activation.snapshot.operations.some(operation => operation.setupId === id && !["ready", "detected"].includes(operation.status)));

  return (
    <SurfaceAppearanceProvider value={appearance}>
    <DesktopOverlayPortal appearance={appearance}>{null}</DesktopOverlayPortal>
    <main
      {...appearance.rootProps}
      className={`desktop-terminal-launcher-smoke ${theme === "dark" ? "dark" : ""}`}
      data-smoke-theme={theme}
    >
      <section
        className="desktop-terminal-launcher-smoke-panel desktop-terminal-panel"
        style={{ width }}
      >
        <div className="desktop-terminal-body is-empty">
          <TerminalLauncher
            agentMode={agentMode}
            discoveryPhase={discovery.phase}
            discoveryRefreshing={discovery.refreshing}
            discoveryHasFailures={discovery.failed}
            availableAgentIds={usableIds}
            agentSetup={setupScenario ? (onReturnToLauncher) => <LocalAgentSetupSection enabled surface="chat"
              onReturnToLauncher={onReturnToLauncher}
              eligibleInstallationIds={["codex", "cursor"]} hiddenAgentIds={[]}
              preferences={setupPreferences} onPreferencesChange={setSetupPreferences}
              discovery={{ ids: discovery.ids, phase: discovery.phase, hasFailures: discovery.failed, refreshing: discovery.refreshing, progress: null,
                snapshot: { schemaVersion: 1, generation: discovery.completed, scanId: `fixture:${discovery.completed}`,
                  source: "scan", results: [], availableAgentIds: discovery.ids, requestedAt: "2026-09-19T00:00:00Z", completedAt: "2026-09-19T00:00:00Z" } }}
              onRefresh={() => setDiscovery((current) => ({ ...current, phase: "loading", refreshing: true }))} /> : undefined}
            chatRecipes={discoveryScenario ? filterAgentChatCreationRecipesByLocalAgentIds(AGENT_CHAT_CREATION_RECIPES, usableIds) : AGENT_CHAT_CREATION_RECIPES}
            onCreateChat={(recipe) => setSelection(`chat:${recipe.id}`)}
            onLaunch={setSelection}
            onRefresh={() => setDiscovery(current => ({ ...current, phase: "loading", refreshing: true, failed: false, completed: 0 }))}
          />
        </div>
      </section>
      <output className="desktop-terminal-launcher-smoke-output">
        {selection ?? "idle"}
      </output>
    </main>
    </SurfaceAppearanceProvider>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
