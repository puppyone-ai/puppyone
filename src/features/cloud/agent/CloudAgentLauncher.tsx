import { useLayoutEffect, useSyncExternalStore } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { TerminalLauncher } from "../../desktop-terminal";
import { WorkbenchLauncherState } from "../../../lib/workbench/WorkbenchLauncherState";
import type { AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchCreationRecipe, AuxiliaryWorkbenchHistoryTarget, WorkbenchLauncherContext } from "../../../lib/workbench/types";
import { type CloudAgentWorkbench, CLOUD_AGENT_KIND } from "./CloudAgentWorkbench";

export function CloudAgentLauncher({ workbench, contribution, groupId, itemId, presented }: WorkbenchLauncherContext & {
  workbench: CloudAgentWorkbench; contribution: AuxiliaryWorkbenchContribution;
}) {
  const { t } = useLocalization();
  const store = workbench.store;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const launcher = store.getResource(`launcher:${itemId ?? "empty"}`, () => new WorkbenchLauncherState());
  const { historyOpen } = useSyncExternalStore(launcher.subscribe, launcher.getSnapshot);
  const title = t(historyOpen ? "agent.history.title" : "workspace.workbench.newTab");
  useLayoutEffect(() => {
    const current = itemId && store.getSnapshot().snapshots.get(itemId);
    if (current && store.getSnapshot().topology.items.some(item => item.id === itemId && item.kind === "launcher")) {
      store.updateSnapshot(itemId!, { ...current, title, accessibleLabel: title, iconKey: historyOpen ? "history" : null });
    }
  }, [store, itemId, title, historyOpen]);
  const create = async (recipe: AuxiliaryWorkbenchCreationRecipe | null, target: AuxiliaryWorkbenchHistoryTarget | null = null) => {
    const id = await store.create(CLOUD_AGENT_KIND, groupId, recipe, target, itemId);
    if (id) launcher.patch({ historyOpen: false, openingTargetId: null });
    return Boolean(id);
  };
  return <TerminalLauncher state={launcher} presented={presented}
    titleId={`cloud-launcher-${store.context.generation}-${itemId ?? "empty"}`}
    agentMode="chat" headingLabel={t("cloud.home.cloud")} discoveryPhase="ready" availableAgentIds={[]}
    terminalEnabled={false} onLaunch={() => {}}
    chatCreationAvailable={store.canCreate(CLOUD_AGENT_KIND)} chatPreparing={snapshot.preparingKinds.has(CLOUD_AGENT_KIND)}
    chatRecipes={contribution.creationRecipes} onCreateChat={recipe => { void create(recipe); }}
    history={contribution.history} historyRootId={store.context.projectId} historyRootPath={store.context.rootPath}
    excludedHistoryResourceIds={[...snapshot.snapshots.values()].flatMap(item => item.resourceId ? [item.resourceId] : [])}
    onOpenHistory={() => {
      const id = itemId ?? store.createLauncher(groupId, t("agent.history.title"));
      if (id) store.getResource(`launcher:${id}`, () => new WorkbenchLauncherState()).patch({ historyOpen: true });
    }}
    onRestoreHistoryTarget={target => create(null, target)} />;
}
