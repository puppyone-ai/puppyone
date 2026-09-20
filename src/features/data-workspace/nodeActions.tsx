import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderPlus,
  MoreVertical,
  Pencil,
  Plus,
  Scissors,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  createDefaultContextMapDocumentContent,
  createDefaultPuppyFlowDocument,
  FileGlyphIcon,
  getMatchedExtension,
  serializePuppyFlowDocument,
  STANDARD_CONTROL_SIZE,
  type DataNode,
  type FileIconThemeId,
  type PuppyFlowDocumentDefaults,
  useCssPixelCustomProperty,
} from "@puppyone/shared-ui";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopDialogCloseButton, DesktopDialogRoot } from "../../components/DesktopDialog";
import { DesktopMenuItem, DesktopMenuSeparator, DesktopMenuSurface } from "../../components/DesktopMenu";
import {
  DesktopSidebarActionMenu,
  resolveDesktopSidebarActionMenuPosition,
} from "../../components/DesktopSidebarActionMenu";
import {
  CREATE_NEW_SUBMENU_ID,
  type CreateNewItemId,
  type CreateNewMainMenuEntry,
  type ExperimentalSettings,
} from "../../preferences";
import { createUnconfiguredAppPreviewManifestContent } from "../../../shared/appPreviewManifest.js";
import { useDesktopPlatformCapabilities } from "../../platform/useDesktopPlatformCapabilities";
import {
  getConfiguredCreateEntryMenuItems,
  getCreateEntryMenuItem,
  type CreateEntryMenuItemDefinition,
  type CreateEntryMenuItemKind,
} from "../create-new/createEntryMenuRegistry";

export type DesktopCreateEntryKind = CreateEntryMenuItemKind;
export type DesktopCreateEntryAnchor = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  placement?: "below-start" | "below-end" | "above-start" | "above-end" | "auto-start" | "auto-end";
};
export type DesktopCreateEntryAnchorInput = DOMRect | DesktopCreateEntryAnchor;
export type DesktopCreateEntryDraft = {
  parentPath: string | null;
  anchor: DesktopCreateEntryAnchor;
  error: DesktopNodeActionError | null;
  creatingKind: DesktopCreateEntryKind | null;
  selectedKind: DesktopCreateEntryKind | null;
  name: string;
};
export type DesktopNodeActionMenuDraft = {
  node: DataNode;
  nodes: DataNode[];
  anchor: DesktopCreateEntryAnchor;
  mode: "actions" | "rename";
  renameNameValue: string;
  renameExtensionValue: string;
  renameFocus: "name" | "type";
  error: DesktopNodeActionError | null;
  operation: "rename" | "delete" | "open" | "reveal" | "paste" | "duplicate" | null;
};

export type DesktopNodeActionError = Readonly<
  | { code: "name-required" }
  | { code: "name-invalid" }
  | { code: "name-unsupported" }
  | { code: "operation-failed"; detail: string }
  | { code: "delete-partial"; deletedCount: number; failedCount: number; detail: string }
>;

const CREATE_ENTRY_MENU_MARGIN = 12;
const CREATE_ENTRY_MENU_WIDTH = 184;
const CREATE_ENTRY_SUBMENU_WIDTH = 184;
const CREATE_ENTRY_SUBMENU_GAP = 4;
const NODE_ACTION_MENU_WIDTH = 224;
const MENU_SEPARATOR_BLOCK_SIZE = 9;
const MENU_ERROR_BLOCK_SIZE = 21;
const DEFAULT_MENU_PADDING = 4;

export function DesktopExplorerRowActions({
  node,
  parentPath,
  onCreate,
  onOpenNodeMenu,
  onRemoveWorkspaceRoot,
  showMoreActions = true,
}: {
  node?: DataNode;
  parentPath: string | null;
  onCreate: (parentPath: string | null, anchorRect: DOMRect) => void;
  onOpenNodeMenu: (node: DataNode, anchorRect: DOMRect) => void;
  onRemoveWorkspaceRoot?: (node: DataNode) => void;
  showMoreActions?: boolean;
}) {
  const { t } = useLocalization();
  const canCreate = node?.type === "folder" || !node;

  return (
    <>
      {canCreate && (
        <button
          className="tree-row-action-button"
          type="button"
          title={t("workspace.node.createNew")}
          aria-label={t("workspace.node.createNew")}
          onClick={(event) => onCreate(parentPath, event.currentTarget.getBoundingClientRect())}
        >
          <Plus aria-hidden="true" />
        </button>
      )}
      {node && showMoreActions && (
        <button
          className="tree-row-action-button"
          type="button"
          title={t("workspace.node.moreActions")}
          aria-label={t("workspace.node.moreActionsFor", { name: bidiIsolate(node.name) })}
          onClick={(event) => onOpenNodeMenu(node, event.currentTarget.getBoundingClientRect())}
        >
          <MoreVertical aria-hidden="true" />
        </button>
      )}
      {node?.workspaceFolderRoot && onRemoveWorkspaceRoot && (
        <button
          className="tree-row-action-button"
          type="button"
          title={t("shell.workspaceSwitcher.removeProject")}
          aria-label={t("shell.workspaceSwitcher.removeProjectNamed", { name: bidiIsolate(node.name) })}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveWorkspaceRoot(node);
          }}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </>
  );
}

export function DesktopCreateEntryMenu({
  draft,
  mainEntries,
  submenuItemKinds,
  fileIconTheme,
  onCancel,
  onSelectKind,
}: {
  draft: DesktopCreateEntryDraft;
  mainEntries: readonly CreateNewMainMenuEntry[];
  submenuItemKinds: readonly CreateNewItemId[];
  fileIconTheme?: FileIconThemeId | null;
  onCancel: () => void;
  onSelectKind: (kind: DesktopCreateEntryKind) => void;
}) {
  const { t } = useLocalization();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuRowHeight = useCssPixelCustomProperty(
    menuRef,
    "--po-menu-item-height",
    STANDARD_CONTROL_SIZE,
  );
  const menuPadding = useCssPixelCustomProperty(
    menuRef,
    "--po-menu-padding",
    DEFAULT_MENU_PADDING,
  );
  const submenuCloseTimerRef = useRef<number | null>(null);
  const suppressSubmenuFocusOpenRef = useRef(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const submenuOptions = getConfiguredCreateEntryMenuItems(submenuItemKinds);
  const sidebarLauncher = draft.anchor.placement === "auto-end";
  const menuWidth = sidebarLauncher
    ? Math.max(CREATE_ENTRY_MENU_WIDTH, draft.anchor.width)
    : CREATE_ENTRY_MENU_WIDTH;
  const menuRowCount = 1 + mainEntries.length;
  const separatorCount = Number(mainEntries.length > 0);
  const estimatedHeight = (menuPadding * 2)
    + (menuRowCount * menuRowHeight)
    + (separatorCount * MENU_SEPARATOR_BLOCK_SIZE);
  const position = getCreateEntryMenuPosition(draft.anchor, menuWidth, estimatedHeight);
  const documentDirection = document.documentElement.dir === "rtl" ? "rtl" : "ltr";
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const logicalEndSpace = documentDirection === "rtl"
    ? position.left - CREATE_ENTRY_MENU_MARGIN
    : viewportWidth - (position.left + menuWidth) - CREATE_ENTRY_MENU_MARGIN;
  const submenuSide = logicalEndSpace >= CREATE_ENTRY_SUBMENU_WIDTH + CREATE_ENTRY_SUBMENU_GAP
    ? "end"
    : "start";
  const menuStyle = {
    "--node-action-menu-left": `${position.left}px`,
    "--node-action-menu-top": `${position.top}px`,
    "--node-action-menu-width": `${menuWidth}px`,
  } as CSSProperties;

  const clearSubmenuCloseTimer = () => {
    if (submenuCloseTimerRef.current === null) return;
    window.clearTimeout(submenuCloseTimerRef.current);
    submenuCloseTimerRef.current = null;
  };
  const openSubmenu = () => {
    clearSubmenuCloseTimer();
    setSubmenuOpen(true);
  };
  const closeSubmenu = () => {
    clearSubmenuCloseTimer();
    setSubmenuOpen(false);
  };
  const scheduleCloseSubmenu = () => {
    clearSubmenuCloseTimer();
    submenuCloseTimerRef.current = window.setTimeout(() => {
      submenuCloseTimerRef.current = null;
      setSubmenuOpen(false);
    }, 180);
  };
  const focusSubmenu = () => {
    openSubmenu();
    window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(".desktop-create-entry-submenu button:not(:disabled)")
        ?.focus();
    });
  };
  const focusSubmenuTrigger = () => {
    const trigger = menuRef.current
      ?.querySelector<HTMLButtonElement>(".desktop-create-entry-submenu-trigger");
    if (!trigger) return;
    if (document.activeElement === trigger) {
      suppressSubmenuFocusOpenRef.current = false;
      return;
    }
    suppressSubmenuFocusOpenRef.current = true;
    trigger.focus();
  };

  useEffect(() => {
    if (sidebarLauncher) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sidebarLauncher]);

  useEffect(() => {
    return () => clearSubmenuCloseTimer();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (submenuOpen) {
        event.preventDefault();
        if (submenuCloseTimerRef.current !== null) {
          window.clearTimeout(submenuCloseTimerRef.current);
          submenuCloseTimerRef.current = null;
        }
        setSubmenuOpen(false);
        const trigger = menuRef.current
          ?.querySelector<HTMLButtonElement>(".desktop-create-entry-submenu-trigger");
        if (trigger && document.activeElement !== trigger) {
          suppressSubmenuFocusOpenRef.current = true;
          trigger.focus();
        } else {
          suppressSubmenuFocusOpenRef.current = false;
        }
        return;
      }
      onCancel();
    };
    const handleViewportChange = () => onCancel();

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [submenuOpen, onCancel]);

  return (
    <DesktopMenuSurface
      ref={menuRef}
      className="desktop-create-entry-menu desktop-node-action-menu"
      id={sidebarLauncher ? "desktop-sidebar-create-menu" : undefined}
      ariaLabel={t("workspace.node.createNew")}
      data-sidebar-launcher={sidebarLauncher ? "true" : undefined}
      style={menuStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <DesktopNodeActionMenuItem
        icon={<CreateEntryGlyph option={getCreateEntryMenuItem("folder")} theme={fileIconTheme} />}
        label={getCreateEntryOptionLabel("folder", t)}
        onClick={() => onSelectKind("folder")}
      />
      {mainEntries.length > 0 && <DesktopMenuSeparator />}
      {mainEntries.map((entry) => {
        if (entry !== CREATE_NEW_SUBMENU_ID) {
          const option = getCreateEntryMenuItem(entry);
          return (
            <DesktopNodeActionMenuItem
              key={option.kind}
              icon={<CreateEntryGlyph option={option} theme={fileIconTheme} />}
              label={getCreateEntryOptionLabel(option.kind, t)}
              onClick={() => onSelectKind(option.kind)}
            />
          );
        }
        return (
          <div
            className="desktop-create-entry-submenu-wrap"
            data-open={submenuOpen ? "true" : "false"}
            data-submenu-side={submenuSide}
            key={entry}
            onPointerEnter={openSubmenu}
            onPointerLeave={scheduleCloseSubmenu}
            onFocus={() => {
              if (suppressSubmenuFocusOpenRef.current) {
                suppressSubmenuFocusOpenRef.current = false;
                return;
              }
              openSubmenu();
            }}
            onBlur={(event) => {
              const relatedTarget = event.relatedTarget;
              if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
              scheduleCloseSubmenu();
            }}
          >
            <DesktopMenuItem
              className="desktop-node-action-menu-item desktop-create-entry-submenu-trigger"
              icon={<Workflow size={14} />}
              label={t("workspace.node.customFiles")}
              trailing={<ChevronRight className="po-directional-icon" size={14} />}
              aria-controls="desktop-create-entry-custom-submenu"
              aria-haspopup="menu"
              aria-expanded={submenuOpen}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight") return;
                event.preventDefault();
                event.stopPropagation();
                focusSubmenu();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openSubmenu();
              }}
            />
            <DesktopMenuSurface
              id="desktop-create-entry-custom-submenu"
              className="desktop-create-entry-submenu"
              ariaLabel={t("workspace.node.createCustomFile")}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft") return;
                event.preventDefault();
                event.stopPropagation();
                closeSubmenu();
                focusSubmenuTrigger();
              }}
            >
              {submenuOptions.map((option) => (
                <DesktopNodeActionMenuItem
                  key={option.kind}
                  icon={<CreateEntryGlyph option={option} theme={fileIconTheme} />}
                  label={getCreateEntryOptionLabel(option.kind, t)}
                  onClick={() => onSelectKind(option.kind)}
                />
              ))}
            </DesktopMenuSurface>
          </div>
        );
      })}
    </DesktopMenuSurface>
  );
}

export function DesktopCreateEntryDialog({
  draft,
  fileIconTheme,
  onChange,
  onCancel,
  onCreate,
}: {
  draft: DesktopCreateEntryDraft;
  fileIconTheme?: FileIconThemeId | null;
  onChange: Dispatch<SetStateAction<DesktopCreateEntryDraft | null>>;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const { t } = useLocalization();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedKind = draft.selectedKind;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && draft.creatingKind === null) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [draft.creatingKind, onCancel]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.select());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!selectedKind) return null;

  const selectedOption = getCreateEntryMenuItem(selectedKind);
  const optionLabel = getCreateEntryOptionLabel(selectedKind, t);
  const errorMessage = formatDesktopNodeActionError(draft.error, t);

  return (
    <DesktopDialogRoot
      onClose={onCancel}
      dismissOnBackdrop={draft.creatingKind === null}
    >
      <form
        className="desktop-dialog-surface desktop-file-dialog desktop-create-entry-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-create-entry-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading file" aria-hidden="true">
              <CreateEntryGlyph option={selectedOption} theme={fileIconTheme} size={16} />
            </span>
            <div>
              <h2 id="desktop-create-entry-title">{getCreateEntryDialogTitle(selectedKind, t)}</h2>
            </div>
          </div>
          <DesktopDialogCloseButton disabled={draft.creatingKind !== null} onClick={onCancel} />
        </header>

        <div
          className="desktop-dialog-body desktop-file-dialog-body"
          data-po-scrollbar="content"
        >
          <div className="desktop-dialog-field">
            <input
              ref={inputRef}
              value={draft.name}
              disabled={draft.creatingKind !== null}
              aria-label={t("workspace.node.kindName", { kind: optionLabel })}
              placeholder={t("workspace.node.kindName", { kind: optionLabel })}
              onChange={(event) => {
                const value = event.target.value;
                onChange((current) => current ? { ...current, name: value, error: null } : current);
              }}
            />
          </div>

          {selectedKind === "slides" && (
            <section className="desktop-slides-template" aria-label={t("workspace.node.create.slides.templateLabel")}>
              <div className="desktop-slides-template-preview" aria-hidden="true">
                <span>{t("workspace.node.create.slides.brand")}</span>
                <strong>{t("workspace.node.create.slides.previewTitle")}</strong>
                <i />
              </div>
              <div className="desktop-slides-template-copy">
                <strong>{t("workspace.node.create.slides.defaultTemplate")}</strong>
                <span>{t("workspace.node.create.slides.defaultTemplateDetail")}</span>
              </div>
              <span className="desktop-slides-template-selected" aria-hidden="true">✓</span>
            </section>
          )}

          {errorMessage && <div className="desktop-dialog-error" dir="auto">{errorMessage}</div>}
        </div>

        <footer className="desktop-dialog-footer">
          <button
            className="desktop-dialog-button"
            type="button"
            disabled={draft.creatingKind !== null}
            onClick={onCancel}
          >
            {t("common.action.cancel")}
          </button>
          <button
            className="desktop-dialog-button primary file"
            type="submit"
            disabled={draft.creatingKind !== null || !draft.name.trim()}
          >
            {draft.creatingKind ? t("workspace.node.creating") : t("workspace.node.create")}
          </button>
        </footer>
      </form>
    </DesktopDialogRoot>
  );
}

export function DesktopNodeActionMenu({
  draft,
  experimentalSettings,
  showRevealInFinder = true,
  showOpenInDefaultApp = true,
  canPaste = false,
  canCopy = true,
  canCut = true,
  canDuplicate = true,
  onChange,
  onCancel,
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
  onCreateInside,
  onRename,
  onDelete,
  onOpenInDefaultApp,
  onRevealInFinder,
}: {
  draft: DesktopNodeActionMenuDraft;
  experimentalSettings?: ExperimentalSettings | null;
  showRevealInFinder?: boolean;
  showOpenInDefaultApp?: boolean;
  canPaste?: boolean;
  canCopy?: boolean;
  canCut?: boolean;
  canDuplicate?: boolean;
  onChange: Dispatch<SetStateAction<DesktopNodeActionMenuDraft | null>>;
  onCancel: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onCreateInside: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenInDefaultApp: () => void;
  onRevealInFinder: () => void;
}) {
  if (draft.mode === "rename") {
    return (
      <DesktopNodeRenameDialog
        draft={draft}
        experimentalSettings={experimentalSettings}
        onChange={onChange}
        onCancel={onCancel}
        onRename={onRename}
      />
    );
  }

  return (
      <DesktopNodeActionPopover
        draft={draft}
        showRevealInFinder={showRevealInFinder}
        showOpenInDefaultApp={showOpenInDefaultApp}
        canPaste={canPaste}
        canCopy={canCopy}
        canCut={canCut}
        canDuplicate={canDuplicate}
        onChange={onChange}
        onCancel={onCancel}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onDuplicate={onDuplicate}
        onCreateInside={onCreateInside}
        onDelete={onDelete}
        onOpenInDefaultApp={onOpenInDefaultApp}
        onRevealInFinder={onRevealInFinder}
      />
  );
}

function DesktopNodeActionPopover({
  draft,
  showRevealInFinder,
  showOpenInDefaultApp,
  canPaste,
  canCopy,
  canCut,
  canDuplicate,
  onChange,
  onCancel,
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
  onCreateInside,
  onDelete,
  onOpenInDefaultApp,
  onRevealInFinder,
}: {
  draft: DesktopNodeActionMenuDraft;
  showRevealInFinder: boolean;
  showOpenInDefaultApp: boolean;
  canPaste: boolean;
  canCopy: boolean;
  canCut: boolean;
  canDuplicate: boolean;
  onChange: Dispatch<SetStateAction<DesktopNodeActionMenuDraft | null>>;
  onCancel: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onCreateInside: () => void;
  onDelete: () => void;
  onOpenInDefaultApp: () => void;
  onRevealInFinder: () => void;
}) {
  const { t } = useLocalization();
  const platformCapabilities = useDesktopPlatformCapabilities();
  const primaryModifier = platformCapabilities?.primaryModifier ?? "control";
  const menuRef = useRef<HTMLDivElement>(null);
  const menuRowHeight = useCssPixelCustomProperty(
    menuRef,
    "--po-menu-item-height",
    STANDARD_CONTROL_SIZE,
  );
  const menuPadding = useCssPixelCustomProperty(
    menuRef,
    "--po-menu-padding",
    DEFAULT_MENU_PADDING,
  );
  const actionCount = Math.max(1, draft.nodes.length);
  const singleNodeAction = actionCount === 1;
  const errorMessage = formatDesktopNodeActionError(draft.error, t);
  const menuRowCount = 4
    + (draft.node.type === "folder" ? 2 : 0)
    + Number(singleNodeAction && showOpenInDefaultApp && draft.node.type !== "folder")
    + Number(singleNodeAction && showRevealInFinder)
    + Number(singleNodeAction)
    + Number(singleNodeAction && draft.node.type !== "folder");
  const separatorCount = 1 + Number(draft.node.type === "folder");
  const estimatedHeight = (menuPadding * 2)
    + (menuRowCount * menuRowHeight)
    + (separatorCount * MENU_SEPARATOR_BLOCK_SIZE)
    + (errorMessage ? MENU_ERROR_BLOCK_SIZE : 0);
  const position = resolveDesktopSidebarActionMenuPosition(
    draft.anchor,
    {
      menuWidth: NODE_ACTION_MENU_WIDTH,
      estimatedHeight,
    },
  );
  const menuStyle = {
    left: `${position.left}px`,
    top: `${position.top}px`,
    width: `${NODE_ACTION_MENU_WIDTH}px`,
  } as CSSProperties;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    const handleViewportChange = () => onCancel();

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onCancel]);

  return (
    <DesktopSidebarActionMenu
      ref={menuRef}
      className="desktop-node-action-menu"
      ariaLabel={t("workspace.node.actionsFor", { name: bidiIsolate(draft.node.name) })}
      style={menuStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {draft.node.type === "folder" && (
        <DesktopNodeActionMenuItem
          icon={<FolderPlus size={14} />}
          label={t("workspace.node.newFileOrFolder")}
          disabled={draft.operation !== null}
          onClick={onCreateInside}
        />
      )}
      {draft.node.type === "folder" && (
        <DesktopNodeActionMenuItem
          icon={<ClipboardPaste size={14} />}
          label={t("workspace.node.pasteIntoFolder")}
          shortcut={getPlatformShortcut("V", primaryModifier)}
          disabled={draft.operation !== null || !canPaste}
          onClick={onPaste}
        />
      )}
      {draft.node.type === "folder" && <DesktopMenuSeparator />}
      <DesktopNodeActionMenuItem
        icon={<Copy size={14} />}
        label={t("workspace.node.copyItems", { count: actionCount })}
        shortcut={getPlatformShortcut("C", primaryModifier)}
        disabled={draft.operation !== null || !canCopy}
        onClick={onCopy}
      />
      <DesktopNodeActionMenuItem
        icon={<Scissors size={14} />}
        label={t("workspace.node.cutItems", { count: actionCount })}
        shortcut={getPlatformShortcut("X", primaryModifier)}
        disabled={draft.operation !== null || !canCut}
        onClick={onCut}
      />
      <DesktopNodeActionMenuItem
        icon={<CopyPlus size={14} />}
        label={draft.operation === "duplicate"
          ? t("workspace.node.duplicating")
          : t("workspace.node.duplicateItems", { count: actionCount })}
        shortcut={getPlatformShortcut("D", primaryModifier)}
        disabled={draft.operation !== null || !canDuplicate}
        onClick={onDuplicate}
      />
      <DesktopMenuSeparator />
      {singleNodeAction && showOpenInDefaultApp && draft.node.type !== "folder" && (
        <DesktopNodeActionMenuItem
          icon={<ExternalLink size={14} />}
          label={draft.operation === "open" ? t("workspace.node.opening") : t("workspace.node.openDefaultApp")}
          disabled={draft.operation !== null}
          onClick={onOpenInDefaultApp}
        />
      )}
      {singleNodeAction && showRevealInFinder && (
        <DesktopNodeActionMenuItem
          icon={<FolderOpen size={14} />}
          label={draft.operation === "reveal" ? t("workspace.node.opening") : t("workspace.node.revealInFinder")}
          disabled={draft.operation !== null}
          onClick={onRevealInFinder}
        />
      )}
      {singleNodeAction && (
        <DesktopNodeActionMenuItem
          icon={<Pencil size={14} />}
          label={t("workspace.node.rename")}
          disabled={draft.operation !== null}
          onClick={() => onChange((current) => current ? {
            ...current,
            mode: "rename",
            renameFocus: "name",
            error: null,
          } : current)}
        />
      )}
      {singleNodeAction && draft.node.type !== "folder" && (
        <DesktopNodeActionMenuItem
          icon={<FileText size={14} />}
          label={t("workspace.node.changeType")}
          disabled={draft.operation !== null}
          onClick={() => onChange((current) => current ? {
            ...current,
            mode: "rename",
            renameFocus: "type",
            error: null,
          } : current)}
        />
      )}
      <DesktopNodeActionMenuItem
        icon={<Trash2 size={14} />}
        label={draft.operation === "delete"
          ? t("workspace.node.deleting")
          : t("workspace.node.deleteItems", { count: actionCount })}
        destructive
        disabled={draft.operation !== null}
        onClick={onDelete}
      />
      {errorMessage && <div className="desktop-node-action-error" dir="auto">{errorMessage}</div>}
    </DesktopSidebarActionMenu>
  );
}

function DesktopNodeRenameDialog({
  draft,
  experimentalSettings,
  onChange,
  onCancel,
  onRename,
}: {
  draft: DesktopNodeActionMenuDraft;
  experimentalSettings?: ExperimentalSettings | null;
  onChange: Dispatch<SetStateAction<DesktopNodeActionMenuDraft | null>>;
  onCancel: () => void;
  onRename: () => void;
}) {
  const { t } = useLocalization();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const isFile = draft.node.type !== "folder";
  const fileTypeOptions = useMemo(
    () => getDesktopFileTypeOptions(draft.renameExtensionValue, t, experimentalSettings),
    [draft.renameExtensionValue, experimentalSettings, t],
  );
  const title = draft.renameFocus === "type" && isFile
    ? t("workspace.node.changeType")
    : t("workspace.node.rename");
  const errorMessage = formatDesktopNodeActionError(draft.error, t);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && draft.operation === null) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [draft.operation, onCancel]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (draft.renameFocus === "type" && isFile) {
        selectRef.current?.focus();
        return;
      }
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draft.renameFocus, isFile]);

  return (
    <DesktopDialogRoot
      onClose={onCancel}
      dismissOnBackdrop={draft.operation === null}
    >
      <form
        className="desktop-dialog-surface desktop-file-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-node-rename-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onRename();
        }}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <div>
              <h2 id="desktop-node-rename-title">{title}</h2>
            </div>
          </div>
          <DesktopDialogCloseButton disabled={draft.operation !== null} onClick={onCancel} />
        </header>

        <div
          className="desktop-dialog-body desktop-file-dialog-body"
          data-po-scrollbar="content"
        >
          <label className="desktop-dialog-field">
            <span>{t("workspace.node.name")}</span>
            <input
              ref={inputRef}
              value={draft.renameNameValue}
              disabled={draft.operation !== null}
              onChange={(event) => {
                const value = event.target.value;
                onChange((current) => current ? { ...current, renameNameValue: value, error: null } : current);
              }}
            />
          </label>
          {isFile && (
            <label className="desktop-dialog-field">
              <span>{t("workspace.node.type")}</span>
              <select
                ref={selectRef}
                value={normalizeDesktopExtension(draft.renameExtensionValue)}
                disabled={draft.operation !== null}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange((current) => current ? {
                    ...current,
                    renameExtensionValue: value,
                    renameFocus: "type",
                    error: null,
                  } : current);
                }}
              >
                {fileTypeOptions.map((option) => (
                  <option key={option.extension || "__none__"} value={option.extension}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {errorMessage && <div className="desktop-dialog-error" dir="auto">{errorMessage}</div>}
        </div>

        <footer className="desktop-dialog-footer">
          <button
            className="desktop-dialog-button"
            type="button"
            disabled={draft.operation !== null}
            onClick={onCancel}
          >
            {t("common.action.cancel")}
          </button>
          <button
            className="desktop-dialog-button primary file"
            type="submit"
            disabled={draft.operation !== null || !draft.renameNameValue.trim()}
          >
            {draft.operation === "rename" ? t("workspace.node.saving") : t("common.action.save")}
          </button>
        </footer>
      </form>
    </DesktopDialogRoot>
  );
}

function DesktopNodeActionMenuItem({
  icon,
  label,
  destructive,
  disabled,
  shortcut,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <DesktopMenuItem
      className="desktop-node-action-menu-item"
      destructive={destructive}
      disabled={disabled}
      icon={icon}
      label={label}
      trailing={shortcut}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onClick();
      }}
    />
  );
}

function getPlatformShortcut(key: string, primaryModifier: "meta" | "control"): string {
  return primaryModifier === "meta" ? `⌘${key}` : `Ctrl+${key}`;
}

function CreateEntryGlyph({
  option,
  theme,
  size = 18,
}: {
  option: CreateEntryMenuItemDefinition;
  theme?: FileIconThemeId | null;
  size?: number;
}) {
  return (
    <FileGlyphIcon
      name={option.iconName}
      type={option.iconType}
      size={size}
      theme={theme}
    />
  );
}

type DesktopFileTypeOption = {
  id: string;
  extension: string;
  experimentalSetting?: keyof ExperimentalSettings;
};

const DESKTOP_FILE_TYPE_OPTIONS = [
  { id: "none", extension: "" },
  { id: "markdown", extension: ".md" },
  { id: "contextMap", extension: ".contextmap" },
  { id: "json", extension: ".json" },
  { id: "jsonLines", extension: ".jsonl" },
  { id: "text", extension: ".txt" },
  { id: "csv", extension: ".csv" },
  { id: "html", extension: ".html" },
  { id: "app", extension: ".puppyoneapp" },
  { id: "puppyflow", extension: ".puppyflow", experimentalSetting: "enablePuppyFlowFiles" },
  { id: "javascript", extension: ".js" },
  { id: "typescript", extension: ".ts" },
  { id: "tsx", extension: ".tsx" },
  { id: "yaml", extension: ".yml" },
  { id: "toml", extension: ".toml" },
  { id: "pdf", extension: ".pdf" },
  { id: "png", extension: ".png" },
  { id: "jpeg", extension: ".jpg" },
  { id: "zip", extension: ".zip" },
  { id: "tarball", extension: ".tar.gz" },
] satisfies DesktopFileTypeOption[];

export function getDesktopRenameDraft(node: DataNode): { nameValue: string; extensionValue: string } {
  if (node.type === "folder") return { nameValue: node.name, extensionValue: "" };

  const extension = getDesktopNodeExtension(node.name);
  if (!extension) return { nameValue: node.name, extensionValue: "" };

  return {
    nameValue: node.name.slice(0, -extension.length),
    extensionValue: extension,
  };
}

export function normalizeDesktopRenameName(draft: DesktopNodeActionMenuDraft): string {
  const baseName = draft.renameNameValue.trim();
  validateDesktopNodeName(baseName);

  if (draft.node.type === "folder") return baseName;

  const selectedExtension = normalizeDesktopExtension(draft.renameExtensionValue);
  const currentExtension = getDesktopNodeExtension(draft.node.name);
  const extension = selectedExtension === normalizeDesktopExtension(currentExtension)
    ? currentExtension
    : selectedExtension;
  const normalizedBaseName = extension && baseName.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase())
    ? baseName.slice(0, -extension.length)
    : baseName;
  const nextName = `${normalizedBaseName}${extension}`;
  validateDesktopNodeName(nextName);
  return nextName;
}

export function validateDesktopNodeName(name: string): void {
  if (!name) throw new DesktopNodeNameError("name-required");
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new DesktopNodeNameError("name-invalid");
  }
  if (name.includes("\0")) {
    throw new DesktopNodeNameError("name-unsupported");
  }
}

export function getDesktopFileTypeOptions(
  currentExtension: string,
  t: MessageFormatter,
  experimentalSettings?: ExperimentalSettings | null,
): Array<{ label: string; extension: string }> {
  const extension = normalizeDesktopExtension(currentExtension);
  const options = DESKTOP_FILE_TYPE_OPTIONS
    .filter((option) => !option.experimentalSetting || experimentalSettings?.[option.experimentalSetting] === true)
    .map(({ id, extension: optionExtension }) => ({
      label: t(`workspace.node.fileType.${id}`),
      extension: optionExtension,
    }));
  if (!extension || options.some((option) => option.extension === extension)) return options;

  return [
    options[0],
    { label: t("workspace.node.fileType.current", { extension: bidiIsolate(extension) }), extension },
    ...options.slice(1),
  ];
}

export function normalizeDesktopExtension(value: string): string {
  const trimmed = value.trim().toLocaleLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function getDesktopNodeExtension(name: string): string {
  if (!name) return "";
  if (name.startsWith(".") && name.indexOf(".", 1) === -1) return "";

  const extension = getMatchedExtension(name);
  if (!extension) return "";

  const suffix = `.${extension}`;
  if (!name.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())) return "";
  if (name.length <= suffix.length) return "";
  return name.slice(-suffix.length);
}

export function formatDesktopExtensionLabel(extension: string, t: MessageFormatter): string {
  return extension || t("workspace.node.fileType.noExtensionShort");
}

export function defaultCreateName(kind: DesktopCreateEntryKind, t: MessageFormatter): string {
  return t(`workspace.node.create.kind.${kind}.defaultName`);
}

export type DesktopCreateEntryTemplates = Readonly<{
  csvHeaders: readonly [string, string, string];
  puppyFlow: PuppyFlowDocumentDefaults;
}>;

export function getCreateEntryInitialContent(
  kind: DesktopCreateEntryKind,
  templates: DesktopCreateEntryTemplates,
): string {
  if (kind === "json") return "{}\n";
  if (kind === "contextMap") return createDefaultContextMapDocumentContent();
  if (kind === "csv") {
    const emptyRow = Array.from({ length: templates.csvHeaders.length }, () => "").join(",");
    return `${templates.csvHeaders.join(",")}\n${emptyRow}\n${emptyRow}\n`;
  }
  if (kind === "html") return "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Untitled</title>\n</head>\n<body>\n\n</body>\n</html>\n";
  if (kind === "app") return createUnconfiguredAppPreviewManifestContent();
  if (kind === "puppyflow") {
    return serializePuppyFlowDocument(createDefaultPuppyFlowDocument(templates.puppyFlow));
  }
  return "";
}

export function normalizeCreateEntryName(kind: DesktopCreateEntryKind, value: string): string {
  const name = value.trim();
  if (!name) {
    throw new DesktopNodeNameError("name-required");
  }
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new DesktopNodeNameError("name-invalid");
  }
  if (name.includes("\0")) {
    throw new DesktopNodeNameError("name-unsupported");
  }
  if (kind === "markdown") {
    return ensureCreateEntryExtension(name, /\.(md|markdown|mdx)$/i, ".md");
  }
  if (kind === "contextMap") {
    return ensureCreateEntryExtension(name, /\.contextmap$/i, ".contextmap");
  }
  if (kind === "text") {
    return getDesktopNodeExtension(name) ? name : `${name}.txt`;
  }
  if (kind === "json") {
    return ensureCreateEntryExtension(name, /\.(json|jsonl)$/i, ".json");
  }
  if (kind === "csv") {
    return ensureCreateEntryExtension(name, /\.(csv|tsv)$/i, ".csv");
  }
  if (kind === "html") {
    return ensureCreateEntryExtension(name, /\.(html?|xhtml)$/i, ".html");
  }
  if (kind === "app") {
    return ensureCreateEntryExtension(name, /\.puppyoneapp$/i, ".puppyoneapp");
  }
  if (kind === "puppyflow") {
    return ensureCreateEntryExtension(name, /\.(puppyflow|puppyflow\.json)$/i, ".puppyflow");
  }
  if (kind === "slides") return name.replace(/\.puppyoneapp$/i, "");
  return name;
}

function ensureCreateEntryExtension(name: string, extensionPattern: RegExp, fallbackExtension: string): string {
  if (extensionPattern.test(name)) return name;
  return `${name}${fallbackExtension}`;
}

function getCreateEntryOptionLabel(kind: DesktopCreateEntryKind, t: MessageFormatter): string {
  return t(`workspace.node.create.kind.${kind}.label`);
}

function getCreateEntryDialogTitle(kind: DesktopCreateEntryKind, t: MessageFormatter): string {
  return t(`workspace.node.create.kind.${kind}.title`);
}

export function toDesktopNodeActionError(error: unknown): DesktopNodeActionError {
  if (error instanceof DesktopNodeNameError) return Object.freeze({ code: error.code });
  return Object.freeze({
    code: "operation-failed",
    detail: error instanceof Error ? error.message : String(error),
  });
}

function formatDesktopNodeActionError(
  error: DesktopNodeActionError | null,
  t: MessageFormatter,
): string | null {
  if (!error) return null;
  if (error.code === "name-required") return t("workspace.node.error.nameRequired");
  if (error.code === "name-invalid") return t("workspace.node.error.nameInvalid");
  if (error.code === "name-unsupported") return t("workspace.node.error.nameUnsupported");
  if (error.code === "delete-partial") {
    return t("workspace.node.error.deletePartial", {
      deleted: error.deletedCount,
      failed: error.failedCount,
      detail: bidiIsolate(error.detail),
    });
  }
  return t("workspace.node.error.operationFailedDetail", { detail: bidiIsolate(error.detail) });
}

type DesktopNodeNameErrorCode = "name-required" | "name-invalid" | "name-unsupported";

class DesktopNodeNameError extends Error {
  readonly code: DesktopNodeNameErrorCode;

  constructor(code: DesktopNodeNameError["code"]) {
    super(code);
    this.name = "DesktopNodeNameError";
    this.code = code;
  }
}

export function uniqueCreateEntryName(defaultName: string, existingNames: Set<string>): string {
  if (!existingNames.has(defaultName)) return defaultName;

  const extensionIndex = defaultName.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const stem = hasExtension ? defaultName.slice(0, extensionIndex) : defaultName;
  const extension = hasExtension ? defaultName.slice(extensionIndex) : "";

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem} ${index}${extension}`;
    if (!existingNames.has(candidate)) return candidate;
  }

  return `${stem} ${Date.now()}${extension}`;
}

export function rectToCreateEntryAnchor(
  rect: DOMRect,
  placement: DesktopCreateEntryAnchor["placement"] = "below-start",
): DesktopCreateEntryAnchor {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    placement,
  };
}

function getCreateEntryMenuPosition(
  anchor: DesktopCreateEntryAnchor,
  menuWidth: number,
  estimatedHeight: number,
) {
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const maxLeft = Math.max(CREATE_ENTRY_MENU_MARGIN, viewportWidth - menuWidth - CREATE_ENTRY_MENU_MARGIN);
  const maxTop = Math.max(CREATE_ENTRY_MENU_MARGIN, viewportHeight - estimatedHeight - CREATE_ENTRY_MENU_MARGIN);
  const gap = 6;
  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - estimatedHeight - gap;
  const belowFits = belowTop <= maxTop;
  const aboveFits = aboveTop >= CREATE_ENTRY_MENU_MARGIN;
  const placement = anchor.placement ?? "below-start";
  const alignEnd = placement.endsWith("-end");
  const preferredTop = placement === "auto-start"
    ? (belowFits || !aboveFits ? belowTop : aboveTop)
    : placement === "auto-end"
      ? (belowFits || !aboveFits ? belowTop : aboveTop)
    : placement === "above-start" || placement === "above-end"
      ? (aboveFits || !belowFits ? aboveTop : belowTop)
      : (belowFits || !aboveFits ? belowTop : aboveTop);
  const preferredLeft = alignEnd ? anchor.right - menuWidth : anchor.left;

  return {
    left: clampNumber(preferredLeft, CREATE_ENTRY_MENU_MARGIN, maxLeft),
    top: clampNumber(preferredTop, CREATE_ENTRY_MENU_MARGIN, maxTop),
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
