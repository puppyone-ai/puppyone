import type { MarkdownTableAlignment, MarkdownTableStructureOperation } from "./tableModel";
import {
  dispatchMarkdownTableStructureOperation,
  type MarkdownTableDispatchContext,
} from "./tableCommands";
import {
  closeActiveMarkdownTableMenu,
  isActiveMarkdownTableMenu,
  setActiveMarkdownTableMenu,
} from "./tableMenuState";
import { getMarkdownLocalization } from "../../core/editor/markdownLocalization";
import {
  createEditableTableMenuIcon,
  type EditableTableMenuIconName,
} from "../../../table/editableTableMenuIcons";

export type MarkdownTableMenuScope = "cell" | "column" | "row";

type MarkdownTableMenuTarget = {
  clientX: number;
  clientY: number;
  columnCount: number;
  columnIndex: number;
  layoutActions?: Readonly<{
    autoFitColumn: () => void;
    fitToViewport: () => void;
    resetColumnWidths: () => void;
  }>;
  onClose?: (context: { restoreFocus: boolean }) => void;
  restoreFocus?: HTMLElement | null;
  rowCount: number;
  rowIndex: number;
  scope?: MarkdownTableMenuScope;
};

const TABLE_MENU_THEME_PROPERTIES = [
  "--po-accent",
  "--po-control",
  "--po-danger",
  "--po-divider",
  "--po-font-sans",
  "--po-font-size-chrome",
  "--po-hover",
  "--po-menu-bg",
  "--po-menu-border",
  "--po-menu-item-gap",
  "--po-menu-item-height",
  "--po-menu-item-padding-inline",
  "--po-menu-item-radius",
  "--po-menu-padding",
  "--po-menu-radius",
  "--po-menu-shadow",
  "--po-panel",
  "--po-panel-raised",
  "--po-scrollbar-thumb",
  "--po-scrollbar-thumb-hover",
  "--po-selected",
  "--po-shadow",
  "--po-text",
  "--po-text-disabled",
  "--po-text-muted",
] as const;

let markdownTableMenuSequence = 0;

type MarkdownTableMenuItem = {
  destructive?: boolean;
  disabled?: boolean;
  icon: EditableTableMenuIconName;
  label: string;
  operation?: MarkdownTableStructureOperation;
  radio?: boolean;
  run?: () => void;
  selected?: boolean;
  trailing?: string;
};

type MarkdownTableMenuSection = {
  id: "rows" | "columns" | "layout" | "alignment" | "table";
  label?: string;
  items: MarkdownTableMenuItem[];
  toolbar: true;
};

export function showMarkdownTableContextMenu(
  context: MarkdownTableDispatchContext,
  target: MarkdownTableMenuTarget,
) {
  const localization = getMarkdownLocalization(context.view);
  closeActiveMarkdownTableMenu();
  const document = context.view.dom.ownerDocument;
  const restoreFocus = target.restoreFocus
    ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const menu = document.createElement("div");
  menu.id = `cm-md-table-menu-${++markdownTableMenuSequence}`;
  menu.className = "desktop-menu-surface cm-md-table-context-menu po-editable-table-context-menu";
  menu.dataset.nativeSurfaceOccluder = "true";
  menu.dataset.poScrollbar = "menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", localization.t("editor.table.actions"));
  menu.dir = localization.direction;
  menu.setAttribute("aria-orientation", "vertical");
  menu.tabIndex = -1;
  menu.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  const portalRoot = document.querySelector<HTMLElement>('[data-po-overlay-root="true"]') ?? document.body;
  if (portalRoot === document.body) applyMarkdownTableMenuTheme(context.view.dom, menu);

  for (const section of getMarkdownTableMenuSections(context, target, localization)) {
    menu.appendChild(createMarkdownTableMenuSection(document, context, section));
  }

  portalRoot.appendChild(menu);
  positionMarkdownTableMenu(menu, target.clientX, target.clientY);

  const win = document.defaultView;
  const onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    closeActiveMarkdownTableMenu();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeActiveMarkdownTableMenu();
  };
  const onMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeActiveMarkdownTableMenu();
      return;
    }

    const items = getEnabledMarkdownTableMenuItems(menu);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextItem: HTMLButtonElement | null = null;
    if (event.key === "ArrowDown") {
      nextItem = items[(currentIndex + 1 + items.length) % items.length] ?? null;
    } else if (event.key === "ArrowUp") {
      const previousIndex = currentIndex < 0 ? items.length - 1 : currentIndex - 1;
      nextItem = items[(previousIndex + items.length) % items.length] ?? null;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const movesForward = (event.key === "ArrowRight") !== (menu.dir === "rtl");
      const offset = movesForward ? 1 : -1;
      const origin = currentIndex < 0 ? (movesForward ? -1 : 0) : currentIndex;
      nextItem = items[(origin + offset + items.length) % items.length] ?? null;
    } else if (event.key === "Home") {
      nextItem = items[0] ?? null;
    } else if (event.key === "End") {
      nextItem = items[items.length - 1] ?? null;
    } else if (
      event.key.length === 1
      && event.key !== " "
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
    ) {
      const query = event.key.toLocaleLowerCase(localization.locale);
      for (let offset = 1; offset <= items.length; offset += 1) {
        const index = (Math.max(currentIndex, -1) + offset) % items.length;
        const label = items[index]
          ?.querySelector(".desktop-menu-item-label")
          ?.textContent
          ?.trim()
          .toLocaleLowerCase(localization.locale);
        if (label?.startsWith(query)) {
          nextItem = items[index] ?? null;
          break;
        }
      }
    }
    if (!nextItem) return;
    event.preventDefault();
    event.stopPropagation();
    focusMarkdownTableMenuItem(items, nextItem);
  };
  const onFocusOut = () => {
    queueMicrotask(() => {
      if (!isActiveMarkdownTableMenu(menu) || menu.contains(document.activeElement)) return;
      closeActiveMarkdownTableMenu();
    });
  };
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const activeElement = document.activeElement;
    const shouldRestoreFocus = activeElement === menu || (
      activeElement instanceof Node && menu.contains(activeElement)
    );
    menu.removeEventListener("keydown", onMenuKeyDown);
    menu.removeEventListener("focusout", onFocusOut);
    menu.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    win?.removeEventListener("resize", closeActiveMarkdownTableMenu);
    win?.removeEventListener("scroll", closeActiveMarkdownTableMenu, true);
    target.onClose?.({ restoreFocus: shouldRestoreFocus });
    if (shouldRestoreFocus) {
      if (restoreFocus?.isConnected) {
        restoreFocus.focus({ preventScroll: true });
      } else if (context.view.dom.isConnected) {
        context.view.focus();
      }
    }
  };
  setActiveMarkdownTableMenu({ cleanup, element: menu });
  menu.addEventListener("keydown", onMenuKeyDown);
  menu.addEventListener("focusout", onFocusOut);

  const initialItems = getEnabledMarkdownTableMenuItems(menu);
  const initialItem = initialItems[0] ?? null;
  if (initialItem) {
    focusMarkdownTableMenuItem(initialItems, initialItem);
  } else {
    menu.focus({ preventScroll: true });
  }

  win?.setTimeout(() => {
    if (!isActiveMarkdownTableMenu(menu)) return;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    win.addEventListener("resize", closeActiveMarkdownTableMenu);
    win.addEventListener("scroll", closeActiveMarkdownTableMenu, true);
  }, 0);
  return menu;
}

function getMarkdownTableMenuSections(
  context: MarkdownTableDispatchContext,
  target: MarkdownTableMenuTarget,
  localization: ReturnType<typeof getMarkdownLocalization>,
): MarkdownTableMenuSection[] {
  const { direction, t } = localization;
  const { columnCount, columnIndex, rowCount, rowIndex } = target;
  const scope = target.scope ?? "cell";
  const currentAlignment = context.alignments[columnIndex] ?? null;
  const alignmentItems: Array<{ alignment: MarkdownTableAlignment; label: string }> = [
    { alignment: null, label: t("editor.table.defaultAlignment") },
    { alignment: "left", label: t("editor.table.alignLeft") },
    { alignment: "center", label: t("editor.table.alignCenter") },
    { alignment: "right", label: t("editor.table.alignRight") },
  ];

  const sections: MarkdownTableMenuSection[] = [
    {
      id: "rows",
      label: t("editor.table.rows"),
      items: [
        {
          icon: "insert-row-above",
          disabled: rowIndex === 0,
          label: t("editor.table.insertRowAbove"),
          operation: { type: "insert-row-above", rowIndex, columnIndex },
        },
        {
          icon: "insert-row-below",
          label: t("editor.table.insertRowBelow"),
          operation: { type: "insert-row-below", rowIndex, columnIndex },
        },
        {
          icon: "duplicate-row",
          label: t("editor.table.duplicateRow"),
          operation: { type: "duplicate-row", rowIndex, columnIndex },
        },
        {
          icon: "move-up",
          disabled: rowIndex <= 1,
          label: t("editor.table.moveRowUp"),
          operation: { type: "move-row-up", rowIndex, columnIndex },
        },
        {
          icon: "move-down",
          disabled: rowIndex === 0 || rowIndex >= rowCount - 1,
          label: t("editor.table.moveRowDown"),
          operation: { type: "move-row-down", rowIndex, columnIndex },
        },
        {
          icon: "delete",
          destructive: true,
          disabled: rowIndex === 0,
          label: t("editor.table.deleteRow"),
          operation: { type: "delete-row", rowIndex, columnIndex },
        },
      ],
      toolbar: true,
    },
    {
      id: "columns",
      label: t("editor.table.columns"),
      items: [
        {
          icon: "insert-column-left",
          label: t(direction === "rtl"
            ? "editor.table.insertColumnRight"
            : "editor.table.insertColumnLeft"),
          operation: { type: "insert-column-left", rowIndex, columnIndex },
        },
        {
          icon: "insert-column-right",
          label: t(direction === "rtl"
            ? "editor.table.insertColumnLeft"
            : "editor.table.insertColumnRight"),
          operation: { type: "insert-column-right", rowIndex, columnIndex },
        },
        {
          icon: "move-left",
          disabled: columnIndex === 0,
          label: t(direction === "rtl"
            ? "editor.table.moveColumnRight"
            : "editor.table.moveColumnLeft"),
          operation: { type: "move-column-left", rowIndex, columnIndex },
        },
        {
          icon: "move-right",
          disabled: columnIndex >= columnCount - 1,
          label: t(direction === "rtl"
            ? "editor.table.moveColumnLeft"
            : "editor.table.moveColumnRight"),
          operation: { type: "move-column-right", rowIndex, columnIndex },
        },
        {
          icon: "delete",
          destructive: true,
          disabled: columnCount <= 1,
          label: t("editor.table.deleteColumn"),
          operation: { type: "delete-column", rowIndex, columnIndex },
        },
      ],
      toolbar: true,
    },
    {
      id: "alignment",
      label: t("editor.table.alignment"),
      items: alignmentItems.map(({ alignment, label }) => ({
        icon: alignment === null ? "align-default" : `align-${alignment}` as EditableTableMenuIconName,
        label,
        operation: {
          type: "set-column-alignment",
          rowIndex,
          columnIndex,
          alignment,
        },
        radio: true,
        selected: currentAlignment === alignment,
      })),
      toolbar: true,
    },
    {
      id: "table",
      items: [{
        icon: "delete",
        destructive: true,
        label: t("editor.table.deleteTable"),
        operation: { type: "delete-table", rowIndex, columnIndex },
      }],
      toolbar: true,
    },
  ];

  if (target.layoutActions) {
    sections.splice(2, 0, {
      id: "layout",
      items: [
        {
          icon: "auto-fit-column",
          label: t("editor.table.autoFitColumn"),
          run: target.layoutActions.autoFitColumn,
        },
        {
          icon: "fit-viewport",
          label: t("editor.table.fitToViewport"),
          run: target.layoutActions.fitToViewport,
        },
        {
          icon: "reset-widths",
          label: t("editor.table.resetColumnWidths"),
          run: target.layoutActions.resetColumnWidths,
        },
      ],
      toolbar: true,
    });
  }

  if (scope === "row") {
    return sections.filter((section) => section.id === "rows");
  }
  if (scope === "column") {
    return sections.filter((section) => (
      section.id === "columns" || section.id === "layout" || section.id === "alignment"
    ));
  }
  return sections;
}

/**
 * Hosts normally provide a theme-aware overlay root. When a smaller embed
 * only has document.body, snapshot the EditorView's resolved product tokens
 * so the unclipped portal still matches its local theme and preset.
 */
function applyMarkdownTableMenuTheme(source: HTMLElement, menu: HTMLElement) {
  const win = source.ownerDocument.defaultView;
  if (!win) return;
  const computed = win.getComputedStyle(source);
  const properties = new Set<string>(TABLE_MENU_THEME_PROPERTIES);
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index);
    if (property.startsWith("--po-")) properties.add(property);
  }
  for (const property of properties) {
    const value = computed.getPropertyValue(property).trim();
    if (value) menu.style.setProperty(property, value);
  }
  for (const property of ["color-scheme", "font-family"] as const) {
    const value = computed.getPropertyValue(property).trim();
    if (value) menu.style.setProperty(property, value);
  }
}

function createMarkdownTableMenuSection(
  document: Document,
  context: MarkdownTableDispatchContext,
  section: MarkdownTableMenuSection,
): HTMLElement {
  const sectionElement = document.createElement("section");
  sectionElement.className = `desktop-menu-section${section.toolbar ? " is-icon-toolbar" : ""}`;
  sectionElement.setAttribute("role", "group");
  if (section.label) {
    sectionElement.setAttribute("aria-label", section.label);
    const label = document.createElement("div");
    label.className = "desktop-menu-section-label";
    label.textContent = section.label;
    sectionElement.appendChild(label);
  }

  const list = document.createElement("div");
  list.className = `desktop-menu-section-list${section.toolbar ? " is-icon-toolbar" : ""}`;
  for (const item of section.items) {
    list.appendChild(createMarkdownTableMenuItem(document, context, item));
  }
  sectionElement.appendChild(list);
  return sectionElement;
}

function createMarkdownTableMenuItem(
  document: Document,
  context: MarkdownTableDispatchContext,
  item: MarkdownTableMenuItem,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", item.radio ? "menuitemradio" : "menuitem");
  if (item.radio) button.setAttribute("aria-checked", item.selected ? "true" : "false");
  button.className = [
    "desktop-menu-item",
    "is-icon",
    item.destructive ? "danger" : "",
    item.selected ? "selected" : "",
  ].filter(Boolean).join(" ");
  button.disabled = item.disabled === true;
  button.tabIndex = -1;
  button.setAttribute("aria-label", item.label);
  button.title = item.label;

  const body = document.createElement("span");
  body.className = "desktop-menu-item-body";
  body.appendChild(createEditableTableMenuIcon(document, item.icon));
  const label = document.createElement("span");
  label.className = "desktop-menu-item-label po-editable-table-menu-visually-hidden";
  label.textContent = item.label;
  body.appendChild(label);
  button.appendChild(body);

  if (item.trailing) {
    const trailing = document.createElement("span");
    trailing.className = "desktop-menu-item-trailing";
    trailing.textContent = item.trailing;
    button.appendChild(trailing);
  }

  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    if (item.run) {
      closeActiveMarkdownTableMenu();
      item.run();
      return;
    }
    if (item.operation) dispatchMarkdownTableStructureOperation(context, item.operation);
  });
  return button;
}

function getEnabledMarkdownTableMenuItems(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('.desktop-menu-item:not(:disabled)'));
}

function focusMarkdownTableMenuItem(items: readonly HTMLButtonElement[], target: HTMLButtonElement) {
  for (const item of items) item.tabIndex = item === target ? 0 : -1;
  target.focus({ preventScroll: true });
}

function positionMarkdownTableMenu(menu: HTMLElement, clientX: number, clientY: number) {
  const win = menu.ownerDocument.defaultView;
  const margin = 8;
  menu.style.position = "fixed";
  menu.style.left = "0";
  menu.style.top = "0";
  menu.style.visibility = "hidden";
  const rect = menu.getBoundingClientRect();
  const viewportWidth = win?.innerWidth ?? 0;
  const viewportHeight = win?.innerHeight ?? 0;
  const left = Math.max(margin, Math.min(clientX, viewportWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(clientY, viewportHeight - rect.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "";
}
