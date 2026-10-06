import { Tooltip } from "@puppyone/shared-ui";
import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type RefObject,
} from "react";
import { useLocalization } from "@puppyone/localization";
import {
  Check,
  ExternalLink,
  Search,
  X,
} from "lucide-react";
import type {
  EditorFindCommand,
  EditorPaneMenuContribution,
  EditorPaneMenuSegmentedControl,
  EditorPaneSplitOptions,
  EditorSplitDirection,
} from "@puppyone/shared-ui";
import {
  DesktopMenuIconButton,
  DesktopMenuItem,
  DesktopMenuSection,
  DesktopMenuSurface,
} from "../../../components/DesktopMenu";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import { useAnchoredOverlayPosition } from "../../app-shell/useAnchoredOverlayPosition";

const PANE_ACTIONS_MENU_MAX_HEIGHT = 360;

export type EditorPaneActionsMenuProps = Readonly<{
  anchorRef: RefObject<HTMLElement | null>;
  editorLabel: string | null;
  findCommand: EditorFindCommand | null;
  menuContribution: EditorPaneMenuContribution | null;
  open: boolean;
  onCloseMenu: () => void;
  onClosePane: () => void;
  onOpenExternal: (() => void | Promise<void>) | null;
  onSplit: (
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => void;
}>;

/** Portal-owned menu: it cannot be clipped or hit-tested by an editor pane. */
export function EditorPaneActionsMenu({
  anchorRef,
  editorLabel,
  findCommand,
  menuContribution,
  open,
  onCloseMenu,
  onClosePane,
  onOpenExternal,
}: EditorPaneActionsMenuProps) {
  const { t } = useLocalization();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const viewItems = menuContribution?.viewItems ?? [];
  const segmentedControl = viewItems.find((item) => item.kind === "segmented") ?? null;
  const hasSecondaryActions = viewItems.some((item) => item.kind !== "segmented");
  const { setOverlayRef, overlayPosition } = useAnchoredOverlayPosition({
    open,
    anchorRef,
    boundarySelector: ".desktop-editor-split-view",
    // CSS owns the intrinsic width; positioning only limits available space.
    preferredWidth: 0,
    widthMode: "content",
    preferredMaxHeight: PANE_ACTIONS_MENU_MAX_HEIGHT,
    gap: 4,
    margin: 8,
    alignment: "center",
    placementPreference: "below",
  });

  const setMenuRef = useCallback((node: HTMLDivElement | null) => {
    menuRef.current = node;
    setOverlayRef(node);
    if (!node) return;
    requestAnimationFrame(() => {
      node.querySelector<HTMLButtonElement>('[role^="menuitem"]')
        ?.focus({ preventScroll: true });
    });
  }, [setOverlayRef]);

  useEffect(() => {
    if (!open) return undefined;
    const isInside = (target: EventTarget | null) => target instanceof Node && Boolean(
      anchorRef.current?.contains(target) || menuRef.current?.contains(target),
    );
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!isInside(event.target)) onCloseMenu();
    };
    const dismissOnFocusExit = (event: FocusEvent) => {
      if (!isInside(event.target)) onCloseMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseMenu();
        anchorRef.current?.focus({ preventScroll: true });
        return;
      }
      const menu = menuRef.current;
      if (!menu?.contains(event.target as Node)) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = Array.from(
        menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)'),
      );
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (currentIndex - 1 + items.length) % items.length
            : (currentIndex + 1) % items.length;
      items[nextIndex]?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", dismissOnFocusExit, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", dismissOnFocusExit, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchorRef, onCloseMenu, open]);

  if (!open) return null;

  const runAndClose = (action: () => void | Promise<void>) => {
    onCloseMenu();
    void action();
  };
  const openExternalLabel = t("editor.openDefaultApp");
  const menuStyle = overlayPosition
    ? {
        left: overlayPosition.left,
        top: overlayPosition.top,
        maxWidth: overlayPosition.maxWidth,
        maxHeight: overlayPosition.maxHeight,
      }
    : {
        left: 0,
        top: 0,
        maxHeight: PANE_ACTIONS_MENU_MAX_HEIGHT,
        visibility: "hidden",
        pointerEvents: "none",
      } satisfies CSSProperties;

  return (
    <DesktopOverlayLayer>
      <DesktopMenuSurface
        ref={setMenuRef}
        className="desktop-editor-pane-menu"
        elevation="compact"
        ariaLabel={editorLabel
          ? t("editor.panes.actionsFor", { name: editorLabel })
          : t("editor.panes.actions")}
        style={menuStyle}
      >
        <div className="desktop-editor-pane-menu-primary-actions">
          {segmentedControl && <PaneMenuSegmentedControl item={segmentedControl} />}
          <div className="desktop-editor-pane-menu-end-actions">
            {segmentedControl && (
              <span className="desktop-editor-pane-menu-action-divider" aria-hidden="true" />
            )}
            {findCommand && (
              <Tooltip content={t("editor.find.label")}><DesktopMenuIconButton
                className="desktop-editor-pane-menu-primary-action desktop-editor-pane-menu-find-action"
                icon={<Search size={15} strokeWidth={1.9} />}
                label={t("editor.find.label")}
                role="menuitem"
                onClick={() => runAndClose(findCommand.open)}
              /></Tooltip>
            )}
            {onOpenExternal && (
              <Tooltip content={openExternalLabel}><DesktopMenuIconButton
                className="desktop-editor-pane-menu-primary-action desktop-editor-pane-menu-external-action"
                icon={<ExternalLink size={15} strokeWidth={1.8} />}
                label={openExternalLabel}
                role="menuitem"
                onClick={() => runAndClose(onOpenExternal)}
              /></Tooltip>
            )}
            <Tooltip content={t("editor.panes.closePane")}><DesktopMenuIconButton
              className="desktop-editor-pane-menu-primary-action desktop-editor-pane-menu-close-action"
              icon={<X size={15} strokeWidth={1.8} />}
              label={t("editor.panes.closePane")}
              role="menuitem"
              onClick={() => runAndClose(onClosePane)}
            /></Tooltip>
          </div>
        </div>
        {hasSecondaryActions && (
          <DesktopMenuSection className="desktop-editor-pane-menu-secondary-actions">
            {viewItems.map((item) => {
              if (item.kind === "segmented") return null;
              if (item.kind === "toggle") {
                return (
                  <DesktopMenuItem
                    key={item.id}
                    icon={item.checked ? <Check size={14} strokeWidth={2} /> : <span />}
                    label={item.label}
                    role="menuitemcheckbox"
                    aria-checked={item.checked}
                    onClick={() => item.setChecked(!item.checked)}
                  />
                );
              }
              return (
                <DesktopMenuItem
                  key={item.id}
                  disabled={item.disabled}
                  label={item.label}
                  onClick={() => runAndClose(item.run)}
                />
              );
            })}
          </DesktopMenuSection>
        )}
      </DesktopMenuSurface>
    </DesktopOverlayLayer>
  );
}

function PaneMenuSegmentedControl({
  item,
}: Readonly<{
  item: EditorPaneMenuSegmentedControl;
}>) {
  return (
    <div
      className="desktop-editor-pane-menu-segmented-control"
      role="group"
      aria-label={item.label}
    >
      {item.options.map((option, optionIndex) => {
        const selected = option.id === item.value;
        return (
          <Tooltip content={option.label} key={option.id}><button
            className="desktop-editor-pane-menu-segment"
            type="button"
            role="menuitemradio"
            aria-label={option.label}
            aria-checked={selected}
            onClick={() => item.setValue(option.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const offset = event.key === "ArrowLeft" ? -1 : 1;
              const nextIndex = (
                optionIndex + offset + item.options.length
              ) % item.options.length;
              const nextOption = item.options[nextIndex];
              const buttons = event.currentTarget.parentElement?.querySelectorAll<
                HTMLButtonElement
>(".desktop-editor-pane-menu-segment");
              buttons?.item(nextIndex).focus({ preventScroll: true });
              if (nextOption) item.setValue(nextOption.id);
            }}
          >
            {option.icon}
          </button></Tooltip>
        );
      })}
    </div>
  );
}
