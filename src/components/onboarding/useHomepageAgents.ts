import { useMemo } from "react";
import { useDesktopPreference } from "../../preferencesStore";
import {
  LOCAL_AGENT_CHAT_RECIPES,
  localAgentIdForAgentChatRuntime,
  useAgentActivityEnrollment,
  useLocalAgentInstallations,
} from "../../features/local-agents";

/** An Agent on this computer that can be asked to start a project. */
export type HomepageLocalAgent = Readonly<{
  /** The chat runtime a new project's first session runs in. */
  runtimeId: string;
  label: string;
  iconKey: string;
  /** puppyone is set up in the Agent itself, so its work shows in the projects. */
  connected: boolean;
}>;

/**
 * The Agents installed here (`status === "found"`) that can hold a conversation in a
 * project, in the same order and with the same hidden ones left out as the project's
 * own new-tab list. Retained probe failures and the built-in Agent are left out: the
 * Homepage lists only the person's own confirmed Agents on this computer.
 */
export function useHomepageLocalAgents(enabled: boolean): readonly HomepageLocalAgent[] {
  const hidden = useDesktopPreference((s) => s.localAgentsSettings.hiddenTerminalAgentIds);
  const discovery = useLocalAgentInstallations({ enabled });
  const { enabledProviderIds } = useAgentActivityEnrollment({ enabled });
  return useMemo(() => {
    const results = discovery.snapshot?.results ?? discovery.progress?.results ?? [];
    const foundIds: ReadonlySet<string> = new Set(
      results
        .filter((result) => result.status === "found" && !hidden.includes(result.agentId))
        .map((result) => result.agentId),
    );
    return LOCAL_AGENT_CHAT_RECIPES
      .filter((recipe) => foundIds.has(localAgentIdForAgentChatRuntime(recipe.id)))
      .map((recipe) => {
        const providerId = localAgentIdForAgentChatRuntime(recipe.id);
        return {
          runtimeId: recipe.id,
          label: recipe.label,
          iconKey: recipe.iconKey,
          connected: enabledProviderIds.has(providerId),
        };
      });
  }, [discovery.progress, discovery.snapshot, enabledProviderIds, hidden]);
}
