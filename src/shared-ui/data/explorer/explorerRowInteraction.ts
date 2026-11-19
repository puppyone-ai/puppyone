export type ExplorerRowDropState = {
  rowPath: string | null;
  mode: "folder" | "parent";
  valid: boolean;
} | null;

/** The host owns menu lifetime and trigger identity; the tree only projects it. */
export type ExplorerRowActionMenu = Readonly<{
  /** null identifies the optional synthetic root row. */
  path: string | null;
  trigger: string;
}>;

export type ExplorerRowStateSources = {
  activePath: string | null;
  openActionMenu: ExplorerRowActionMenu | null;
  selectedPaths: ReadonlySet<string>;
  cutPaths: ReadonlySet<string>;
  loadingPaths: ReadonlySet<string>;
  draggedPaths: ReadonlySet<string>;
  dropTarget: ExplorerRowDropState;
};

export type ExplorerRowInteractionState = {
  active: boolean;
  openMenuTrigger: string | null;
  selected: boolean;
  cut: boolean;
  loading: boolean;
  dragging: boolean;
  dropOver: boolean;
  dropParentOver: boolean;
  dropInvalid: boolean;
};

/** Pure mounted-row selector. React.memo compares its primitive result, so a
 * normal selection re-renders only the old and new rows without mutating an
 * external store during React render. */
export function selectExplorerRowInteraction(
  path: string,
  sources: ExplorerRowStateSources,
): ExplorerRowInteractionState {
  const dropMatchesRow = sources.dropTarget?.rowPath === path;
  return {
    active: sources.activePath === path,
    openMenuTrigger: sources.openActionMenu?.path === path ? sources.openActionMenu.trigger : null,
    selected: sources.selectedPaths.has(path),
    cut: isPathInSetOrDescendant(path, sources.cutPaths),
    loading: sources.loadingPaths.has(path),
    dragging: sources.draggedPaths.has(path),
    dropOver: Boolean(dropMatchesRow && sources.dropTarget?.mode === "folder" && sources.dropTarget.valid),
    dropParentOver: Boolean(dropMatchesRow && sources.dropTarget?.mode === "parent" && sources.dropTarget.valid),
    dropInvalid: Boolean(dropMatchesRow && !sources.dropTarget?.valid),
  };
}

export function equalExplorerRowInteraction(
  left: ExplorerRowInteractionState,
  right: ExplorerRowInteractionState,
): boolean {
  return left.active === right.active
    && left.openMenuTrigger === right.openMenuTrigger
    && left.selected === right.selected
    && left.cut === right.cut
    && left.loading === right.loading
    && left.dragging === right.dragging
    && left.dropOver === right.dropOver
    && left.dropParentOver === right.dropParentOver
    && left.dropInvalid === right.dropInvalid;
}

function isPathInSetOrDescendant(path: string, paths: ReadonlySet<string>): boolean {
  let candidate = path;
  while (candidate) {
    if (paths.has(candidate)) return true;
    const separatorIndex = candidate.lastIndexOf("/");
    if (separatorIndex < 0) return false;
    candidate = candidate.slice(0, separatorIndex);
  }
  return false;
}
