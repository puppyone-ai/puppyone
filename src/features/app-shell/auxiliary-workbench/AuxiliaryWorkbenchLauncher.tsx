import { useMemo, useSyncExternalStore } from "react";
import type { AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchCreationRecipe, AuxiliaryWorkbenchHistoryTarget } from "./types";
import type { WorkbenchLauncherContext } from "./AuxiliaryWorkbenchPanel";
import type { ProjectWorkbenchStore } from "./ProjectWorkbenchStore";
import { filterAgentChatCreationRecipesByLocalAgentIds } from "./agentChatCreationRecipes";
import { useTerminalAgentLocator } from "../../desktop-terminal/controller/useTerminalAgentLocator";
import { TerminalLauncher } from "../../desktop-terminal/ui/TerminalLauncher";
import { WorkbenchLauncherState } from "./WorkbenchLauncherState";

/** Product composition: generic workbench admission plus feature-owned launchers. */
export function AuxiliaryWorkbenchLauncher({ store, contributions, hiddenAgentIds, groupId, itemId, presented }: WorkbenchLauncherContext & {
  store: ProjectWorkbenchStore;
  contributions: readonly AuxiliaryWorkbenchContribution[];
  hiddenAgentIds: readonly string[];
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const launcherState = store.getResource(`launcher:${itemId ?? "empty"}`, () => new WorkbenchLauncherState());
  const discovery = useTerminalAgentLocator({ enabled: presented });
  const availableAgentIds = discovery.ids.filter((id) => !hiddenAgentIds.includes(id));
  const chat = contributions.find((entry) => entry.kind === "agent-chat");
  const terminal = contributions.find((entry) => entry.kind === "terminal");
  const history = useMemo(() => chat?.history ? {
    ...chat.history,
    renderBrowser: (context: Parameters<NonNullable<typeof chat.history>["renderBrowser"]>[0]) => chat.history!.renderBrowser({ ...context, project: store }),
  } : null, [chat, store]);
  const create = async (kind: string, recipe: AuxiliaryWorkbenchCreationRecipe | null, target: AuxiliaryWorkbenchHistoryTarget | null = null) => {
    const result = await store.create(kind, groupId, recipe, target, itemId);
    if (result) launcherState.patch({ historyOpen: false, openingTargetId: null });
    return Boolean(result);
  };
  return <TerminalLauncher
    state={launcherState}
    titleId={`workbench-launcher-${store.context.generation}-${itemId ?? "empty"}`}
    agentMode={chat ? "chat" : "terminal"}
    discoveryPhase={discovery.phase}
    availableAgentIds={availableAgentIds}
    terminalEnabled={Boolean(terminal)}
    launching={snapshot.preparingKinds.has("terminal") || snapshot.closing}
    chatPreparing={snapshot.preparingKinds.has("agent-chat")}
    chatCreationAvailable={store.canCreate("agent-chat")}
    chatRecipes={filterAgentChatCreationRecipesByLocalAgentIds(chat?.creationRecipes ?? [], availableAgentIds)}
    history={history}
    historyRootId={store.context.projectId}
    historyRootPath={store.context.rootPath}
    excludedHistoryResourceIds={Array.from(snapshot.snapshots.values()).flatMap((entry) => entry.resourceId ? [entry.resourceId] : [])}
    onRefresh={discovery.refresh}
    onLaunch={(id) => {
      const recipe = terminal?.creationRecipes?.find((entry) => entry.id === id);
      if (recipe && (id === "shell" || (!chat && availableAgentIds.some((agent) => agent === id)))) void create("terminal", recipe);
    }}
    onCreateChat={chat ? (recipe) => { void create("agent-chat", recipe); } : undefined}
    onRestoreHistoryTarget={history ? (target) => create("agent-chat", null, target) : undefined}
  />;
}
