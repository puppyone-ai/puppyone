import { useEffect, useMemo, useState } from "react";
import { AGENT_CHAT_CREATION_RECIPES, filterAgentChatCreationRecipesByLocalAgentIds } from "../../app-shell/auxiliary-workbench/agentChatCreationRecipes";
import type { LocalAgentInstallationId } from "../../../../shared/local-agent-installation/types";
import type { LocalAgentInstallationDiscoveryPhase } from "../../local-agents/model/localAgentInstallationAvailability";
import { TerminalLauncher } from "./TerminalLauncher";
import { resolveAppearance } from "../../appearance/resolveAppearance";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../appearance/AppearanceRuntime";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../../typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../markdown/markdownPresentation";
import "./desktop-terminal.css";

export function TerminalLauncherVisualSmokeHarness() {
  const query = new URLSearchParams(window.location.search);
  const width = clamp(Number(query.get("width")) || 420, 280, 760);
  const theme = query.get("theme") === "light" ? "light" : "dark";
  const appearance = useMemo(() => resolveSurfaceAppearance({
    appearance: resolveAppearance({ interfaceStyle: "default", themeMode: theme,
      sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" }),
    typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
    loadingAnimationPreset: "ikun", lightThemePreset: "neutral", darkThemePreset: "default",
    pointerCursors: false, diffMarkers: "color",
  }), [theme]);
  const agentMode = query.get("agentMode") === "chat" ? "chat" : "terminal";
  const [selection, setSelection] = useState<string | null>(null);
  const discoveryScenario = query.get("scenario") === "discovery";
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

  return (
    <SurfaceAppearanceProvider value={appearance}>
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
            discoveryProgress={discovery.completed ? { completedAgentCount: discovery.completed, totalAgentCount: 8 } : null}
            discoveryRefreshing={discovery.refreshing}
            discoveryHasFailures={discovery.failed}
            availableAgentIds={discovery.ids}
            chatRecipes={discoveryScenario ? filterAgentChatCreationRecipesByLocalAgentIds(AGENT_CHAT_CREATION_RECIPES, discovery.ids) : AGENT_CHAT_CREATION_RECIPES}
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
