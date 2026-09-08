import {
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  isWorkbenchSplit,
  workbenchSplitNodeMinimumSize,
  type AuxiliaryWorkbenchGroup,
  type AuxiliaryWorkbenchLayoutNode,
  type AuxiliaryWorkbenchLayoutSplit,
  type WorkbenchSplitDropEdge,
  type WorkbenchSplitMinimumSize,
} from "@puppyone/shared-ui";
import type { WorkbenchTabMoveDragController } from "./interactions/useWorkbenchTabMoveDrag";
import {
  partitionWorkbenchGroupDropIntent,
  type WorkbenchTabMoveDropIntent,
} from "./workbenchTabMove";
import { WORKBENCH_SPLIT_DIVIDER_SIZE } from "./workbenchSplitConstraints";
import { WorkbenchGroupPane } from "./WorkbenchGroupPane";
import { WorkbenchSplitResizeHandle } from "./WorkbenchSplitResizeHandle";
import { workbenchPanelId, workbenchTabId } from "./workbenchSessionHeaderIds";
import type { AuxiliaryWorkbenchHeaderItem } from "./AuxiliaryWorkbenchHeader.types";
import { AuxiliaryWorkbenchGroupMoveHandle } from "./AuxiliaryWorkbenchGroupMoveHandle";
import { AuxiliaryWorkbenchHeader } from "./AuxiliaryWorkbenchHeader";
import { AuxiliaryWorkbenchItemHostSlot } from "./AuxiliaryWorkbenchItemHostSlot";

export type AuxiliaryWorkbenchViewportProps = Readonly<{
  activeGroupId: string | null;
  dropIntent: WorkbenchTabMoveDropIntent | null;
  getLeafMinimum: (groupId: string) => WorkbenchSplitMinimumSize;
  groups: readonly AuxiliaryWorkbenchGroup[];
  headerItems: readonly AuxiliaryWorkbenchHeaderItem[];
  hosts: ReadonlyMap<string, HTMLDivElement>;
  root: AuxiliaryWorkbenchLayoutNode;
  itemMove: WorkbenchTabMoveDragController;
  onActivateItem: (itemId: string) => void;
  onCloseItem: (itemId: string) => void;
  onCreateItem: (groupId: string) => void;
  onMoveByKeyboard: (
    itemId: string,
    targetGroupId: string,
    edge: WorkbenchSplitDropEdge,
  ) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
}>;

export function AuxiliaryWorkbenchViewport(props: AuxiliaryWorkbenchViewportProps) {
  const groupById = useMemo(
    () => new Map(props.groups.map((group) => [group.id, group])),
    [props.groups],
  );
  const headerItemById = useMemo(
    () => new Map(props.headerItems.map((item) => [item.id, item])),
    [props.headerItems],
  );
  return (
    <div className="desktop-terminal-group-viewport">
      <AuxiliaryWorkbenchLayoutNode
        {...props}
        groupById={groupById}
        headerItemById={headerItemById}
        node={props.root}
      />
    </div>
  );
}

type LayoutNodeProps = AuxiliaryWorkbenchViewportProps & Readonly<{
  groupById: ReadonlyMap<string, AuxiliaryWorkbenchGroup>;
  headerItemById: ReadonlyMap<string, AuxiliaryWorkbenchHeaderItem>;
  node: AuxiliaryWorkbenchLayoutNode;
}>;

function AuxiliaryWorkbenchLayoutNode(props: LayoutNodeProps): ReactNode {
  if (!isWorkbenchSplit(props.node)) {
    const group = props.groupById.get(props.node.groupId);
    return group ? <AuxiliaryWorkbenchGroupLeaf {...props} group={group} /> : null;
  }
  return <AuxiliaryWorkbenchSplit {...props} split={props.node} />;
}

function AuxiliaryWorkbenchGroupLeaf({
  activeGroupId,
  dropIntent,
  group,
  headerItemById,
  hosts,
  itemMove,
  onActivateItem,
  onCloseItem,
  onCreateItem,
  onMoveByKeyboard,
}: LayoutNodeProps & { group: AuxiliaryWorkbenchGroup }) {
  const headerItems = group.itemIds
    .map((itemId) => headerItemById.get(itemId))
    .filter((item): item is AuxiliaryWorkbenchHeaderItem => Boolean(item));
  const dropZones = partitionWorkbenchGroupDropIntent(dropIntent, group.id);
  const activeItem = headerItemById.get(group.activeItemId);
  const host = hosts.get(group.activeItemId);

  return (
    <WorkbenchGroupPane
      contentDropIntent={dropZones.content}
      focused={activeGroupId === group.id}
      groupId={group.id}
      header={<AuxiliaryWorkbenchHeader
        activeItemId={group.activeItemId}
        dropInsertion={dropZones.tabBar}
        groupId={group.id}
        items={headerItems}
        onActivate={onActivateItem}
        onClose={onCloseItem}
        onCreate={() => onCreateItem(group.id)}
        onMoveByKeyboard={(itemId, edge) => onMoveByKeyboard(itemId, group.id, edge)}
        presentedItemIds={[group.activeItemId]}
        tabMove={itemMove}
      />}
      moveHandle={activeItem ? (
        <AuxiliaryWorkbenchGroupMoveHandle
          groupId={group.id}
          itemId={activeItem.id}
          itemIds={group.itemIds}
          label={activeItem.snapshot.title}
          itemMove={itemMove}
          onActivate={onActivateItem}
        />
      ) : null}
    >
      {activeItem && host && (
        <AuxiliaryWorkbenchItemHostSlot
          focused={activeGroupId === group.id}
          host={host}
          labelledBy={workbenchTabId(activeItem.id)}
          panelId={workbenchPanelId(activeItem.id)}
          itemId={activeItem.id}
        />
      )}
    </WorkbenchGroupPane>
  );
}

function AuxiliaryWorkbenchSplit({
  node: _node,
  split,
  ...props
}: LayoutNodeProps & { split: AuxiliaryWorkbenchLayoutSplit }) {
  const getMinimum = (node: AuxiliaryWorkbenchLayoutNode) => workbenchSplitNodeMinimumSize(
    node,
    (leaf) => props.getLeafMinimum(leaf.groupId),
    WORKBENCH_SPLIT_DIVIDER_SIZE,
  );
  const firstMinimum = getMinimum(split.first);
  const secondMinimum = getMinimum(split.second);
  const style = {
    "--desktop-terminal-first-track": `${split.ratio}fr`,
    "--desktop-terminal-second-track": `${1 - split.ratio}fr`,
  } as CSSProperties;

  return (
    <div
      className="desktop-terminal-split"
      data-direction={split.direction}
      data-terminal-split-id={split.id}
      style={style}
    >
      <AuxiliaryWorkbenchLayoutNode key={split.first.id} {...props} node={split.first} />
      <WorkbenchSplitResizeHandle
        key={split.id}
        direction={split.direction}
        firstMinimum={firstMinimum}
        secondMinimum={secondMinimum}
        ratio={split.ratio}
        splitId={split.id}
        onCommit={props.onResizeSplit}
      />
      <AuxiliaryWorkbenchLayoutNode key={split.second.id} {...props} node={split.second} />
    </div>
  );
}
