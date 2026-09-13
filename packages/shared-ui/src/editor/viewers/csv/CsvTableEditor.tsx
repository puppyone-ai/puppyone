"use client";

import type { MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { DocumentNavigationPort } from "../../navigation/documentNavigation";
import type {
  EditorSourceRevision,
  EditorSourceSnapshotPort,
} from "../../sourceSnapshot";
import type { TabularProjectionItem } from "../../table/tabularWindow";
import { useTabularViewport } from "../../table/useTabularViewport";
import { EDITABLE_TABLE_COLUMN_MIN_WIDTH } from "../../table/editableTableLayout";
import { useEditorPaneMenuContributionPublisher } from "../../editorPaneMenuContribution";
import {
  getCsvFindMatchKey,
  useCsvFindAdapter,
  type CsvFindMatch,
} from "../../find/useCsvFindAdapter";
import { useRegisterEditorFindAdapter } from "../../find/editorFind";
import { useEditorAppearanceRevision } from "../../../core/appearance/EditorAppearanceContext";
import { useDocumentModelOwner } from "../../document-session/DocumentModelOwner";
import { useRetainedEditorScroll } from "../../document-session/useRetainedEditorViewState";
import { CsvTableControls } from "./CsvTableControls";
import { CsvCellEditor } from "./CsvCellEditor";
import { CsvColumnResizeLayer } from "./CsvColumnResizeLayer";
import { CsvColumnLayoutModel } from "./CsvColumnLayoutModel";
import { CsvDocumentModel, type CsvModelRow } from "./CsvDocumentModel";
import {
  CsvTableResizeControl,
  type CsvTableExpansion,
} from "./CsvTableResizeControl";
import { CsvViewSettings } from "./CsvViewSettings";
import { inferDelimiter } from "./csvDocument";
import type {
  CsvTableFocusTarget,
  CsvTableStructureOperation,
} from "./csvTableOperations";
import {
  readCsvFirstRecordAsHeaderPreference,
  readCsvColumnWidthsPreference,
  readCsvShowRowNumbersPreference,
  writeCsvColumnWidthsPreference,
  writeCsvFirstRecordAsHeaderPreference,
  writeCsvShowRowNumbersPreference,
} from "./csvViewPreferences";

export type CsvTableEditorProps = {
  documentId?: string;
  content: string;
  nodeName?: string;
  delimiter?: "," | "\t";
  readOnly?: boolean;
  documentNavigation?: DocumentNavigationPort | null;
  onSourceRevisionChange?: (revision: EditorSourceRevision) => void;
  onSnapshotPortChange?: (port: EditorSourceSnapshotPort | null) => void;
};

type ModelOwner = Readonly<{
  columnLayout: CsvColumnLayoutModel;
  delimiter: "," | "\t";
  documentId: string;
  model: CsvDocumentModel;
}>;

type ActiveCell = Readonly<{
  rowIndex: number;
  columnIndex: number;
}>;

export function CsvTableEditor({
  documentId,
  content,
  nodeName = "",
  delimiter,
  readOnly = true,
  documentNavigation = null,
  onSourceRevisionChange,
  onSnapshotPortChange,
}: CsvTableEditorProps) {
  const appearanceRevision = useEditorAppearanceRevision();
  const documentModels = useDocumentModelOwner();
  const { direction, locale, t } = useLocalization();
  const resolvedDocumentId = documentId ?? (nodeName || "csv-document");
  const resolvedDelimiter = delimiter ?? inferDelimiter(nodeName, content);
  const modelOwnerRef = useRef<ModelOwner | null>(null);
  if (
    !modelOwnerRef.current
    || modelOwnerRef.current.documentId !== resolvedDocumentId
    || modelOwnerRef.current.delimiter !== resolvedDelimiter
  ) {
    const createModel = () => new CsvDocumentModel(resolvedDocumentId, content, resolvedDelimiter);
    const documentModel = documentModels?.getOrCreate(`csv:${resolvedDelimiter}`, createModel) ?? createModel();
    modelOwnerRef.current = {
      columnLayout: new CsvColumnLayoutModel(documentModel, {
        read: (columnCount) => readCsvColumnWidthsPreference(
          documentId,
          resolvedDelimiter,
          columnCount,
        ),
        write: (widths) => writeCsvColumnWidthsPreference(
          documentId,
          resolvedDelimiter,
          widths,
        ),
      }),
      delimiter: resolvedDelimiter,
      documentId: resolvedDocumentId,
      model: documentModel,
    };
  }
  const model = modelOwnerRef.current.model;
  const columnLayout = modelOwnerRef.current.columnLayout;
  const modelSnapshot = useSyncExternalStore(
    model.subscribe,
    model.getSnapshot,
    model.getSnapshot,
  );
  const columnLayoutSnapshot = useSyncExternalStore(
    columnLayout.subscribe,
    columnLayout.getSnapshot,
    columnLayout.getSnapshot,
  );
  const callbacksRef = useRef({ onSnapshotPortChange, onSourceRevisionChange });
  const acceptedContentRef = useRef(content);
  callbacksRef.current = { onSnapshotPortChange, onSourceRevisionChange };

  useLayoutEffect(() => {
    if (acceptedContentRef.current === content) return;
    acceptedContentRef.current = content;
    const snapshot = model.replaceContent(content);
    callbacksRef.current.onSourceRevisionChange?.({
      revision: snapshot.revision,
      origin: "model-initialization",
    });
  }, [content, model]);

  useLayoutEffect(() => {
    documentModels?.activate(model);
    const snapshotPort: EditorSourceSnapshotPort = {
      retainedSource: model,
      setInputEnabled: model.setInputEnabled,
      readSnapshot: model.readSnapshot,
      replaceContent: (nextContent) => {
        acceptedContentRef.current = nextContent;
        const snapshot = model.replaceContent(nextContent);
        callbacksRef.current.onSourceRevisionChange?.({
          revision: snapshot.revision,
          origin: "model-initialization",
        });
        return snapshot;
      },
    };
    callbacksRef.current.onSnapshotPortChange?.(snapshotPort);
    callbacksRef.current.onSourceRevisionChange?.({
      revision: model.getSnapshot().revision,
      origin: "model-initialization",
    });
    return () => callbacksRef.current.onSnapshotPortChange?.(null);
  }, [documentModels, model]);

  useLayoutEffect(() => () => columnLayout.dispose(), [columnLayout]);

  const [headerEnabled, setHeaderEnabled] = useState(modelSnapshot.suggestedHeader);
  const [rowNumbersVisible, setRowNumbersVisible] = useState(true);
  const [resizePreview, setResizePreview] = useState<CsvTableExpansion | null>(null);
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const headerPreferenceDocumentRef = useRef(documentId);
  const headerPreferenceInitializedRef = useRef(false);
  const rowNumbersPreferenceDocumentRef = useRef(documentId);
  const rowNumbersPreferenceInitializedRef = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useRetainedEditorScroll("csv:scroll", scrollRef);
  const pendingFocusRef = useRef<CsvTableFocusTarget | null>(null);
  const revealFindMatchRef = useRef<(match: CsvFindMatch, focus: boolean) => void>(
    () => undefined,
  );
  const csvFind = useCsvFindAdapter(
    modelSnapshot.rows,
    tableRef,
    (match, focus) => revealFindMatchRef.current(match, focus),
  );

  useRegisterEditorFindAdapter(csvFind.adapter);
  const publishPaneMenuContribution = useEditorPaneMenuContributionPublisher();

  useLayoutEffect(() => {
    if (headerPreferenceDocumentRef.current !== documentId) {
      headerPreferenceDocumentRef.current = documentId;
      headerPreferenceInitializedRef.current = false;
    }
    if (headerPreferenceInitializedRef.current) return;

    const storedPreference = readCsvFirstRecordAsHeaderPreference(documentId);
    if (storedPreference !== undefined) {
      setHeaderEnabled(storedPreference);
      headerPreferenceInitializedRef.current = true;
      return;
    }

    setHeaderEnabled(modelSnapshot.suggestedHeader);
    if (modelSnapshot.hasSource) {
      writeCsvFirstRecordAsHeaderPreference(documentId, modelSnapshot.suggestedHeader);
      headerPreferenceInitializedRef.current = true;
    }
  }, [documentId, modelSnapshot.epoch, modelSnapshot.hasSource, modelSnapshot.suggestedHeader]);

  useLayoutEffect(() => {
    if (rowNumbersPreferenceDocumentRef.current !== documentId) {
      rowNumbersPreferenceDocumentRef.current = documentId;
      rowNumbersPreferenceInitializedRef.current = false;
    }
    if (rowNumbersPreferenceInitializedRef.current) return;

    const storedPreference = readCsvShowRowNumbersPreference(documentId);
    setRowNumbersVisible(storedPreference ?? true);
    if (storedPreference !== undefined || modelSnapshot.hasSource) {
      rowNumbersPreferenceInitializedRef.current = true;
    }
  }, [documentId, modelSnapshot.epoch, modelSnapshot.hasSource]);

  const headerRowCount = headerEnabled ? 1 : 0;
  const dataRowCount = Math.max(0, modelSnapshot.rows.length - headerRowCount);
  const columnCount = modelSnapshot.columns.length;
  const pinnedDataRowIndex = activeCell && activeCell.rowIndex >= headerRowCount
    ? activeCell.rowIndex - headerRowCount
    : null;
  const viewport = useTabularViewport({
    initialWindow: documentModels?.readViewState("csv:viewport"),
    columnWidths: columnLayoutSnapshot.widths,
    direction,
    hasHeader: headerEnabled,
    hasRowNumbers: rowNumbersVisible,
    pinnedColumnIndex: activeCell?.columnIndex,
    pinnedDataRowIndex,
    rowCount: dataRowCount,
    scrollRef,
    surfaceRef,
  });
  const revealViewportCell = viewport.revealCell;
  const scheduleViewportUpdate = viewport.handleScroll;
  useLayoutEffect(() => {
    // Retain the projection origin; reattachment measures a minimal probe there
    // before mounting the full viewport so cells are styled only once.
    documentModels?.writeViewState("csv:viewport", { rowRange: viewport.rowRange, columnRange: viewport.columnRange });
  }, [documentModels, viewport.rowRange, viewport.columnRange]);

  useLayoutEffect(() => {
    scheduleViewportUpdate();
  }, [appearanceRevision, scheduleViewportUpdate]);

  const requestFocus = useCallback((target: CsvTableFocusTarget) => {
    pendingFocusRef.current = target;
    setActiveCell(target);
    revealViewportCell(
      Math.max(0, target.rowIndex - headerRowCount),
      target.columnIndex,
    );
  }, [headerRowCount, revealViewportCell]);

  revealFindMatchRef.current = (match, focus) => {
    if (focus) pendingFocusRef.current = match;
    revealViewportCell(Math.max(0, match.rowIndex - headerRowCount), match.columnIndex);
  };

  useLayoutEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    const input = tableRef.current?.querySelector<HTMLInputElement>(
      `input[data-csv-row="${target.rowIndex}"][data-csv-column="${target.columnIndex}"]`,
    );
    if (!input) return;
    pendingFocusRef.current = null;
    input.focus({ preventScroll: true });
    input.select();
  }, [modelSnapshot.revision, viewport.columnRange, viewport.rowRange]);

  const reportLocalEdit = useCallback((revision: string) => {
    callbacksRef.current.onSourceRevisionChange?.({ revision, origin: "local-edit" });
  }, []);

  const updateCell = useCallback((rowIndex: number, columnIndex: number, value: string) => {
    const result = model.setCell(rowIndex, columnIndex, value);
    if (result.changed) reportLocalEdit(result.revision);
  }, [model, reportLocalEdit]);

  const commitModelResult = useCallback((result: ReturnType<CsvDocumentModel["applyStructureOperation"]>) => {
    if (result.changed) reportLocalEdit(result.revision);
    if (result.focus) requestFocus(result.focus);
  }, [reportLocalEdit, requestFocus]);

  const addRow = useCallback(() => {
    commitModelResult(model.appendRow(headerEnabled));
  }, [commitModelResult, headerEnabled, model]);

  const addColumn = useCallback(() => {
    commitModelResult(model.appendColumn(headerEnabled));
  }, [commitModelResult, headerEnabled, model]);

  const applyStructureOperation = useCallback((operation: CsvTableStructureOperation) => {
    commitModelResult(model.applyStructureOperation(headerEnabled, operation));
  }, [commitModelResult, headerEnabled, model]);

  const expandTable = useCallback((targetDataRowCount: number, targetColumnCount: number) => {
    applyStructureOperation({
      type: "expand-to-shape",
      rowIndex: headerEnabled ? Math.min(1, modelSnapshot.rows.length - 1) : 0,
      columnIndex: Math.max(0, columnCount - 1),
      targetDataRowCount,
      targetColumnCount,
    });
  }, [applyStructureOperation, columnCount, headerEnabled, modelSnapshot.rows.length]);

  const handleCellKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    columnIndex: number,
  ) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key.toLocaleLowerCase() === "z") {
      event.preventDefault();
      const result = event.shiftKey ? model.redo() : model.undo();
      if (result.changed) reportLocalEdit(result.revision);
      return;
    }
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const firstRowIndex = headerEnabled ? 0 : headerRowCount;
    const lastRowIndex = modelSnapshot.rows.length - 1;
    const linearIndex = (rowIndex - firstRowIndex) * columnCount + columnIndex;
    const nextLinearIndex = linearIndex + (event.shiftKey ? -1 : 1);
    const maximumLinearIndex = (lastRowIndex - firstRowIndex + 1) * columnCount - 1;
    if (nextLinearIndex < 0 || nextLinearIndex > maximumLinearIndex) return;
    event.preventDefault();
    requestFocus({
      rowIndex: firstRowIndex + Math.floor(nextLinearIndex / columnCount),
      columnIndex: nextLinearIndex % columnCount,
    });
  }, [columnCount, headerEnabled, headerRowCount, model, modelSnapshot.rows.length, reportLocalEdit, requestFocus]);

  const setFirstRecordAsHeader = useCallback((enabled: boolean) => {
    headerPreferenceInitializedRef.current = true;
    setHeaderEnabled(enabled);
    writeCsvFirstRecordAsHeaderPreference(documentId, enabled);
  }, [documentId]);

  const setShowRowNumbers = useCallback((visible: boolean) => {
    rowNumbersPreferenceInitializedRef.current = true;
    setRowNumbersVisible(visible);
    writeCsvShowRowNumbersPreference(documentId, visible);
  }, [documentId]);

  const autoFitColumn = useCallback((columnIndex: number) => {
    columnLayout.autoFitColumn(columnIndex);
  }, [columnLayout]);

  const resetColumnWidths = useCallback(() => {
    columnLayout.resetColumnWidths();
  }, [columnLayout]);

  const fitColumnsToViewport = useCallback(() => {
    const scroll = scrollRef.current;
    const surface = surfaceRef.current;
    if (!scroll || !surface) return;
    columnLayout.fitToViewport(getAvailableCsvColumnWidth(
      scroll,
      surface,
      rowNumbersVisible,
    ));
  }, [columnLayout, rowNumbersVisible]);

  useLayoutEffect(() => {
    if (!publishPaneMenuContribution || !documentId) return undefined;
    publishPaneMenuContribution({
      documentId,
      viewItems: [
        {
          kind: "toggle",
          id: "csv-header-row",
          label: t("editor.csv.headerToggle"),
          checked: headerEnabled,
          setChecked: setFirstRecordAsHeader,
        },
        {
          kind: "toggle",
          id: "csv-row-numbers",
          label: t("editor.csv.rowNumbersToggle"),
          checked: rowNumbersVisible,
          setChecked: setShowRowNumbers,
        },
        {
          kind: "command",
          id: "csv-fit-columns-to-viewport",
          label: t("editor.csv.fitToViewport"),
          run: fitColumnsToViewport,
        },
        {
          kind: "command",
          id: "csv-reset-column-widths",
          label: t("editor.csv.resetColumnWidths"),
          run: resetColumnWidths,
        },
      ],
    });
    return () => publishPaneMenuContribution(null);
  }, [
    documentId,
    headerEnabled,
    fitColumnsToViewport,
    publishPaneMenuContribution,
    rowNumbersVisible,
    resetColumnWidths,
    setFirstRecordAsHeader,
    setShowRowNumbers,
    t,
  ]);

  const handleScroll = useCallback(() => {
    const scrollContainer = scrollRef.current;
    if (scrollContainer) {
      const inlineScrolled = Math.abs(scrollContainer.scrollLeft) > 0.5;
      if (scrollContainer.hasAttribute("data-inline-scrolled") !== inlineScrolled) {
        scrollContainer.toggleAttribute("data-inline-scrolled", inlineScrolled);
      }
    }
    scheduleViewportUpdate();
  }, [scheduleViewportUpdate]);

  const previewAddedRows = resizePreview?.addedRows ?? 0;
  const previewAddedColumns = resizePreview?.addedColumns ?? 0;
  const previewColumnCount = columnCount + previewAddedColumns;
  const structuralDataRowCount = Math.max(0, modelSnapshot.rows.length - (headerEnabled ? 1 : 0));
  const ariaColumnOffset = rowNumbersVisible ? 2 : 1;
  const physicalColumnCount = viewport.columnItems.length
    + (rowNumbersVisible ? 1 : 0)
    + previewAddedColumns;

  return (
    <section
      className="csv-table-editor"
      // This synchronous model and its measured bounded projection are ready
      // for the host handoff; unrelated DOM mutations need no extra quiet frame.
      data-document-surface-ready={viewport.measured ? "true" : undefined}
      data-readonly={readOnly ? "true" : undefined}
      data-row-numbers-visible={rowNumbersVisible ? "true" : undefined}
    >
      <div
        ref={scrollRef}
        className="csv-table-editor__scroll"
        data-po-scrollbar="content"
        onScroll={handleScroll}
      >
        {!publishPaneMenuContribution && (
          <CsvViewSettings
            direction={direction}
            headerEnabled={headerEnabled}
            onFitToViewport={fitColumnsToViewport}
            onHeaderChange={setFirstRecordAsHeader}
            onResetColumnWidths={resetColumnWidths}
            onRowNumbersChange={setShowRowNumbers}
            rowNumbersVisible={rowNumbersVisible}
            t={t}
          />
        )}

        <div className="csv-table-editor__frame">
          <div
            ref={surfaceRef}
            className="csv-table-editor__surface po-editable-table-interaction-root"
            data-header-enabled={headerEnabled ? "true" : undefined}
            data-resize-preview={resizePreview ? "true" : undefined}
            dir={direction}
          >
            <table
              ref={tableRef}
              className="csv-table-editor__table"
              aria-label={nodeName || (resolvedDelimiter === "\t" ? "TSV" : "CSV")}
              aria-colcount={columnCount + (rowNumbersVisible ? 1 : 0)}
              aria-rowcount={modelSnapshot.rows.length}
              data-csv-virtual-row-start={viewport.rowRange.start}
              data-csv-virtual-row-end={viewport.rowRange.end}
              data-csv-virtual-column-start={viewport.columnRange.start}
              data-csv-virtual-column-end={viewport.columnRange.end}
              data-csv-mounted-rows={viewport.mountedRowCount}
              data-csv-mounted-columns={viewport.mountedColumnCount}
              data-csv-mounted-cells={viewport.mountedCellCount}
            >
              <colgroup>
                {rowNumbersVisible && <col className="csv-table-editor__record-index-column" />}
                {viewport.columnItems.map((item) => item.kind === "gap" ? (
                  <col
                    className="csv-table-editor__virtual-column-spacer"
                    key={`column-gap-${item.start}-${item.end}`}
                    style={{ width: item.size }}
                  />
                ) : (
                  <col
                    data-csv-column={item.index}
                    key={modelSnapshot.columns[item.index]?.id ?? `column-${item.index}`}
                    style={{ width: columnLayoutSnapshot.widths[item.index] }}
                  />
                ))}
                {Array.from({ length: previewAddedColumns }, (_, previewColumnIndex) => (
                  <col
                    className="csv-table-editor__expansion-column"
                    key={`expansion-column-${previewColumnIndex}`}
                    style={{ width: EDITABLE_TABLE_COLUMN_MIN_WIDTH }}
                  />
                ))}
              </colgroup>
              {headerEnabled && modelSnapshot.rows[0] && (
                <thead>
                  <MemoCsvHeaderRow
                    ariaColumnOffset={ariaColumnOffset}
                    columnItems={viewport.columnItems}
                    currentMatch={csvFind.currentMatch}
                    matchKeys={csvFind.matchKeys}
                    onActivate={setActiveCell}
                    onCellKeyDown={handleCellKeyDown}
                    onUpdateCell={updateCell}
                    previewAddedColumns={previewAddedColumns}
                    readOnly={readOnly}
                    row={modelSnapshot.rows[0]}
                    rowNumbersVisible={rowNumbersVisible}
                    t={t}
                  />
                </thead>
              )}
              <tbody>
                {viewport.rowItems.map((item) => item.kind === "gap" ? (
                  <tr
                    className="csv-table-editor__virtual-row-spacer"
                    key={`row-gap-${item.start}-${item.end}`}
                    aria-hidden="true"
                    style={{ height: item.size }}
                  >
                    <td colSpan={physicalColumnCount} />
                  </tr>
                ) : (() => {
                  const rowIndex = item.index + headerRowCount;
                  const row = modelSnapshot.rows[rowIndex];
                  if (!row) return null;
                  return (
                    <MemoCsvBodyRow
                      ariaColumnOffset={ariaColumnOffset}
                      columnItems={viewport.columnItems}
                      currentMatch={csvFind.currentMatch}
                      displayRowNumber={item.index + 1}
                      key={row.id}
                      matchKeys={csvFind.matchKeys}
                      documentNavigation={documentNavigation}
                      documentPath={resolvedDocumentId}
                      onActivate={setActiveCell}
                      onCellKeyDown={handleCellKeyDown}
                      onUpdateCell={updateCell}
                      previewAddedColumns={previewAddedColumns}
                      readOnly={readOnly}
                      row={row}
                      rowIndex={rowIndex}
                      rowNumbersVisible={rowNumbersVisible}
                      t={t}
                    />
                  );
                })())}
                {Array.from({ length: previewAddedRows }, (_, previewRowIndex) => {
                  const displayRowNumber = structuralDataRowCount + previewRowIndex + 1;
                  return (
                    <tr
                      className="csv-table-editor__expansion-row"
                      key={`expansion-row-${previewRowIndex}`}
                      aria-hidden="true"
                    >
                      {rowNumbersVisible && (
                        <th className="csv-table-editor__record-index csv-table-editor__expansion-cell csv-table-editor__expansion-record-index">
                          <span className="csv-table-editor__record-index-label">
                            {displayRowNumber}
                          </span>
                        </th>
                      )}
                      {Array.from({ length: previewColumnCount }, (_, previewColumnIndex) => (
                        <td
                          className="csv-table-editor__body-cell csv-table-editor__expansion-cell"
                          key={`expansion-row-${previewRowIndex}-cell-${previewColumnIndex}`}
                        />
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!readOnly && (
              <>
                <button
                  type="button"
                  className="csv-table-editor__structure-button csv-table-editor__add-row po-editable-table-structure-button po-editable-table-add-row"
                  onClick={addRow}
                  title={t("editor.csv.addRow")}
                  aria-label={t("editor.csv.addRow")}
                >
                  <span className="csv-table-editor__structure-button-visual po-editable-table-structure-button-visual" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="csv-table-editor__structure-button csv-table-editor__add-column po-editable-table-structure-button po-editable-table-add-column"
                  onClick={addColumn}
                  title={t("editor.csv.addColumn")}
                  aria-label={t("editor.csv.addColumn")}
                >
                  <span className="csv-table-editor__structure-button-visual po-editable-table-structure-button-visual" aria-hidden="true" />
                </button>
                <CsvTableControls
                  columnCount={columnCount}
                  direction={direction}
                  headerEnabled={headerEnabled}
                  locale={locale}
                  onAutoFitColumn={autoFitColumn}
                  onOperation={applyStructureOperation}
                  rowNumbersVisible={rowNumbersVisible}
                  rowCount={modelSnapshot.rows.length}
                  surfaceRef={surfaceRef}
                  tableRef={tableRef}
                  t={t}
                />
                <CsvColumnResizeLayer
                  columnWidths={columnLayoutSnapshot.widths}
                  direction={direction}
                  onAutoFitColumn={autoFitColumn}
                  onColumnWidthChange={columnLayout.setColumnWidth}
                  onColumnWidthsCommit={columnLayout.commitColumnWidths}
                  surfaceRef={surfaceRef}
                  tableRef={tableRef}
                  t={t}
                />
                <CsvTableResizeControl
                  currentColumnCount={columnCount}
                  currentDataRowCount={structuralDataRowCount}
                  direction={direction}
                  onExpand={expandTable}
                  onPreviewChange={setResizePreview}
                  t={t}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

type CsvRowProjectionProps = Readonly<{
  ariaColumnOffset: number;
  columnItems: readonly TabularProjectionItem[];
  currentMatch: CsvFindMatch | null;
  documentNavigation?: DocumentNavigationPort | null;
  documentPath?: string;
  matchKeys: ReadonlySet<string>;
  onActivate: (cell: ActiveCell) => void;
  onCellKeyDown: (
    event: ReactKeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    columnIndex: number,
  ) => void;
  onUpdateCell: (rowIndex: number, columnIndex: number, value: string) => void;
  previewAddedColumns: number;
  readOnly: boolean;
  row: CsvModelRow;
  rowNumbersVisible: boolean;
  t: MessageFormatter;
}>;

const MemoCsvHeaderRow = memo(function CsvHeaderRow({
  ariaColumnOffset,
  columnItems,
  currentMatch,
  matchKeys,
  onActivate,
  onCellKeyDown,
  onUpdateCell,
  previewAddedColumns,
  readOnly,
  row,
  rowNumbersVisible,
  t,
}: CsvRowProjectionProps) {
  return (
    <tr data-csv-row="0" aria-rowindex={1}>
      {rowNumbersVisible && (
        <th
          className="csv-table-editor__record-index csv-table-editor__record-index--header"
          scope="row"
          aria-colindex={1}
          data-csv-record-index="0"
          aria-label={t("editor.csv.headerRecord")}
        />
      )}
      {columnItems.map((item) => item.kind === "gap" ? (
        <th
          className="csv-table-editor__virtual-column-spacer"
          key={`header-gap-${item.start}-${item.end}`}
          aria-hidden="true"
          style={{ width: item.size }}
        />
      ) : (
        <th
          className="csv-table-editor__header-cell"
          scope="col"
          key={`header-${item.index}`}
          data-csv-row="0"
          data-csv-column={item.index}
          data-find-match={matchKeys.has(getCsvFindMatchKey({ rowIndex: 0, columnIndex: item.index })) ? "true" : undefined}
          data-find-current={currentMatch?.rowIndex === 0 && currentMatch.columnIndex === item.index ? "true" : undefined}
          aria-colindex={item.index + ariaColumnOffset}
        >
          <input
            value={row.cells[item.index] ?? ""}
            readOnly={readOnly}
            onChange={(event) => onUpdateCell(0, item.index, event.currentTarget.value)}
            onFocus={() => onActivate({ rowIndex: 0, columnIndex: item.index })}
            onKeyDown={(event) => onCellKeyDown(event, 0, item.index)}
            aria-label={t("editor.csv.columnHeader", { column: item.index + 1 })}
            aria-haspopup="menu"
            aria-expanded="false"
            data-csv-row="0"
            data-csv-column={item.index}
            spellCheck={false}
          />
        </th>
      ))}
      {Array.from({ length: previewAddedColumns }, (_, previewColumnIndex) => (
        <th
          className="csv-table-editor__header-cell csv-table-editor__expansion-cell csv-table-editor__expansion-cell--column"
          key={`expansion-header-${previewColumnIndex}`}
          aria-hidden="true"
        />
      ))}
    </tr>
  );
});

const MemoCsvBodyRow = memo(function CsvBodyRow({
  ariaColumnOffset,
  columnItems,
  currentMatch,
  documentNavigation = null,
  documentPath = "",
  displayRowNumber,
  matchKeys,
  onActivate,
  onCellKeyDown,
  onUpdateCell,
  previewAddedColumns,
  readOnly,
  row,
  rowIndex,
  rowNumbersVisible,
  t,
}: CsvRowProjectionProps & Readonly<{ displayRowNumber: number; rowIndex: number }>) {
  return (
    <tr data-csv-row={rowIndex} aria-rowindex={rowIndex + 1}>
      {rowNumbersVisible && (
        <th
          className="csv-table-editor__record-index"
          scope="row"
          aria-colindex={1}
          data-csv-record-index={rowIndex}
          data-csv-display-row={displayRowNumber}
          aria-label={t("editor.csv.rowNumber", {
            row: displayRowNumber,
            record: rowIndex + 1,
          })}
          title={t("editor.csv.rowNumber", {
            row: displayRowNumber,
            record: rowIndex + 1,
          })}
        >
          <span className="csv-table-editor__record-index-label" aria-hidden="true">
            {displayRowNumber}
          </span>
        </th>
      )}
      {columnItems.map((item) => item.kind === "gap" ? (
        <td
          className="csv-table-editor__virtual-column-spacer"
          key={`cell-gap-${row.id}-${item.start}-${item.end}`}
          aria-hidden="true"
          style={{ width: item.size }}
        />
      ) : (
        <td
          className="csv-table-editor__body-cell"
          key={`cell-${row.id}-${item.index}`}
          data-csv-row={rowIndex}
          data-csv-column={item.index}
          data-find-match={matchKeys.has(getCsvFindMatchKey({ rowIndex, columnIndex: item.index })) ? "true" : undefined}
          data-find-current={currentMatch?.rowIndex === rowIndex && currentMatch.columnIndex === item.index ? "true" : undefined}
          aria-colindex={item.index + ariaColumnOffset}
        >
          <CsvCellEditor
            value={row.cells[item.index] ?? ""}
            readOnly={readOnly}
            rowIndex={rowIndex}
            columnIndex={item.index}
            displayRowNumber={displayRowNumber}
            reference={documentNavigation?.resolveReference(
              documentPath,
              row.cells[item.index] ?? "",
            ) ?? null}
            navigation={documentNavigation}
            onActivate={() => onActivate({ rowIndex, columnIndex: item.index })}
            onCellKeyDown={(event) => onCellKeyDown(event, rowIndex, item.index)}
            onUpdate={(value) => onUpdateCell(rowIndex, item.index, value)}
            t={t}
          />
        </td>
      ))}
      {Array.from({ length: previewAddedColumns }, (_, previewColumnIndex) => (
        <td
          className="csv-table-editor__body-cell csv-table-editor__expansion-cell csv-table-editor__expansion-cell--column"
          key={`expansion-cell-${row.id}-${previewColumnIndex}`}
          aria-hidden="true"
        />
      ))}
    </tr>
  );
});

export default CsvTableEditor;

function getAvailableCsvColumnWidth(
  scroll: HTMLElement,
  surface: HTMLElement,
  rowNumbersVisible: boolean,
): number {
  const styles = getComputedStyle(surface);
  const readPixels = (name: string) => {
    const value = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) ? value : 0;
  };
  const contentInsets = readPixels("--csv-table-content-inline-start-inset")
    + readPixels("--csv-table-content-inline-end-inset")
    + readPixels("--po-editable-table-action-gutter");
  const recordGutter = rowNumbersVisible
    ? readPixels("--csv-table-record-index-width")
    : 0;
  return Math.max(0, scroll.clientWidth - contentInsets - recordGutter);
}
