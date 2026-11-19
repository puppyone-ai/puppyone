import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { MarkdownLinkGraph } from "../../../registry/viewerTypes";
import { markdownLinkCommandsFacet } from "../../core/editor/markdownLivePreviewContext";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { requestMarkdownTableFocus } from "./tableFocusState";
import type { MarkdownInlinePreviewRenderer } from "../../shared/preview/markdownInlinePreviewPort";
import { createPrincipalFromView, openMarkdownHref } from "../../core/editor/markdownLivePreviewContext";
import {
  sanitizeMarkdownTableCell,
  type MarkdownTableAlignment,
  type MarkdownTableCell,
  type MarkdownTableFocusTarget,
  type MarkdownTableRow,
  type MarkdownTableStructureOperation,
} from "./tableModel";
import { getDocRevision } from "../../platform/brokers/transactionBroker";
import { isContentEditableCaretAtBoundary, stopCodeMirrorEvent } from "../../shared/widgets/widgetDom";
import {
  dispatchMarkdownTableStructureOperation,
  normalizeMarkdownTableCellInput,
  type MarkdownTableCellDraft,
} from "./tableCommands";
import { showMarkdownTableContextMenu } from "./tableContextMenu";
import { closeActiveMarkdownTableMenu, isActiveMarkdownTableMenu } from "./tableMenuState";
import { focusMarkdownTableCell } from "./tableFocus";
import { getMarkdownMessageFormatter } from "../../core/editor/markdownLocalization";
import { markdownInlineViewportContinuityEffect } from "../../platform/codemirror/embeddedInlineViewportSession";

export type MarkdownTableCellEditorContext = {
  alignments: readonly MarkdownTableAlignment[];
  cell: MarkdownTableCell;
  columnCount: number;
  columnIndex: number;
  documentPath: string;
  markdownLinkGraph: MarkdownLinkGraph | null;
  rowCount: number;
  rowIndex: number;
  rows: readonly MarkdownTableRow[];
  renderInlinePreview: MarkdownInlinePreviewRenderer;
  getTableRange: () => { from: number; to: number } | null;
  tableFrom: number;
  tableTo: number;
  view: EditorView;
};

const tableCellCleanupByElement = new WeakMap<HTMLElement, () => void>();

/** Called by the owning table widget session; cell DOM never owns global observers. */
export function disposeTableCellEditor(content: HTMLElement) {
  tableCellCleanupByElement.get(content)?.();
  tableCellCleanupByElement.delete(content);
}

export function createTableCellEditor(context: MarkdownTableCellEditorContext): HTMLElement {
  const {
    alignments,
    cell,
    columnCount,
    columnIndex,
    documentPath,
    markdownLinkGraph,
    rowCount,
    rowIndex,
    rows,
    renderInlinePreview,
    getTableRange,
    tableFrom,
    tableTo,
    view,
  } = context;
  const content = document.createElement("span");
  content.dir = "auto";
  content.className = "cm-md-table-cell-content";
  content.dataset.mdTableCell = "true";
  content.dataset.mdTableColumn = String(columnIndex);
  content.dataset.mdTableRow = String(rowIndex);
  content.spellcheck = false;
  const host = getMarkdownEmbedHost(view);
  const baseCellSource = view.state.sliceDoc(cell.from, cell.to);
  const recoveryKey = {
    featureId: "table-cell",
    mappedRange: { from: cell.from, to: cell.to },
    baseSource: baseCellSource,
  };
  const recoveredSession = host.editSessions.findRecoverable(recoveryKey);
  const recoveredText = readTableCellDraftText(recoveredSession?.draft, cell.text);
  let editSessionId: string | null = recoveredSession?.elementId ?? null;
  let editing = recoveredSession?.mode === "editing";
  let suppressBlurCommit = false;
  let tableMenuOpen = false;
  let ownedMenu: HTMLElement | null = null;
  let previewAbort = new AbortController();

  const resetPreviewAssets = () => {
    previewAbort.abort();
    previewAbort = new AbortController();
  };
  const resolvePreviewAsset = (sourcePath: string, href: string) => {
    const signal = previewAbort.signal;
    return host.assets
      .resolve({
        kind: "image",
        principal: createPrincipalFromView(view, "asset-read"),
        sourcePath,
        href,
        signal,
      })
      .then((handle) => {
        if (signal.aborted || !content.isConnected) {
          handle?.revoke();
          return null;
        }
        return handle?.url ?? null;
      });
  };
  const renderPreview = (source: string) => {
    resetPreviewAssets();
    renderTableCellPreview(content, source, markdownLinkGraph, documentPath, view, renderInlinePreview, resolvePreviewAsset, () => {
      host.requestMeasure();
    });
  };

  if (editing) {
    content.textContent = recoveredText;
    content.dataset.mdTableEditing = "true";
  } else {
    renderPreview(cell.text);
  }

  // The recoverable draft lives in the per-view edit-session store, not only in
  // the DOM. DOM contentEditable holds the transient IME buffer; the store is
  // the single recoverable owner (range-mapped, revision-aware).
  const beginEditSession = () => {
    const existing = editSessionId ? host.editSessions.get(editSessionId) : undefined;
    const currentTableRange = existing ? null : getTableRange();
    if (!existing && !currentTableRange) return null;
    const delta = currentTableRange ? currentTableRange.from - tableFrom : 0;
    const mappedRange = existing?.mappedRange ?? {
      from: cell.from + delta,
      to: cell.to + delta,
    };
    const currentBaseSource = view.state.sliceDoc(mappedRange.from, mappedRange.to);
    const session = existing
      ?? host.editSessions.findRecoverable({
        featureId: "table-cell",
        mappedRange,
        baseSource: currentBaseSource,
      })
      ?? host.editSessions.acquire({
        featureId: "table-cell",
        mappedRange,
        baseSource: currentBaseSource,
        baseRevision: getDocRevision(view.state.doc),
        draft: { text: content.textContent ?? cell.text },
        mode: "editing",
        focusTarget: { rowIndex, columnIndex },
      });
    editSessionId = session.elementId;
    return host.editSessions.update(session.elementId, {
      lifecycle: "mounted",
      mode: "editing",
      focusTarget: { rowIndex, columnIndex },
    }) ?? session;
  };
  const updateEditSessionDraft = () => {
    const session = beginEditSession();
    if (!session) return null;
    return host.editSessions.update(session.elementId, {
      draft: { text: content.textContent ?? "" },
      mode: "editing",
      lifecycle: "mounted",
    });
  };
  const finishEditSession = (outcome: "complete" | "cancel") => {
    if (!editSessionId) return;
    if (outcome === "complete") host.editSessions.complete(editSessionId);
    else host.editSessions.cancel(editSessionId);
    editSessionId = null;
  };

  const getMappedTableRange = () => {
    const session = editSessionId ? host.editSessions.get(editSessionId) : undefined;
    if (!session) return getTableRange();
    const delta = session.mappedRange.from - cell.from;
    return { from: tableFrom + delta, to: tableTo + delta };
  };

  const getDraft = (): MarkdownTableCellDraft => ({
    columnIndex,
    rowIndex,
    text: normalizeMarkdownTableCellInput(content.textContent ?? ""),
  });

  const commitCellEdit = (target: { exitPosition?: number; focus?: MarkdownTableFocusTarget }): boolean => {
    const nextText = normalizeMarkdownTableCellInput(content.textContent ?? "");
    const session = updateEditSessionDraft() ?? beginEditSession();
    if (!session) return false;
    // The CAS source is the exact Markdown slice (which may contain escaped
    // pipes); the editable draft is its decoded table-cell representation.
    const changed = nextText !== cell.text;

    if (!changed) {
      const mappedTable = getMappedTableRange();
      if (!mappedTable) return false;
      finishEditSession("cancel");
      if (target.focus) {
        view.dispatch({
          effects: requestMarkdownTableFocus(mappedTable.from, target.focus),
        });
        return true;
      }
      if (target.exitPosition != null) {
        const position = target.exitPosition === tableTo ? mappedTable.to : mappedTable.from;
        view.dispatch({ selection: EditorSelection.cursor(position) });
        view.focus();
      }
      return true;
    }

    const mappedTable = getMappedTableRange();
    if (!mappedTable) return false;
    const nextCellSource = sanitizeMarkdownTableCell(nextText);
    const nextTableTo = mappedTable.to + nextCellSource.length - session.baseSource.length;
    const selectionPosition = target.exitPosition === tableTo ? nextTableTo : mappedTable.from;
    const effects = [
      markdownInlineViewportContinuityEffect.of({
        featureId: "markdown-table",
        oldRange: mappedTable,
        newRange: { from: mappedTable.from, to: nextTableTo },
        sequenceChange: { kind: "preserve" },
      }),
      target.focus ? requestMarkdownTableFocus(mappedTable.from, target.focus) : null,
    ].filter((effect) => effect !== null);
    const result = host.transactions.commit(view, {
      mappedRange: session.mappedRange,
      baseSource: session.baseSource,
      baseRevision: session.baseRevision,
      nextSource: nextCellSource,
      rebase: "if-source-unchanged",
      selection: target.exitPosition != null || target.focus
        ? { from: selectionPosition, to: selectionPosition }
        : undefined,
      preserveSelection: target.exitPosition == null && !target.focus,
      effects,
    });

    if (!result.ok) {
      host.editSessions.markConflicted(session.elementId);
      content.dataset.mdTableConflict = "true";
      suppressBlurCommit = false;
      return false;
    }

    suppressBlurCommit = true;
    editing = false;
    finishEditSession("complete");
    if (target.exitPosition != null) view.focus();
    return true;
  };

  const runStructureOperation = (operation: MarkdownTableStructureOperation) => {
    suppressBlurCommit = true;
    if (editing) updateEditSessionDraft();
    const mappedTable = getMappedTableRange();
    if (!mappedTable) return;
    const currentDraft = editing ? getDraft() : null;
    finishEditSession("complete");
    dispatchMarkdownTableStructureOperation({
      alignments,
      currentDraft,
      rows,
      tableFrom: mappedTable.from,
      tableTo: mappedTable.to,
      view,
    }, operation);
  };

  const finishCellBlur = () => {
    if (suppressBlurCommit) {
      suppressBlurCommit = false;
      editing = false;
      delete content.dataset.mdTableEditing;
      return;
    }
    const nextText = normalizeMarkdownTableCellInput(content.textContent ?? "");
    if (nextText === cell.text) {
      finishEditSession("cancel");
      editing = false;
      delete content.dataset.mdTableEditing;
      delete content.dataset.mdTableConflict;
      renderPreview(cell.text);
      host.requestMeasure();
      return;
    }
    if (commitCellEdit({})) {
      editing = false;
      delete content.dataset.mdTableEditing;
      delete content.dataset.mdTableConflict;
    } else {
      // Keep the conflicted draft visible and recoverable. A later remount can
      // reacquire it by the mapped cell range instead of silently losing it.
      editing = true;
      content.dataset.mdTableEditing = "true";
    }
  };

  if (!view.state.readOnly && cell.editable) {
    content.contentEditable = "true";
    content.addEventListener("focus", () => {
      delete content.dataset.mdTableConflict;
      if (!editing) {
        editing = true;
        content.dataset.mdTableEditing = "true";
        resetPreviewAssets();
        content.textContent = cell.text;
      }
      beginEditSession();
      // Cell edit owns the chrome; drop the block selection so the table ring
      // and the cell ring never compete.
      const selection = view.state.selection.main;
      const mappedTable = getMappedTableRange();
      if (
        mappedTable
        && !selection.empty
        && selection.from <= mappedTable.from
        && selection.to >= mappedTable.to
      ) {
        view.dispatch({ selection: EditorSelection.cursor(mappedTable.from) });
      }
    });
    content.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "ArrowUp" && rowIndex === 0 && isContentEditableCaretAtBoundary(content, "start")) {
        event.preventDefault();
        commitCellEdit({ exitPosition: tableFrom });
        return;
      }
      if (event.key === "ArrowDown" && rowIndex === rowCount - 1 && isContentEditableCaretAtBoundary(content, "end")) {
        event.preventDefault();
        commitCellEdit({ exitPosition: tableTo });
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const target = getAdjacentMarkdownTableCellTarget(rowIndex, columnIndex, rowCount, columnCount, event.shiftKey ? -1 : 1);
        if (target) {
          commitCellEdit({ focus: target });
          return;
        }
        if (event.shiftKey) {
          commitCellEdit({ exitPosition: tableFrom });
          return;
        }
        runStructureOperation({
          type: "insert-row-below",
          rowIndex,
          columnIndex,
        });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) {
          runStructureOperation({
            type: "insert-row-below",
            rowIndex,
            columnIndex,
          });
          return;
        }
        if (rowIndex < rowCount - 1) {
          commitCellEdit({ focus: { rowIndex: rowIndex + 1, columnIndex } });
          return;
        }
        commitCellEdit({ exitPosition: tableTo });
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finishEditSession("cancel");
        suppressBlurCommit = true;
        editing = false;
        delete content.dataset.mdTableEditing;
        delete content.dataset.mdTableConflict;
        content.textContent = cell.text;
        content.blur();
      }
    });
    content.addEventListener("blur", () => {
      if (tableMenuOpen) return;
      finishCellBlur();
    });
  }

  if (!view.state.readOnly) {
    content.setAttribute("aria-haspopup", "menu");
    content.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const mappedTable = getMappedTableRange();
      if (!mappedTable) return;
      closeActiveMarkdownTableMenu();
      tableMenuOpen = true;
      const tableWrapper = content.closest<HTMLElement>(".cm-md-table-widget-wrap");
      if (tableWrapper && rowIndex > 0) tableWrapper.dataset.mdTablePinnedRow = String(rowIndex);
      const keyboardInvocation = event.clientX === 0 && event.clientY === 0;
      const anchorRect = keyboardInvocation ? content.getBoundingClientRect() : null;
      let nextMenu: HTMLElement | null = null;
      nextMenu = showMarkdownTableContextMenu({
        alignments,
        currentDraft: editing ? getDraft() : null,
        rows,
        tableFrom: mappedTable.from,
        tableTo: mappedTable.to,
        view,
      }, {
        clientX: anchorRect ? anchorRect.left : event.clientX,
        clientY: anchorRect ? anchorRect.bottom + 4 : event.clientY,
        columnCount,
        columnIndex,
        onClose: ({ restoreFocus }) => {
          tableMenuOpen = false;
          if (tableWrapper?.dataset.mdTablePinnedRow === String(rowIndex)) {
            delete tableWrapper.dataset.mdTablePinnedRow;
          }
          if (ownedMenu === nextMenu) ownedMenu = null;
          if (!restoreFocus && editing && content.isConnected) finishCellBlur();
        },
        restoreFocus: content,
        rowCount,
        rowIndex,
      });
      ownedMenu = nextMenu;
    });
  }

  content.addEventListener("mousedown", stopCodeMirrorEvent);
  content.addEventListener("click", stopCodeMirrorEvent);
  content.addEventListener("input", (event) => {
    stopCodeMirrorEvent(event);
    if (editing) updateEditSessionDraft();
  });

  if (editing && !view.state.readOnly) {
    queueMicrotask(() => {
      if (!content.isConnected || !editing) return;
      content.focus({ preventScroll: true });
    });
  }

  tableCellCleanupByElement.set(content, () => {
    if (ownedMenu && isActiveMarkdownTableMenu(ownedMenu)) closeActiveMarkdownTableMenu();
    ownedMenu = null;
    tableMenuOpen = false;
    const tableWrapper = content.closest<HTMLElement>(".cm-md-table-widget-wrap");
    if (tableWrapper?.dataset.mdTablePinnedRow === String(rowIndex)) {
      delete tableWrapper.dataset.mdTablePinnedRow;
    }
    resetPreviewAssets();
    if (editSessionId) host.editSessions.detach(editSessionId);
  });

  return content;
}

export function getAdjacentMarkdownTableCellTarget(
  rowIndex: number,
  columnIndex: number,
  rowCount: number,
  columnCount: number,
  direction: -1 | 1,
): MarkdownTableFocusTarget | null {
  const nextIndex = rowIndex * columnCount + columnIndex + direction;
  if (nextIndex < 0 || nextIndex >= rowCount * columnCount) return null;
  return {
    columnIndex: nextIndex % columnCount,
    rowIndex: Math.floor(nextIndex / columnCount),
  };
}

function renderTableCellPreview(
  content: HTMLElement,
  source: string,
  markdownLinkGraph: MarkdownLinkGraph | null,
  documentPath: string,
  view: EditorView,
  renderInlinePreview: MarkdownInlinePreviewRenderer,
  resolveAssetUrl: (sourcePath: string, href: string, signal?: AbortSignal) => Promise<string | null>,
  onLayoutChange: () => void,
) {
  // Table cells use the isolated string-preview adapter with the shared policy
  // and broker-backed image/link wrappers. This is not the full document plan
  // adapter, and no raw asset resolver reaches this path.
  content.replaceChildren();
  renderInlinePreview(content, source, {
    t: getMarkdownMessageFormatter(view),
    markdownLinkGraph,
    markdownLinkCommands: view.state.facet(markdownLinkCommandsFacet),
    resolveAssetUrl,
    openHref: (href) => {
      openMarkdownHref(href, view);
    },
    onLayoutChange,
    sourcePath: documentPath,
  });
}

function readTableCellDraftText(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text : fallback;
}
