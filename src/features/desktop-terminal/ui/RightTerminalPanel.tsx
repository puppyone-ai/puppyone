import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  AuxiliaryWorkbenchItem,
  WorkbenchSplitDropEdge,
  WorkbenchSplitMinimumSize,
  Workspace,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type {
  AuxiliaryWorkbenchCloseDecision,
  AuxiliaryWorkbenchContribution,
  AuxiliaryWorkbenchCreationRecipe,
  AuxiliaryWorkbenchHistoryTarget,
} from "../../app-shell/auxiliary-workbench/types";
import { filterAgentChatCreationRecipesByLocalAgentIds } from "../../app-shell/auxiliary-workbench/agentChatCreationRecipes";
import { AuxiliaryWorkbenchCloseDialog } from "../../app-shell/auxiliary-workbench/AuxiliaryWorkbenchCloseDialog";
import { useAuxiliaryWorkbenchContributions } from "../../app-shell/auxiliary-workbench/useAuxiliaryWorkbenchContributions";
import {
  useAuxiliaryWorkbenchCloseCoordinator,
  type AuxiliaryWorkbenchCloseTarget,
} from "../../app-shell/auxiliary-workbench/useAuxiliaryWorkbenchCloseCoordinator";
import { useTerminalAgentLocator } from "../controller/useTerminalAgentLocator";
import { useTerminalTabMoveDrag } from "../interactions/useTerminalTabMoveDrag";
import { getTerminalClosePolicy } from "../model/terminalClosePolicy";
import type { DesktopTerminalLauncherId } from "../model/terminalLaunchers";
import {
  canPlaceTerminalSplit,
  terminalLeafMinimumSize,
} from "../model/terminalSplitConstraints";
import { usePersistentTerminalSessionHosts } from "../layout/session-host/usePersistentTerminalSessionHosts";
import { useTerminalAppearanceSync } from "../runtime/useTerminalAppearanceSync";
import {
  AGENT_CHAT_WORKBENCH_ITEM_KIND,
  TERMINAL_WORKBENCH_ITEM_KIND,
  useTerminalWorkbench,
} from "../workbench/useTerminalWorkbench";
import { TerminalContributionItemHost } from "../workbench/TerminalContributionItemHost";
import { TerminalWorkbenchCreationFailure } from "../workbench/TerminalWorkbenchCreationFailure";
import { useTerminalWorkbenchSnapshots } from "../workbench/useTerminalWorkbenchSnapshots";
import { TerminalWorkbenchViewport } from "../workbench/TerminalWorkbenchViewport";
import { TerminalLauncher } from "./TerminalLauncher";
import { TerminalSessionHost } from "./TerminalSessionHost";
import "@xterm/xterm/css/xterm.css";
import "./desktop-terminal.css";

type RightTerminalPanelProps = Readonly<{
  workspace: Workspace;
  active: boolean;
  terminalEnabled?: boolean;
  hiddenAgentIds: readonly string[];
  contributions?: readonly AuxiliaryWorkbenchContribution[];
}>;

const EMPTY_CHAT_RECIPES: readonly AuxiliaryWorkbenchCreationRecipe[] = Object.freeze([]);
const CLOSE_NOW: AuxiliaryWorkbenchCloseDecision = Object.freeze({ kind: "close" });

export function RightTerminalPanel({
  workspace,
  active,
  terminalEnabled = true,
  hiddenAgentIds,
  contributions = [],
}: RightTerminalPanelProps) {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const workbench = useTerminalWorkbench({ messageFormatter: t });
  const currentRoot = useMemo(
    () => ({ id: workspace.id, path: workspace.path }),
    [workspace.id, workspace.path],
  );
  const presentedItemIdSet = useMemo(
    () => new Set(workbench.presentedItemIds),
    [workbench.presentedItemIds],
  );
  const itemById = useMemo(
    () => new Map(workbench.items.map((item) => [item.id, item])),
    [workbench.items],
  );
  const contributionByKind = useMemo(
    () => new Map(contributions.map((contribution) => [contribution.kind, contribution])),
    [contributions],
  );
  const {
    headerItems,
    itemIds,
    setInitialSnapshot,
    snapshotById,
    updateSnapshot,
  } = useTerminalWorkbenchSnapshots({
    contributions: contributionByKind,
    items: workbench.items,
    runtimeRegistry: workbench.runtimeRegistry,
    terminalById: workbench.terminalById,
    t,
  });
  const reserveContributionItem = useCallback((
    contribution: AuxiliaryWorkbenchContribution,
  ) => workbench.reserveContributionItem(contribution.kind, currentRoot), [currentRoot, workbench]);
  const commitContributionItem = useCallback((
    contribution: AuxiliaryWorkbenchContribution,
    item: AuxiliaryWorkbenchItem,
    targetGroupId: string | null,
    recipe: AuxiliaryWorkbenchCreationRecipe | null,
    historyTarget: AuxiliaryWorkbenchHistoryTarget | null,
  ) => {
    const itemId = workbench.commitContributionItem(item, targetGroupId);
    setInitialSnapshot(itemId, Object.freeze({
      ...contribution.initialSnapshot,
      title: historyTarget?.title ?? contribution.initialSnapshot.title,
      accessibleLabel: historyTarget?.title ?? contribution.initialSnapshot.accessibleLabel,
      iconKey: historyTarget?.iconKey ?? recipe?.iconKey ?? contribution.initialSnapshot.iconKey,
      resourceId: historyTarget?.id ?? contribution.initialSnapshot.resourceId,
    }));
    return itemId;
  }, [setInitialSnapshot, workbench]);
  const {
    canCreate: canCreateContribution,
    create: createContributionItem,
    creationFailure,
    dismissCreationFailure,
    retryCreation,
    preparingKinds,
  } = useAuxiliaryWorkbenchContributions({
    contributions,
    items: workbench.items,
    onReserve: reserveContributionItem,
    onCommit: commitContributionItem,
  });
  const hosts = usePersistentTerminalSessionHosts(itemIds);
  const agentChatContribution = contributionByKind.get(AGENT_CHAT_WORKBENCH_ITEM_KIND) ?? null;
  const agentChatHistory = agentChatContribution?.history ?? null;
  const agentLauncherMode = agentChatContribution ? "chat" : "terminal";
  const registeredChatRecipes = agentChatContribution?.creationRecipes ?? EMPTY_CHAT_RECIPES;
  const chatPreparing = preparingKinds.has(AGENT_CHAT_WORKBENCH_ITEM_KIND);
  const openAgentSessionIds = useMemo(() => Array.from(snapshotById.values()).flatMap(
    (snapshot) => snapshot.resourceId ? [snapshot.resourceId] : [],
  ), [snapshotById]);

  const presentedTerminalSessions = useMemo(() => workbench.presentedItemIds.flatMap(
    (itemId) => {
      const session = workbench.terminalById.get(itemId);
      return session ? [session] : [];
    },
  ), [workbench.presentedItemIds, workbench.terminalById]);
  const launcherVisible = active && (
    workbench.items.length === 0
    || presentedTerminalSessions.some((session) => (
      session.status === "selecting" || session.status === "starting"
    ))
  );
  const {
    ids: availableAgentIds,
    phase: agentDiscoveryPhase,
    refresh: refreshAvailableAgents,
  } = useTerminalAgentLocator({ enabled: launcherVisible });
  const visibleAgentIds = useMemo(() => {
    const hidden = new Set(hiddenAgentIds);
    return availableAgentIds.filter((agentId) => !hidden.has(agentId));
  }, [availableAgentIds, hiddenAgentIds]);
  const chatRecipes = useMemo(
    () => filterAgentChatCreationRecipesByLocalAgentIds(registeredChatRecipes, visibleAgentIds),
    [registeredChatRecipes, visibleAgentIds],
  );
  const canCreateChat = Boolean(agentChatContribution && chatRecipes.some((recipe) => (
    canCreateContribution(agentChatContribution, recipe)
  )));
  const canLaunch = useCallback((launcherId: DesktopTerminalLauncherId) => (
    terminalEnabled && (
      launcherId === "shell"
      || (
        agentLauncherMode === "terminal"
        && visibleAgentIds.some((agentId) => agentId === launcherId)
      )
    )
  ), [agentLauncherMode, terminalEnabled, visibleAgentIds]);
  const resolveCloseTarget = useCallback((itemId: string): AuxiliaryWorkbenchCloseTarget | null => {
    const item = itemById.get(itemId);
    const snapshot = snapshotById.get(itemId);
    if (!item || !snapshot) return null;
    const context = Object.freeze({ item, snapshot });
    if (item.kind === TERMINAL_WORKBENCH_ITEM_KIND) {
      const session = workbench.terminalById.get(itemId);
      if (!session) return null;
      return Object.freeze({
        context,
        adapter: Object.freeze({
          decide: (): AuxiliaryWorkbenchCloseDecision => (
            getTerminalClosePolicy(session.status) === "close"
              ? CLOSE_NOW
              : Object.freeze({
                  kind: "confirm",
                  tone: "danger",
                  dialog: Object.freeze({
                    title: t("terminal.closeDialog.title", { title: snapshot.title }),
                    detail: t("terminal.closeDialog.detail"),
                    actionLabel: t("terminal.closeDialog.confirm"),
                  }),
                })
          ),
          commit: () => workbench.commitCloseTerminal(itemId),
        }),
      });
    }
    const contribution = contributionByKind.get(item.kind);
    return contribution ? Object.freeze({ context, adapter: contribution.close }) : null;
  }, [contributionByKind, itemById, snapshotById, t, workbench]);
  const closeCoordinator = useAuxiliaryWorkbenchCloseCoordinator({
    resolveTarget: resolveCloseTarget,
    onClosed: workbench.removeItem,
  });
  const createDetectedTerminal = useCallback((launcherId: DesktopTerminalLauncherId) => {
    if (terminalEnabled && canLaunch(launcherId)) {
      workbench.createTerminal(currentRoot, launcherId);
    }
  }, [canLaunch, currentRoot, terminalEnabled, workbench]);
  const launchDetectedTerminal = useCallback((
    itemId: string,
    launcherId: DesktopTerminalLauncherId,
  ) => {
    if (terminalEnabled && canLaunch(launcherId)) workbench.launchTerminal(itemId, launcherId);
  }, [canLaunch, terminalEnabled, workbench]);
  const createChat = useCallback((
    recipe: AuxiliaryWorkbenchCreationRecipe,
    targetGroupId: string | null = workbench.activeGroup?.id ?? null,
  ) => (
    agentChatContribution
      ? createContributionItem(agentChatContribution, targetGroupId, recipe)
      : null
  ), [agentChatContribution, createContributionItem, workbench.activeGroup?.id]);
  const createChatFromLauncher = useCallback(async (
    launcherItemId: string,
    recipe: AuxiliaryWorkbenchCreationRecipe,
  ) => {
    if (!agentChatContribution) return;
    const targetGroupId = workbench.groups.find(
      (group) => group.itemIds.includes(launcherItemId),
    )?.id ?? null;
    const createdItemId = await createContributionItem(
      agentChatContribution,
      targetGroupId,
      recipe,
    );
    if (createdItemId) await closeCoordinator.requestClose(launcherItemId);
  }, [agentChatContribution, closeCoordinator, createContributionItem, workbench.groups]);
  const restoreChat = useCallback(async (
    target: AuxiliaryWorkbenchHistoryTarget,
    targetGroupId: string | null,
    launcherItemId: string | null = null,
  ) => {
    if (!agentChatContribution) return false;
    const createdItemId = await createContributionItem(
      agentChatContribution,
      targetGroupId,
      null,
      target,
    );
    if (!createdItemId) return false;
    if (launcherItemId) await closeCoordinator.requestClose(launcherItemId);
    return true;
  }, [agentChatContribution, closeCoordinator, createContributionItem]);

  useEffect(() => {
    if (!presentedTerminalSessions.some((session) => session.launchError)) return;
    void refreshAvailableAgents();
  }, [presentedTerminalSessions, refreshAvailableAgents]);

  const getItemMinimum = useCallback((itemId: string): WorkbenchSplitMinimumSize => {
    const item = itemById.get(itemId);
    const contribution = item ? contributionByKind.get(item.kind) : null;
    if (contribution) return contribution.minimumSize;
    return terminalLeafMinimumSize(
      workbench.runtimeRegistry.get(itemId)?.getMinimumViewportSize(),
    );
  }, [contributionByKind, itemById, workbench.runtimeRegistry]);
  const getGroupMinimum = useCallback((groupId: string): WorkbenchSplitMinimumSize => {
    const group = workbench.groups.find((candidate) => candidate.id === groupId);
    return maximumMinimum(group?.itemIds.map(getItemMinimum) ?? []);
  }, [getItemMinimum, workbench.groups]);

  const canDropItem = useCallback((
    sourceItemId: string,
    targetGroupId: string,
    edge: WorkbenchSplitDropEdge,
    targetGroupPane: HTMLElement,
  ) => {
    const sourceGroup = workbench.groups.find((group) => group.itemIds.includes(sourceItemId));
    const targetGroup = workbench.groups.find((group) => group.id === targetGroupId);
    if (!sourceGroup || !targetGroup || !workbench.itemCanSplit(sourceItemId, targetGroupId)) {
      return false;
    }
    if (sourceGroup.id !== targetGroup.id && sourceGroup.itemIds.length === 1) return true;
    const targetItemIds = targetGroup.itemIds.filter((itemId) => itemId !== sourceItemId);
    return canPlaceTerminalSplit(
      targetGroupPane.getBoundingClientRect(),
      edge,
      getItemMinimum(sourceItemId),
      maximumMinimum(targetItemIds.map(getItemMinimum)),
    );
  }, [getItemMinimum, workbench]);

  const itemMove = useTerminalTabMoveDrag({
    canDrop: canDropItem,
    canInsert: workbench.itemCanInsert,
    canMergeGroup: workbench.groupCanMerge,
    canMoveGroup: workbench.groupCanMove,
    onInsertSession: workbench.mergeItem,
    onMergeGroup: workbench.mergeGroup,
    onMoveGroup: workbench.moveGroup,
    onMoveSession: workbench.splitItem,
  });
  const moveItemByKeyboard = useCallback((
    sourceItemId: string,
    targetGroupId: string,
    edge: WorkbenchSplitDropEdge,
  ) => {
    const targetPane = panelRef.current?.querySelector<HTMLElement>(
      `[data-terminal-content-drop-group-id="${targetGroupId}"]`,
    );
    if (targetPane && canDropItem(sourceItemId, targetGroupId, edge, targetPane)) {
      workbench.splitItem(sourceItemId, targetGroupId, edge);
    }
  }, [canDropItem, workbench]);

  useTerminalAppearanceSync(panelRef, workbench.runtimeRegistry);
  return (
    <section
      ref={panelRef}
      className="desktop-terminal-panel"
      data-terminal-appearance-source
      aria-label={t("terminal.title")}
    >
      <div className={`desktop-terminal-body ${workbench.items.length === 0 ? "is-empty" : ""}`}>
        {creationFailure && (
          <TerminalWorkbenchCreationFailure
            failure={creationFailure}
            onDismiss={dismissCreationFailure}
            onRetry={() => { void retryCreation(); }}
          />
        )}
        {workbench.items.length === 0 ? (
          <TerminalLauncher
            agentMode={agentLauncherMode}
            discoveryPhase={agentDiscoveryPhase}
            availableAgentIds={visibleAgentIds}
            chatCreationAvailable={canCreateChat}
            chatPreparing={chatPreparing}
            chatRecipes={chatRecipes}
            history={agentChatHistory}
            historyRootId={workspace.id}
            historyRootPath={workspace.path}
            excludedHistoryResourceIds={openAgentSessionIds}
            onCreateChat={agentChatContribution
              ? (recipe) => { if (!chatPreparing) void createChat(recipe, null); }
              : undefined}
            onLaunch={createDetectedTerminal}
            onRestoreHistoryTarget={(target) => restoreChat(target, null)}
            onRefresh={() => void refreshAvailableAgents()}
            terminalEnabled={terminalEnabled}
          />
        ) : workbench.root ? (
          <TerminalWorkbenchViewport
            activeGroupId={workbench.activeGroup?.id ?? null}
            dropIntent={itemMove.dropIntent}
            getLeafMinimum={getGroupMinimum}
            groups={workbench.groups}
            headerItems={headerItems}
            hosts={hosts}
            root={workbench.root}
            itemMove={itemMove}
            onActivateItem={workbench.activateItem}
            onCloseItem={(itemId) => { void closeCoordinator.requestClose(itemId); }}
            onCreateItem={(groupId) => workbench.createTerminalLauncher(currentRoot, groupId)}
            onMoveByKeyboard={moveItemByKeyboard}
            onResizeSplit={workbench.resizeSplit}
          />
        ) : null}
        {workbench.items.map((item) => createPortal(
          item.kind === TERMINAL_WORKBENCH_ITEM_KIND ? (
            workbench.terminalById.get(item.id) ? (
              <TerminalSessionHost
                agentMode={agentLauncherMode}
                discoveryPhase={agentDiscoveryPhase}
                availableAgentIds={visibleAgentIds}
                chatCreationAvailable={canCreateChat}
                chatPreparing={chatPreparing}
                chatRecipes={chatRecipes}
                history={agentChatHistory}
                historyRootId={workspace.id}
                excludedHistoryResourceIds={openAgentSessionIds}
                focused={active && workbench.activeItemId === item.id}
                onFocus={() => {
                  setFocusedItemId(item.id);
                  workbench.activateItem(item.id);
                }}
                onLaunch={(launcherId) => launchDetectedTerminal(item.id, launcherId)}
                onCreateChat={agentChatContribution
                  ? (recipe) => { void createChatFromLauncher(item.id, recipe); }
                  : undefined}
                onRestoreHistoryTarget={(target) => {
                  const targetGroupId = workbench.groups.find(
                    (group) => group.itemIds.includes(item.id),
                  )?.id ?? null;
                  return restoreChat(target, targetGroupId, item.id);
                }}
                onRefresh={() => void refreshAvailableAgents()}
                presented={active && presentedItemIdSet.has(item.id)}
                runtime={workbench.runtimeRegistry.get(item.id)}
                session={workbench.terminalById.get(item.id)!}
                terminalEnabled={terminalEnabled}
                workspacePath={item.rootId}
              />
            ) : null
          ) : contributionByKind.get(item.kind) ? (
            <TerminalContributionItemHost
              contribution={contributionByKind.get(item.kind)!}
              item={item}
              sidebarVisible={active}
              presented={active && presentedItemIdSet.has(item.id)}
              commandTarget={active && workbench.activeItemId === item.id}
              domFocused={focusedItemId === item.id}
              peerSnapshots={snapshotById}
              onActivate={workbench.activateItem}
              onFocus={setFocusedItemId}
              onPresentationChange={updateSnapshot}
            />
          ) : null,
          hosts.get(item.id)!,
          item.id,
        ))}
      </div>
      {closeCoordinator.pending && (
        <AuxiliaryWorkbenchCloseDialog
          pending={closeCoordinator.pending}
          committing={closeCoordinator.committing}
          onDismiss={closeCoordinator.dismiss}
          onConfirm={() => { void closeCoordinator.confirm(); }}
        />
      )}
    </section>
  );
}

function maximumMinimum(
  values: readonly WorkbenchSplitMinimumSize[],
): WorkbenchSplitMinimumSize {
  if (values.length === 0) return terminalLeafMinimumSize(null);
  return Object.freeze(values.reduce((maximum, value) => ({
    width: Math.max(maximum.width, value.width),
    height: Math.max(maximum.height, value.height),
  }), { width: 1, height: 1 }));
}
