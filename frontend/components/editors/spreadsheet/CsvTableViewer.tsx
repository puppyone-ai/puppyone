'use client';

import {
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import dynamic from 'next/dynamic';
import Papa, { type ParseError } from 'papaparse';
import { EditorLoadingSurface } from '@/components/loading';

const MonacoCodeViewer = dynamic(
  () => import('@/components/editors/code/MonacoCodeViewer').then((mod) => mod.MonacoCodeViewer),
  { ssr: false, loading: () => <EditorLoadingSurface /> },
);

export type CsvViewMode = 'edit' | 'preview' | 'source';

interface CsvTableViewerProps {
  readonly content: string;
  readonly filePath?: string;
  readonly nodeName?: string;
  readonly mode?: CsvViewMode;
  readonly readOnly?: boolean;
  readonly onChange?: (content: string) => void;
}

interface ParsedCsv {
  readonly columns: CsvColumn[];
  readonly rows: string[][];
  readonly errors: ParseError[];
  readonly delimiter: string;
  readonly hasHeader: boolean;
}

interface CsvColumn {
  readonly header: string;
  readonly label: string;
  readonly kind: 'number' | 'date' | 'boolean' | 'text';
}

interface CellCoord {
  readonly row: number;
  readonly col: number;
}

type CsvSelection =
  | { readonly type: 'cell'; readonly anchor: CellCoord; readonly focus: CellCoord }
  | { readonly type: 'row'; readonly anchorRow: number; readonly focusRow: number }
  | { readonly type: 'column'; readonly anchorCol: number; readonly focusCol: number };

type CsvEditingTarget =
  | { readonly type: 'cell'; readonly row: number; readonly col: number; readonly selectAll: boolean }
  | { readonly type: 'header'; readonly col: number; readonly selectAll: boolean };

interface SelectionBounds {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly colStart: number;
  readonly colEnd: number;
  readonly type: CsvSelection['type'];
}

const ROW_NUMBER_WIDTH = 50;
const COLUMN_MIN_WIDTH = 156;
const ADD_COLUMN_WIDTH = 38;
const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 34;
const ADD_ROW_HEIGHT = 36;
const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');
type CsvHeaderMode = 'auto' | 'header' | 'none';
type DragSelectionMode = CsvSelection['type'] | null;

export function CsvTableViewer({
  content,
  filePath = '',
  nodeName = '',
  mode = 'preview',
  readOnly = true,
  onChange,
}: CsvTableViewerProps) {
  const headerStorageKey = useMemo(
    () => `puppyone-csv-header-mode:${filePath || nodeName || 'untitled'}`,
    [filePath, nodeName],
  );
  const [headerMode, setHeaderMode] = useState<CsvHeaderMode>('auto');
  const parsed = useMemo(() => parseCsv(content, nodeName, headerMode), [content, headerMode, nodeName]);
  const viewerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollToBottomRef = useRef(false);
  const [openColumnMenu, setOpenColumnMenu] = useState<number | null>(null);
  const [openRowMenu, setOpenRowMenu] = useState<number | null>(null);
  const [selection, setSelection] = useState<CsvSelection | null>(null);
  const [editingTarget, setEditingTarget] = useState<CsvEditingTarget | null>(null);
  const [dragSelectionMode, setDragSelectionMode] = useState<DragSelectionMode>(null);
  const canEdit = mode === 'edit' && !readOnly && Boolean(onChange);
  const rowVirtualizer = useVirtualizer({
    count: parsed.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const columnCount = Math.max(parsed.columns.length, 1);
  const interactiveColumnWidth = canEdit ? ADD_COLUMN_WIDTH : 0;
  const minWidth = ROW_NUMBER_WIDTH + columnCount * COLUMN_MIN_WIDTH + interactiveColumnWidth;
  const gridTemplateColumns = `${ROW_NUMBER_WIDTH}px repeat(${columnCount}, minmax(${COLUMN_MIN_WIDTH}px, 1fr))${canEdit ? ` ${ADD_COLUMN_WIDTH}px` : ''}`;
  const gridStyle = {
    '--csv-grid-template': gridTemplateColumns,
    '--csv-grid-min-width': `${minWidth}px`,
  } as CSSProperties;
  const delimiterLabel =
    parsed.delimiter === '\t' ? 'TSV'
    : parsed.delimiter === ';' ? 'semicolon'
    : parsed.delimiter === '|' ? 'pipe'
    : 'CSV';
  const selectionBounds = selection
    ? getSelectionBounds(selection, parsed.rows.length, parsed.columns.length)
    : null;
  const selectionSummary = selectionBounds ? formatSelectionSummary(selectionBounds) : null;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(headerStorageKey);
    if (saved === 'auto' || saved === 'header' || saved === 'none') {
      setHeaderMode(saved);
    } else {
      setHeaderMode('auto');
    }
  }, [headerStorageKey]);

  useEffect(() => {
    if (openColumnMenu === null && openRowMenu === null) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (
        target?.closest('.csv-table-viewer__menu-surface') ||
        target?.closest('.csv-table-viewer__structure-button')
      ) {
        return;
      }
      setOpenColumnMenu(null);
      setOpenRowMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenColumnMenu(null);
        setOpenRowMenu(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openColumnMenu, openRowMenu]);

  useEffect(() => {
    if (!pendingScrollToBottomRef.current) return;
    pendingScrollToBottomRef.current = false;
    requestAnimationFrame(() => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;
      scrollElement.scrollTop = scrollElement.scrollHeight;
    });
  }, [parsed.rows.length]);

  useEffect(() => {
    if (!dragSelectionMode) return;
    const handlePointerUp = () => setDragSelectionMode(null);
    document.addEventListener('pointerup', handlePointerUp);
    return () => document.removeEventListener('pointerup', handlePointerUp);
  }, [dragSelectionMode]);

  useEffect(() => {
    if (!editingTarget) return;
    if (editingTarget.type === 'cell') {
      if (editingTarget.row >= parsed.rows.length || editingTarget.col >= parsed.columns.length) {
        setEditingTarget(null);
      }
      return;
    }
    if (!parsed.hasHeader || editingTarget.col >= parsed.columns.length) {
      setEditingTarget(null);
    }
  }, [editingTarget, parsed.columns.length, parsed.hasHeader, parsed.rows.length]);

  const setHasHeader = (hasHeader: boolean) => {
    const nextMode: CsvHeaderMode = hasHeader ? 'header' : 'none';
    setHeaderMode(nextMode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(headerStorageKey, nextMode);
    }
  };

  const syncTopScroll = () => {
    const source = scrollRef.current;
    const target = topScrollRef.current;
    if (!source || !target) return;
    if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft;
  };

  const syncBodyScroll = () => {
    const source = topScrollRef.current;
    const target = scrollRef.current;
    if (!source || !target) return;
    if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft;
  };

  const handleCopy = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (isEditingElement(event.target)) return;
    if (!selectionBounds) return;
    const tsv = selectionToTsv(parsed.columns, parsed.rows, selectionBounds, parsed.hasHeader);
    event.clipboardData.setData('text/plain', tsv);
    event.preventDefault();
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (isEditingElement(event.target)) return;
    if (!canEdit || !selectionBounds) return;
    const text = event.clipboardData.getData('text/plain');
    const matrix = parseClipboardMatrix(text);
    if (matrix.length === 0) return;
    event.preventDefault();
    pasteMatrixIntoSelection(selectionBounds, matrix);
  };

  const focusViewer = () => {
    requestAnimationFrame(() => viewerRef.current?.focus({ preventScroll: true }));
  };

  const startEditingCell = (rowIndex: number, columnIndex: number, selectAll: boolean) => {
    if (!canEdit) return;
    setOpenColumnMenu(null);
    setOpenRowMenu(null);
    setEditingTarget({ type: 'cell', row: rowIndex, col: columnIndex, selectAll });
    setSelection({
      type: 'cell',
      anchor: { row: rowIndex, col: columnIndex },
      focus: { row: rowIndex, col: columnIndex },
    });
  };

  const startEditingHeader = (columnIndex: number, selectAll: boolean) => {
    if (!canEdit || !parsed.hasHeader) return;
    setOpenColumnMenu(null);
    setOpenRowMenu(null);
    setEditingTarget({ type: 'header', col: columnIndex, selectAll });
    setSelection({ type: 'column', anchorCol: columnIndex, focusCol: columnIndex });
  };

  const finishEditing = () => {
    setEditingTarget(null);
    focusViewer();
  };

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditingElement(event.target)) return;
    if (!selectionBounds) return;

    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      const targetCell = getEditableCellFromSelection(selection);
      if (targetCell) {
        startEditingCell(targetCell.row, targetCell.col, true);
      } else if (selection?.type === 'column' && parsed.hasHeader) {
        startEditingHeader(selection.focusCol, true);
      }
      return;
    }

    if (event.key === 'Tab') {
      const targetCell = getEditableCellFromSelection(selection);
      if (!targetCell) return;
      event.preventDefault();
      moveSelectionFromCell(targetCell, event.shiftKey ? 'left' : 'right', event.shiftKey);
      return;
    }

    if (event.key.startsWith('Arrow')) {
      const targetCell = getEditableCellFromSelection(selection);
      if (!targetCell) return;
      event.preventDefault();
      const direction =
        event.key === 'ArrowUp' ? 'up'
        : event.key === 'ArrowDown' ? 'down'
        : event.key === 'ArrowLeft' ? 'left'
        : 'right';
      moveSelectionFromCell(targetCell, direction, event.shiftKey);
      return;
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && canEdit) {
      event.preventDefault();
      clearSelectionValues(selectionBounds);
      return;
    }

    if (canEdit && isPrintableKey(event)) {
      const targetCell = getEditableCellFromSelection(selection);
      if (!targetCell) return;
      event.preventDefault();
      updateCell(targetCell.row, targetCell.col, event.key);
      setEditingTarget({ type: 'cell', row: targetCell.row, col: targetCell.col, selectAll: false });
    }
  };

  if (mode === 'source') {
    return (
      <MonacoCodeViewer
        content={content}
        language="plaintext"
        fileName={nodeName}
        readOnly={readOnly}
        onChange={readOnly ? undefined : onChange}
      />
    );
  }

  const commitTable = (columns: CsvColumn[], rows: string[][]) => {
    if (!onChange || readOnly) return;
    onChange(stringifyCsv(columns, rows, parsed.delimiter, parsed.hasHeader));
  };

  const updateHeader = (columnIndex: number, value: string) => {
    if (!parsed.hasHeader) return;
    const nextColumns = parsed.columns.map((column, index) =>
      index === columnIndex ? { ...column, header: value } : column,
    );
    commitTable(nextColumns, parsed.rows);
  };

  const updateCell = (rowIndex: number, columnIndex: number, value: string) => {
    const nextRows = parsed.rows.map((row, index) => {
      if (index !== rowIndex) return row;
      const nextRow = [...row];
      nextRow[columnIndex] = value;
      return nextRow;
    });
    commitTable(parsed.columns, nextRows);
  };

  const copySelectionToClipboard = () => {
    if (!selectionBounds) return;
    const tsv = selectionToTsv(parsed.columns, parsed.rows, selectionBounds, parsed.hasHeader);
    void writeTextToClipboard(tsv);
    focusViewer();
  };

  const deleteRowsByIndexes = (indexes: number[]) => {
    if (indexes.length === 0) return;
    const deleteSet = new Set(indexes);
    setOpenRowMenu(null);
    setSelection(null);
    setEditingTarget(null);
    commitTable(parsed.columns, parsed.rows.filter((_, index) => !deleteSet.has(index)));
  };

  const deleteColumnsByIndexes = (indexes: number[]) => {
    if (indexes.length === 0) return;
    const deleteSet = new Set(indexes);
    const nextColumns = parsed.columns.filter((_, index) => !deleteSet.has(index));
    const nextRows = parsed.rows.map((row) => row.filter((_, index) => !deleteSet.has(index)));
    setOpenColumnMenu(null);
    setSelection(null);
    setEditingTarget(null);
    commitTable(nextColumns, nextColumns.length === 0 ? [] : nextRows);
  };

  const pasteMatrixIntoSelection = (bounds: SelectionBounds, matrix: string[][]) => {
    const matrixWidth = Math.max(...matrix.map((row) => row.length));
    if (matrixWidth === 0) return;

    const selectedRowCount = bounds.rowEnd - bounds.rowStart + 1;
    const selectedColumnCount = bounds.colEnd - bounds.colStart + 1;
    const fillSelectedRange =
      matrix.length === 1 &&
      matrixWidth === 1 &&
      (selectedRowCount > 1 || selectedColumnCount > 1);
    const pasteRowCount = fillSelectedRange ? selectedRowCount : matrix.length;
    const pasteColumnCount = fillSelectedRange ? selectedColumnCount : matrixWidth;

    let nextColumns = [...parsed.columns];
    while (nextColumns.length < bounds.colStart + pasteColumnCount) {
      nextColumns = [...nextColumns, createBlankColumn(nextColumns)];
    }

    const nextRows = parsed.rows.map((row) => normalizeRowLength(row, nextColumns.length));
    while (nextRows.length < bounds.rowStart + pasteRowCount) {
      nextRows.push(Array.from({ length: nextColumns.length }, () => ''));
    }

    for (let rowOffset = 0; rowOffset < pasteRowCount; rowOffset += 1) {
      for (let colOffset = 0; colOffset < pasteColumnCount; colOffset += 1) {
        nextRows[bounds.rowStart + rowOffset][bounds.colStart + colOffset] =
          fillSelectedRange ? matrix[0]?.[0] ?? '' : matrix[rowOffset]?.[colOffset] ?? '';
      }
    }

    setEditingTarget(null);
    setSelection({
      type: 'cell',
      anchor: { row: bounds.rowStart, col: bounds.colStart },
      focus: {
        row: bounds.rowStart + pasteRowCount - 1,
        col: bounds.colStart + pasteColumnCount - 1,
      },
    });
    commitTable(nextColumns, nextRows);
  };

  const addColumn = () => {
    const nextColumn = createBlankColumn(parsed.columns);
    const nextColumns = [...parsed.columns, nextColumn];
    const nextRows = parsed.rows.map((row) => [...row, '']);
    commitTable(nextColumns, nextRows);
  };

  const insertColumn = (columnIndex: number, placement: 'before' | 'after') => {
    const insertIndex = placement === 'before' ? columnIndex : columnIndex + 1;
    const nextColumn = createBlankColumn(parsed.columns);
    const nextColumns = [
      ...parsed.columns.slice(0, insertIndex),
      nextColumn,
      ...parsed.columns.slice(insertIndex),
    ];
    const nextRows = parsed.rows.map((row) => [
      ...row.slice(0, insertIndex),
      '',
      ...row.slice(insertIndex),
    ]);
    setOpenColumnMenu(null);
    commitTable(nextColumns, nextRows);
  };

  const deleteColumn = (columnIndex: number) => {
    const deleteIndexes = getActionColumnIndexes(selectionBounds, columnIndex);
    deleteColumnsByIndexes(deleteIndexes);
  };

  const moveColumn = (columnIndex: number, direction: -1 | 1) => {
    const targetIndex = columnIndex + direction;
    if (targetIndex < 0 || targetIndex >= parsed.columns.length) return;
    const nextColumns = [...parsed.columns];
    [nextColumns[columnIndex], nextColumns[targetIndex]] = [nextColumns[targetIndex], nextColumns[columnIndex]];
    const nextRows = parsed.rows.map((row) => {
      const nextRow = [...row];
      [nextRow[columnIndex], nextRow[targetIndex]] = [nextRow[targetIndex] ?? '', nextRow[columnIndex] ?? ''];
      return nextRow;
    });
    setOpenColumnMenu(null);
    commitTable(nextColumns, nextRows);
  };

  const addRow = () => {
    const columns =
      parsed.columns.length > 0
        ? parsed.columns
        : [{ header: 'Column A', label: 'Column A', kind: 'text' as const }];
    pendingScrollToBottomRef.current = true;
    commitTable(columns, [...parsed.rows, Array.from({ length: columns.length }, () => '')]);
  };

  const insertRow = (rowIndex: number, placement: 'above' | 'below') => {
    const insertIndex = placement === 'above' ? rowIndex : rowIndex + 1;
    const nextRow = Array.from({ length: parsed.columns.length }, () => '');
    const nextRows = [
      ...parsed.rows.slice(0, insertIndex),
      nextRow,
      ...parsed.rows.slice(insertIndex),
    ];
    setOpenRowMenu(null);
    commitTable(parsed.columns, nextRows);
  };

  const deleteRow = (rowIndex: number) => {
    const deleteIndexes = getActionRowIndexes(selectionBounds, rowIndex);
    deleteRowsByIndexes(deleteIndexes);
  };

  const moveRow = (rowIndex: number, direction: -1 | 1) => {
    const targetIndex = rowIndex + direction;
    if (targetIndex < 0 || targetIndex >= parsed.rows.length) return;
    const nextRows = [...parsed.rows];
    [nextRows[rowIndex], nextRows[targetIndex]] = [nextRows[targetIndex], nextRows[rowIndex]];
    setOpenRowMenu(null);
    commitTable(parsed.columns, nextRows);
  };

  const moveSelectionFromCell = (
    cell: CellCoord,
    direction: 'up' | 'down' | 'left' | 'right',
    extend: boolean,
  ) => {
    const nextCell = moveCellCoord(cell, direction, parsed.rows.length, parsed.columns.length);
    setSelection((current) => {
      if (extend && current?.type === 'cell') {
        return { ...current, focus: nextCell };
      }
      return { type: 'cell', anchor: nextCell, focus: nextCell };
    });
    setEditingTarget(null);
    rowVirtualizer.scrollToIndex(nextCell.row, { align: 'auto' });
  };

  const clearSelectionValues = (bounds: SelectionBounds) => {
    const nextRows = parsed.rows.map((row, rowIndex) => {
      if (rowIndex < bounds.rowStart || rowIndex > bounds.rowEnd) return row;
      return row.map((value, columnIndex) =>
        columnIndex >= bounds.colStart && columnIndex <= bounds.colEnd ? '' : value,
      );
    });
    setEditingTarget(null);
    commitTable(parsed.columns, nextRows);
  };

  const prepareEditInputFocus = (
    event: ReactFocusEvent<HTMLInputElement>,
    target: CsvEditingTarget | null,
  ) => {
    if (!target) return;
    if (target.selectAll) {
      event.currentTarget.select();
      return;
    }
    const end = event.currentTarget.value.length;
    event.currentTarget.setSelectionRange(end, end);
  };

  const handleEditInputKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    target: { type: 'cell'; row: number; col: number } | { type: 'header'; col: number },
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finishEditing();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      setEditingTarget(null);
      if (target.type === 'cell') {
        moveSelectionFromCell({ row: target.row, col: target.col }, 'down', false);
      } else {
        focusViewer();
      }
      return;
    }
    if (event.key === 'Tab' && target.type === 'cell') {
      event.preventDefault();
      setEditingTarget(null);
      moveSelectionFromCell({ row: target.row, col: target.col }, event.shiftKey ? 'left' : 'right', false);
    }
  };

  const startCellSelection = (event: ReactMouseEvent, rowIndex: number, columnIndex: number) => {
    if (event.button !== 0) return;
    if (isEditingElement(event.target)) return;
    event.preventDefault();
    setOpenColumnMenu(null);
    setOpenRowMenu(null);
    setEditingTarget(null);
    setSelection((current) =>
      event.shiftKey && current
        ? extendSelectionToCell(current, rowIndex, columnIndex)
        : { type: 'cell', anchor: { row: rowIndex, col: columnIndex }, focus: { row: rowIndex, col: columnIndex } },
    );
    setDragSelectionMode('cell');
    focusViewer();
  };

  const extendCellSelection = (rowIndex: number, columnIndex: number) => {
    if (dragSelectionMode !== 'cell') return;
    setSelection((current) =>
      current?.type === 'cell'
        ? { ...current, focus: { row: rowIndex, col: columnIndex } }
        : { type: 'cell', anchor: { row: rowIndex, col: columnIndex }, focus: { row: rowIndex, col: columnIndex } },
    );
  };

  const startRowSelection = (event: ReactMouseEvent, rowIndex: number) => {
    if (event.button !== 0) return;
    if ((event.target as Element | null)?.closest('.csv-table-viewer__structure-button')) return;
    event.preventDefault();
    setOpenColumnMenu(null);
    setOpenRowMenu(null);
    setEditingTarget(null);
    setSelection((current) =>
      event.shiftKey && current
        ? extendSelectionToRow(current, rowIndex)
        : { type: 'row', anchorRow: rowIndex, focusRow: rowIndex },
    );
    setDragSelectionMode('row');
    focusViewer();
  };

  const extendRowSelection = (rowIndex: number) => {
    if (dragSelectionMode !== 'row') return;
    setSelection((current) =>
      current?.type === 'row'
        ? { ...current, focusRow: rowIndex }
        : { type: 'row', anchorRow: rowIndex, focusRow: rowIndex },
    );
  };

  const startColumnSelection = (event: ReactMouseEvent, columnIndex: number) => {
    if (event.button !== 0) return;
    if ((event.target as Element | null)?.closest('.csv-table-viewer__structure-button')) return;
    if (isEditingElement(event.target)) return;
    event.preventDefault();
    setOpenColumnMenu(null);
    setOpenRowMenu(null);
    setEditingTarget(null);
    setSelection((current) =>
      event.shiftKey && current
        ? extendSelectionToColumn(current, columnIndex)
        : { type: 'column', anchorCol: columnIndex, focusCol: columnIndex },
    );
    setDragSelectionMode('column');
    focusViewer();
  };

  const extendColumnSelection = (columnIndex: number) => {
    if (dragSelectionMode !== 'column') return;
    setSelection((current) =>
      current?.type === 'column'
        ? { ...current, focusCol: columnIndex }
        : { type: 'column', anchorCol: columnIndex, focusCol: columnIndex },
    );
  };

  return (
    <div
      ref={viewerRef}
      className='csv-table-viewer'
      tabIndex={0}
      onCopy={handleCopy}
      onPaste={handlePaste}
      onKeyDown={handleGridKeyDown}
    >
      <style>{csvTableStyles}</style>
      <div className='csv-table-viewer__toolbar'>
        <div className='csv-table-viewer__title'>
          <span className='csv-table-viewer__name'>{nodeName || delimiterLabel}</span>
          <span className='csv-table-viewer__meta'>
            {formatNumber(parsed.rows.length)} rows · {formatNumber(parsed.columns.length)} columns · {delimiterLabel}
          </span>
        </div>
        <div className='csv-table-viewer__toolbar-actions'>
          {selectionBounds && selectionSummary ? (
            <div className='csv-table-viewer__selection-actions' aria-label='Selection actions'>
              <span className='csv-table-viewer__selection-summary'>{selectionSummary}</span>
              <button
                type='button'
                className='csv-table-viewer__selection-button'
                onClick={copySelectionToClipboard}
              >
                Copy
              </button>
              {canEdit ? (
                <button
                  type='button'
                  className='csv-table-viewer__selection-button'
                  onClick={() => clearSelectionValues(selectionBounds)}
                >
                  Clear
                </button>
              ) : null}
              {canEdit && selectionBounds.type === 'row' ? (
                <button
                  type='button'
                  className='csv-table-viewer__selection-button csv-table-viewer__selection-button--danger'
                  onClick={() => deleteRowsByIndexes(range(selectionBounds.rowStart, selectionBounds.rowEnd))}
                >
                  Delete rows
                </button>
              ) : null}
              {canEdit && selectionBounds.type === 'column' ? (
                <button
                  type='button'
                  className='csv-table-viewer__selection-button csv-table-viewer__selection-button--danger'
                  onClick={() => deleteColumnsByIndexes(range(selectionBounds.colStart, selectionBounds.colEnd))}
                >
                  Delete columns
                </button>
              ) : null}
            </div>
          ) : null}
          {parsed.columns.length > 0 ? (
            <label className='csv-table-viewer__header-toggle'>
              <input
                type='checkbox'
                checked={parsed.hasHeader}
                onChange={(event) => setHasHeader(event.currentTarget.checked)}
              />
              <span>Header row</span>
            </label>
          ) : null}
          {parsed.errors.length > 0 ? (
            <div className='csv-table-viewer__warning' title={parsed.errors[0]?.message}>
              {parsed.errors.length} parse {parsed.errors.length === 1 ? 'issue' : 'issues'}
            </div>
          ) : null}
        </div>
      </div>

      {parsed.columns.length > 0 ? (
        <div ref={topScrollRef} className='csv-table-viewer__top-scroll' onScroll={syncBodyScroll}>
          <div className='csv-table-viewer__top-scroll-spacer' style={gridStyle} />
        </div>
      ) : null}

      <div ref={scrollRef} className='csv-table-viewer__scroll' onScroll={syncTopScroll}>
        {parsed.columns.length === 0 ? (
          <div className='csv-table-viewer__empty'>
            <span>No rows</span>
            {canEdit ? (
              <button type='button' className='csv-table-viewer__button' onClick={addRow}>
                Start table
              </button>
            ) : null}
          </div>
        ) : (
          <div
            className='csv-table-viewer__grid'
            style={gridStyle}
            role='grid'
            aria-rowcount={parsed.rows.length + 1}
            aria-colcount={parsed.columns.length}
            aria-readonly={!canEdit}
          >
            <div
              className='csv-table-viewer__row csv-table-viewer__header-row'
              role='row'
            >
              <div className='csv-table-viewer__cell csv-table-viewer__corner' />
              {parsed.columns.map((column, index) => (
                <div
                  key={`${column.label}-${index}`}
                  className={`csv-table-viewer__cell csv-table-viewer__header-cell${canEdit ? ' csv-table-viewer__column-header-cell' : ''}${isColumnSelected(selectionBounds, index) ? ' csv-table-viewer__header-cell--selected' : ''} csv-table-viewer__cell--${column.kind}`}
                  title={column.label}
                  role='columnheader'
                  onMouseDown={(event) => startColumnSelection(event, index)}
                  onMouseEnter={() => extendColumnSelection(index)}
                  onDoubleClick={() => startEditingHeader(index, true)}
                >
                  {canEdit && isEditingHeader(editingTarget, index) ? (
                    <input
                      className='csv-table-viewer__input csv-table-viewer__header-input'
                      value={column.header}
                      placeholder={column.label}
                      onChange={(event) => updateHeader(index, event.currentTarget.value)}
                      onKeyDown={(event) => handleEditInputKeyDown(event, { type: 'header', col: index })}
                      onBlur={() => setEditingTarget(null)}
                      onFocus={(event) => prepareEditInputFocus(event, editingTarget)}
                      aria-label={`Column ${index + 1} header`}
                      autoFocus
                    />
                  ) : (
                    <span className='csv-table-viewer__cell-text'>{column.label}</span>
                  )}
                  {canEdit ? (
                    <div className='csv-table-viewer__structure-menu-host'>
                      <button
                        type='button'
                        className='csv-table-viewer__structure-button'
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenRowMenu(null);
                          setOpenColumnMenu((current) => current === index ? null : index);
                        }}
                        aria-label={`Column actions for ${column.label}`}
                        aria-haspopup='menu'
                        aria-expanded={openColumnMenu === index}
                        title='Column actions'
                      >
                        ⋯
                      </button>
                      {openColumnMenu === index ? (
                        <div className='csv-table-viewer__menu-surface' role='menu'>
                          <button type='button' role='menuitem' onClick={() => moveColumn(index, -1)} disabled={index === 0}>
                            Move left
                          </button>
                          <button type='button' role='menuitem' onClick={() => moveColumn(index, 1)} disabled={index === parsed.columns.length - 1}>
                            Move right
                          </button>
                          <button type='button' role='menuitem' onClick={() => insertColumn(index, 'before')}>
                            Insert left
                          </button>
                          <button type='button' role='menuitem' onClick={() => insertColumn(index, 'after')}>
                            Insert right
                          </button>
                          <button type='button' role='menuitem' onClick={() => deleteColumn(index)}>
                            Delete column
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
              {canEdit ? (
                <div className='csv-table-viewer__cell csv-table-viewer__add-column-cell'>
                  <button
                    type='button'
                    className='csv-table-viewer__edge-button'
                    onClick={addColumn}
                    title='Add column'
                    aria-label='Add column'
                  >
                    +
                  </button>
                </div>
              ) : null}
            </div>
            <div
              className='csv-table-viewer__virtual-space'
              style={{
                height: rowVirtualizer.getTotalSize() + (canEdit ? ADD_ROW_HEIGHT : 0),
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = parsed.rows[virtualRow.index] ?? [];
                return (
                  <div
                    key={virtualRow.key}
                    className={`csv-table-viewer__row csv-table-viewer__body-row${openRowMenu === virtualRow.index ? ' csv-table-viewer__body-row--menu-open' : ''}`}
                    data-index={virtualRow.index}
                    role='row'
                    style={{
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div
                      className={`csv-table-viewer__cell csv-table-viewer__row-number${isRowSelected(selectionBounds, virtualRow.index) ? ' csv-table-viewer__row-number--selected' : ''}`}
                      onMouseDown={(event) => startRowSelection(event, virtualRow.index)}
                      onMouseEnter={() => extendRowSelection(virtualRow.index)}
                    >
                      <span>{virtualRow.index + 1}</span>
                      {canEdit ? (
                        <div className='csv-table-viewer__structure-menu-host csv-table-viewer__row-menu-host'>
                          <button
                            type='button'
                            className='csv-table-viewer__structure-button'
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenColumnMenu(null);
                              setOpenRowMenu((current) =>
                                current === virtualRow.index ? null : virtualRow.index,
                              );
                            }}
                            aria-label={`Row actions for row ${virtualRow.index + 1}`}
                            aria-haspopup='menu'
                            aria-expanded={openRowMenu === virtualRow.index}
                            title='Row actions'
                          >
                            ⋯
                          </button>
                          {openRowMenu === virtualRow.index ? (
                            <div className='csv-table-viewer__menu-surface csv-table-viewer__row-menu' role='menu'>
                              <button type='button' role='menuitem' onClick={() => moveRow(virtualRow.index, -1)} disabled={virtualRow.index === 0}>
                                Move up
                              </button>
                              <button type='button' role='menuitem' onClick={() => moveRow(virtualRow.index, 1)} disabled={virtualRow.index === parsed.rows.length - 1}>
                                Move down
                              </button>
                              <button type='button' role='menuitem' onClick={() => insertRow(virtualRow.index, 'above')}>
                                Insert above
                              </button>
                              <button type='button' role='menuitem' onClick={() => insertRow(virtualRow.index, 'below')}>
                                Insert below
                              </button>
                              <button type='button' role='menuitem' onClick={() => deleteRow(virtualRow.index)}>
                                Delete row
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {parsed.columns.map((column, cellIndex) => {
                      const value = row[cellIndex] ?? '';
                      return (
                        <div
                          key={cellIndex}
                          className={`csv-table-viewer__cell csv-table-viewer__body-cell${isCellSelected(selectionBounds, virtualRow.index, cellIndex) ? ' csv-table-viewer__body-cell--selected' : ''}${isEditingCell(editingTarget, virtualRow.index, cellIndex) ? ' csv-table-viewer__body-cell--editing' : ''} csv-table-viewer__cell--${column.kind}${value === '' ? ' csv-table-viewer__body-cell--empty' : ''}`}
                          title={value}
                          role='gridcell'
                          onMouseDown={(event) => startCellSelection(event, virtualRow.index, cellIndex)}
                          onMouseEnter={() => extendCellSelection(virtualRow.index, cellIndex)}
                          onDoubleClick={() => startEditingCell(virtualRow.index, cellIndex, true)}
                        >
                          {canEdit && isEditingCell(editingTarget, virtualRow.index, cellIndex) ? (
                            <input
                              className='csv-table-viewer__input csv-table-viewer__cell-input'
                              value={value}
                              onChange={(event) =>
                                updateCell(virtualRow.index, cellIndex, event.currentTarget.value)
                              }
                              onKeyDown={(event) =>
                                handleEditInputKeyDown(event, {
                                  type: 'cell',
                                  row: virtualRow.index,
                                  col: cellIndex,
                                })
                              }
                              onBlur={() => setEditingTarget(null)}
                              onFocus={(event) => prepareEditInputFocus(event, editingTarget)}
                              aria-label={`Row ${virtualRow.index + 1}, ${column.label}`}
                              autoFocus
                            />
                          ) : (
                            <span className='csv-table-viewer__cell-text'>{value}</span>
                          )}
                        </div>
                      );
                    })}
                    {canEdit ? (
                      <div className='csv-table-viewer__cell csv-table-viewer__add-column-cell' />
                    ) : null}
                  </div>
                );
              })}
              {canEdit ? (
                <button
                  type='button'
                  className='csv-table-viewer__add-row-band'
                  style={{ transform: `translateY(${rowVirtualizer.getTotalSize()}px)` }}
                  onClick={addRow}
                  aria-label='Add row'
                  title='Add row'
                >
                  <span className='csv-table-viewer__add-row-gutter'>+</span>
                  <span className='csv-table-viewer__add-row-label'>Add row</span>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function isEditingCell(target: CsvEditingTarget | null, rowIndex: number, columnIndex: number): boolean {
  return Boolean(target?.type === 'cell' && target.row === rowIndex && target.col === columnIndex);
}

function isEditingHeader(target: CsvEditingTarget | null, columnIndex: number): boolean {
  return Boolean(target?.type === 'header' && target.col === columnIndex);
}

function isEditingElement(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.tagName === 'INPUT' ||
    element?.tagName === 'TEXTAREA' ||
    element?.isContentEditable,
  );
}

function isPrintableKey(event: ReactKeyboardEvent): boolean {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
}

function getEditableCellFromSelection(selection: CsvSelection | null): CellCoord | null {
  if (!selection) return null;
  if (selection.type === 'cell') return selection.focus;
  if (selection.type === 'row') return { row: selection.focusRow, col: 0 };
  return { row: 0, col: selection.focusCol };
}

function moveCellCoord(
  cell: CellCoord,
  direction: 'up' | 'down' | 'left' | 'right',
  rowCount: number,
  columnCount: number,
): CellCoord {
  const maxRow = Math.max(0, rowCount - 1);
  const maxCol = Math.max(0, columnCount - 1);
  if (direction === 'up') return { row: clampIndex(cell.row - 1, maxRow), col: clampIndex(cell.col, maxCol) };
  if (direction === 'down') return { row: clampIndex(cell.row + 1, maxRow), col: clampIndex(cell.col, maxCol) };
  if (direction === 'left') return { row: clampIndex(cell.row, maxRow), col: clampIndex(cell.col - 1, maxCol) };
  return { row: clampIndex(cell.row, maxRow), col: clampIndex(cell.col + 1, maxCol) };
}

function getSelectionBounds(
  selection: CsvSelection,
  rowCount: number,
  columnCount: number,
): SelectionBounds {
  const maxRow = Math.max(0, rowCount - 1);
  const maxCol = Math.max(0, columnCount - 1);
  if (selection.type === 'row') {
    const rowStart = clampIndex(Math.min(selection.anchorRow, selection.focusRow), maxRow);
    const rowEnd = clampIndex(Math.max(selection.anchorRow, selection.focusRow), maxRow);
    return { type: 'row', rowStart, rowEnd, colStart: 0, colEnd: maxCol };
  }
  if (selection.type === 'column') {
    const colStart = clampIndex(Math.min(selection.anchorCol, selection.focusCol), maxCol);
    const colEnd = clampIndex(Math.max(selection.anchorCol, selection.focusCol), maxCol);
    return { type: 'column', rowStart: 0, rowEnd: maxRow, colStart, colEnd };
  }
  const rowStart = clampIndex(Math.min(selection.anchor.row, selection.focus.row), maxRow);
  const rowEnd = clampIndex(Math.max(selection.anchor.row, selection.focus.row), maxRow);
  const colStart = clampIndex(Math.min(selection.anchor.col, selection.focus.col), maxCol);
  const colEnd = clampIndex(Math.max(selection.anchor.col, selection.focus.col), maxCol);
  return { type: 'cell', rowStart, rowEnd, colStart, colEnd };
}

function isCellSelected(bounds: SelectionBounds | null, rowIndex: number, columnIndex: number): boolean {
  if (!bounds) return false;
  return (
    rowIndex >= bounds.rowStart &&
    rowIndex <= bounds.rowEnd &&
    columnIndex >= bounds.colStart &&
    columnIndex <= bounds.colEnd
  );
}

function isRowSelected(bounds: SelectionBounds | null, rowIndex: number): boolean {
  return Boolean(bounds?.type === 'row' && rowIndex >= bounds.rowStart && rowIndex <= bounds.rowEnd);
}

function isColumnSelected(bounds: SelectionBounds | null, columnIndex: number): boolean {
  return Boolean(bounds?.type === 'column' && columnIndex >= bounds.colStart && columnIndex <= bounds.colEnd);
}

function extendSelectionToCell(selection: CsvSelection, rowIndex: number, columnIndex: number): CsvSelection {
  if (selection.type === 'cell') {
    return { ...selection, focus: { row: rowIndex, col: columnIndex } };
  }
  if (selection.type === 'row') {
    return {
      type: 'cell',
      anchor: { row: selection.anchorRow, col: 0 },
      focus: { row: rowIndex, col: columnIndex },
    };
  }
  return {
    type: 'cell',
    anchor: { row: 0, col: selection.anchorCol },
    focus: { row: rowIndex, col: columnIndex },
  };
}

function extendSelectionToRow(selection: CsvSelection, rowIndex: number): CsvSelection {
  if (selection.type === 'row') return { ...selection, focusRow: rowIndex };
  if (selection.type === 'cell') return { type: 'row', anchorRow: selection.anchor.row, focusRow: rowIndex };
  return { type: 'row', anchorRow: 0, focusRow: rowIndex };
}

function extendSelectionToColumn(selection: CsvSelection, columnIndex: number): CsvSelection {
  if (selection.type === 'column') return { ...selection, focusCol: columnIndex };
  if (selection.type === 'cell') return { type: 'column', anchorCol: selection.anchor.col, focusCol: columnIndex };
  return { type: 'column', anchorCol: 0, focusCol: columnIndex };
}

function getActionRowIndexes(bounds: SelectionBounds | null, rowIndex: number): number[] {
  if (!bounds || bounds.type !== 'row' || rowIndex < bounds.rowStart || rowIndex > bounds.rowEnd) {
    return [rowIndex];
  }
  return range(bounds.rowStart, bounds.rowEnd);
}

function getActionColumnIndexes(bounds: SelectionBounds | null, columnIndex: number): number[] {
  if (!bounds || bounds.type !== 'column' || columnIndex < bounds.colStart || columnIndex > bounds.colEnd) {
    return [columnIndex];
  }
  return range(bounds.colStart, bounds.colEnd);
}

function selectionToTsv(
  columns: CsvColumn[],
  rows: string[][],
  bounds: SelectionBounds,
  hasHeader: boolean,
): string {
  const matrix: string[][] = [];
  if (bounds.type === 'column' && hasHeader) {
    matrix.push(range(bounds.colStart, bounds.colEnd).map((columnIndex) => columns[columnIndex]?.header ?? ''));
  }
  for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    matrix.push(range(bounds.colStart, bounds.colEnd).map((columnIndex) => row[columnIndex] ?? ''));
  }
  return Papa.unparse(matrix, {
    delimiter: '\t',
    newline: '\n',
  });
}

function parseClipboardMatrix(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
  if (normalized.length === 0) return [];
  const result = Papa.parse<string[]>(normalized, {
    delimiter: normalized.includes('\t') ? '\t' : '',
    skipEmptyLines: false,
  });
  const rows = result.data
    .filter(Array.isArray)
    .map((row) => row.map((cell) => String(cell ?? '')));
  const maxWidth = Math.max(0, ...rows.map((row) => row.length));
  if (maxWidth === 0) return [];
  return rows.map((row) => normalizeRowLength(row, maxWidth));
}

function normalizeRowLength(row: string[], length: number): string[] {
  return Array.from({ length }, (_, index) => row[index] ?? '');
}

function formatSelectionSummary(bounds: SelectionBounds): string {
  const rowCount = bounds.rowEnd - bounds.rowStart + 1;
  const columnCount = bounds.colEnd - bounds.colStart + 1;
  if (bounds.type === 'row') {
    return `${formatNumber(rowCount)} ${rowCount === 1 ? 'row' : 'rows'} selected`;
  }
  if (bounds.type === 'column') {
    return `${formatNumber(columnCount)} ${columnCount === 1 ? 'column' : 'columns'} selected`;
  }
  if (rowCount === 1 && columnCount === 1) {
    return `${columnName(bounds.colStart)}${bounds.rowStart + 1}`;
  }
  return `${formatNumber(rowCount)} x ${formatNumber(columnCount)} selected`;
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path.
    }
  }
  if (typeof document === 'undefined') return;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

function clampIndex(value: number, maxIndex: number): number {
  return Math.max(0, Math.min(value, maxIndex));
}

function parseCsv(content: string, nodeName: string, headerMode: CsvHeaderMode): ParsedCsv {
  const isTsv = nodeName.toLowerCase().endsWith('.tsv');
  if (content.trim().length === 0) {
    return {
      columns: [],
      rows: [],
      errors: [],
      delimiter: isTsv ? '\t' : ',',
      hasHeader: false,
    };
  }

  const result = Papa.parse<string[]>(content, {
    delimiter: isTsv ? '\t' : '',
    skipEmptyLines: false,
  });
  let rawRows = result.data
    .filter(Array.isArray)
    .map((row) => row.map((cell) => String(cell ?? '')));
  const parserAddedTrailingRow =
    /(?:\r\n|\n|\r)$/.test(content) &&
    rawRows.length > 0 &&
    (rawRows[rawRows.length - 1]?.length ?? 0) <= 1 &&
    rawRows[rawRows.length - 1]?.every((cell) => cell.trim() === '');
  if (parserAddedTrailingRow) {
    rawRows = rawRows.slice(0, -1);
  }

  if (rawRows.length === 0) {
    return {
      columns: [],
      rows: [],
      errors: result.errors,
      delimiter: result.meta.delimiter || (isTsv ? '\t' : ','),
      hasHeader: false,
    };
  }

  const maxColumns = Math.max(...rawRows.map((row) => row.length));
  const hasHeader =
    headerMode === 'header' ? true
    : headerMode === 'none' ? false
    : inferHasHeader(rawRows, maxColumns);
  const rows = (hasHeader ? rawRows.slice(1) : rawRows).map((row) =>
    Array.from({ length: maxColumns }, (_, index) => row[index] ?? ''),
  );
  const columns = createColumns(rawRows[0] ?? [], rows, maxColumns, hasHeader);

  return {
    columns,
    rows,
    errors: result.errors,
    delimiter: result.meta.delimiter || (isTsv ? '\t' : ','),
    hasHeader,
  };
}

function stringifyCsv(columns: CsvColumn[], rows: string[][], delimiter: string, hasHeader: boolean): string {
  if (columns.length === 0) return '';
  const body = rows.map((row) => Array.from({ length: columns.length }, (_, index) => row[index] ?? ''));
  const matrix = hasHeader ? [columns.map((column) => column.header), ...body] : body;
  return Papa.unparse(matrix, {
    delimiter: delimiter || ',',
    newline: '\n',
  });
}

function createColumns(
  headerRow: string[],
  rows: string[][],
  maxColumns: number,
  hasHeader: boolean,
): CsvColumn[] {
  if (!hasHeader) {
    return Array.from({ length: maxColumns }, (_, index) => ({
      header: columnName(index),
      label: columnName(index),
      kind: inferColumnKind(rows.map((row) => row[index] ?? '')),
    }));
  }

  const rawHeaders = Array.from({ length: maxColumns }, (_, index) => headerRow[index] ?? '');
  const labels = dedupeHeaders(rawHeaders.map((header, index) => header.trim() || `Column ${columnName(index)}`));
  return rawHeaders.map((header, index) => ({
    header,
    label: labels[index] ?? `Column ${columnName(index)}`,
    kind: inferColumnKind(rows.map((row) => row[index] ?? '')),
  }));
}

function inferHasHeader(rawRows: string[][], maxColumns: number): boolean {
  if (rawRows.length < 2) return false;
  const firstRow = Array.from({ length: maxColumns }, (_, index) => rawRows[0]?.[index]?.trim() ?? '');
  const bodyRows = rawRows.slice(1, Math.min(rawRows.length, 12));
  const nonEmptyHeaders = firstRow.filter(Boolean);
  if (nonEmptyHeaders.length === 0) return false;
  if (nonEmptyHeaders.some((value) => isNumericCell(value) || isBooleanCell(value) || isDateCell(value))) {
    return false;
  }

  const uniqueHeaderCount = new Set(nonEmptyHeaders.map((value) => value.toLowerCase())).size;
  let score = uniqueHeaderCount === nonEmptyHeaders.length ? 1 : 0;
  for (let index = 0; index < maxColumns; index += 1) {
    const header = firstRow[index] ?? '';
    if (!header) continue;
    const sample = bodyRows.map((row) => row[index]?.trim() ?? '').filter(Boolean);
    if (sample.length === 0) continue;
    if (sample.some((value) => isNumericCell(value) || isBooleanCell(value) || isDateCell(value))) {
      score += 1;
    }
  }
  return score >= Math.min(2, nonEmptyHeaders.length);
}

function createBlankColumn(existingColumns: CsvColumn[]): CsvColumn {
  const header = nextColumnHeader(existingColumns.map((column) => column.header));
  return { header, label: header, kind: 'text' };
}

function nextColumnHeader(existingHeaders: string[]): string {
  const existing = new Set(existingHeaders.map((header) => header.trim()).filter(Boolean));
  let index = existingHeaders.length;
  let candidate = `Column ${columnName(index)}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `Column ${columnName(index)}`;
  }
  return candidate;
}

function inferColumnKind(values: string[]): CsvColumn['kind'] {
  const sample = values.map((value) => value.trim()).filter(Boolean).slice(0, 40);
  if (sample.length === 0) return 'text';
  if (sample.every(isNumericCell)) return 'number';
  if (sample.every(isBooleanCell)) return 'boolean';
  if (sample.length >= 2 && sample.every(isDateCell)) return 'date';
  return 'text';
}

function isNumericCell(value: string): boolean {
  return /^[-+]?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?%?$/.test(value);
}

function isBooleanCell(value: string): boolean {
  return /^(true|false|yes|no)$/i.test(value);
}

function isDateCell(value: string): boolean {
  return (
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(value) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value)
  );
}

function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header) => {
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    return count === 0 ? header : `${header} ${count + 1}`;
  });
}

function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

function columnName(index: number): string {
  let value = '';
  let n = index;
  do {
    value = String.fromCharCode(65 + (n % 26)) + value;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return value;
}

const csvTableStyles = `
  .csv-table-viewer {
    flex: 1;
    min-height: 0;
    min-width: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    background: var(--po-canvas);
    color: var(--po-text);
    font-family: var(--po-font-sans);
    outline: none;
  }

  .csv-table-viewer__toolbar {
    height: 40px;
    flex-shrink: 0;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 14px;
    border-bottom: 1px solid var(--po-border-subtle);
    background: color-mix(in srgb, var(--po-canvas) 88%, var(--po-text) 3%);
  }

  .csv-table-viewer__title {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .csv-table-viewer__toolbar-actions {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .csv-table-viewer__selection-actions {
    height: 26px;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px 0 8px;
    border: 1px solid color-mix(in srgb, var(--po-accent) 22%, var(--po-border) 78%);
    border-radius: 6px;
    background: color-mix(in srgb, var(--po-accent) 5%, var(--po-control) 95%);
    color: var(--po-text-muted);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--po-canvas) 58%, transparent);
  }

  .csv-table-viewer__selection-summary {
    max-width: 138px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    line-height: 16px;
    font-weight: 600;
    color: var(--po-text);
  }

  .csv-table-viewer__selection-button {
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--po-text-muted);
    font-family: var(--po-font-sans);
    font-size: 11.5px;
    line-height: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .csv-table-viewer__selection-button:hover {
    background: color-mix(in srgb, var(--po-accent) 9%, var(--po-control-hover) 91%);
    color: var(--po-text);
  }

  .csv-table-viewer__selection-button--danger:hover {
    background: color-mix(in srgb, var(--po-danger) 9%, transparent);
    color: var(--po-danger);
  }

  .csv-table-viewer__header-toggle {
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--po-text-muted);
    font-size: 11.5px;
    line-height: 16px;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
  }

  .csv-table-viewer__header-toggle input {
    width: 14px;
    height: 14px;
    accent-color: color-mix(in srgb, var(--po-accent) 58%, var(--po-text-muted) 42%);
    margin: 0;
  }

  .csv-table-viewer__name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 18px;
    font-weight: 600;
    color: var(--po-text);
  }

  .csv-table-viewer__meta,
  .csv-table-viewer__warning {
    flex-shrink: 0;
    font-size: 11.5px;
    line-height: 16px;
    font-weight: 500;
    color: var(--po-text-disabled);
  }

  .csv-table-viewer__warning {
    color: var(--po-warning);
  }

  .csv-table-viewer__button {
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 10px;
    border: 1px solid var(--po-border);
    border-radius: 5px;
    background: var(--po-control);
    color: var(--po-text-muted);
    font-family: var(--po-font-sans);
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }

  .csv-table-viewer__button:hover {
    background: var(--po-control-hover);
    border-color: var(--po-border-strong);
    color: var(--po-text);
  }

  .csv-table-viewer__scroll {
    flex: 1;
    min-height: 0;
    min-width: 0;
    width: 100%;
    overflow-x: auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    background: var(--po-canvas);
  }

  .csv-table-viewer__top-scroll {
    height: 13px;
    flex-shrink: 0;
    min-width: 0;
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    border-bottom: 1px solid var(--po-border-subtle);
    background: color-mix(in srgb, var(--po-canvas) 94%, var(--po-text) 2%);
    scrollbar-gutter: stable;
  }

  .csv-table-viewer__top-scroll::-webkit-scrollbar,
  .csv-table-viewer__scroll::-webkit-scrollbar {
    height: 11px;
    width: 11px;
  }

  .csv-table-viewer__top-scroll::-webkit-scrollbar-thumb,
  .csv-table-viewer__scroll::-webkit-scrollbar-thumb {
    border: 3px solid transparent;
    border-radius: 999px;
    background: color-mix(in srgb, var(--po-text-muted) 42%, transparent);
    background-clip: padding-box;
  }

  .csv-table-viewer__top-scroll::-webkit-scrollbar-thumb:hover,
  .csv-table-viewer__scroll::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--po-text-muted) 62%, transparent);
    background-clip: padding-box;
  }

  .csv-table-viewer__top-scroll-spacer {
    width: 100%;
    min-width: var(--csv-grid-min-width);
    height: 1px;
  }

  .csv-table-viewer__grid {
    min-height: 100%;
    width: 100%;
    min-width: var(--csv-grid-min-width);
    background: var(--po-canvas);
    user-select: none;
  }

  .csv-table-viewer__row {
    display: grid;
    grid-template-columns: var(--csv-grid-template);
    width: 100%;
    min-width: var(--csv-grid-min-width);
    box-sizing: border-box;
  }

  .csv-table-viewer__header-row {
    position: sticky;
    top: 0;
    z-index: 3;
    height: ${HEADER_HEIGHT}px;
    background: color-mix(in srgb, var(--po-control) 58%, var(--po-canvas) 42%);
    border-bottom: 1px solid var(--po-border);
    box-shadow: 0 1px 0 var(--po-border-subtle);
  }

  .csv-table-viewer__virtual-space {
    position: relative;
    width: 100%;
    min-width: var(--csv-grid-min-width);
  }

  .csv-table-viewer__body-row {
    position: absolute;
    top: 0;
    left: 0;
    border-bottom: 1px solid var(--po-border-subtle);
  }

  .csv-table-viewer__body-row--menu-open {
    z-index: 5;
  }

  .csv-table-viewer__body-row:nth-child(even) {
    background: color-mix(in srgb, var(--po-control) 14%, transparent);
  }

  .csv-table-viewer__cell {
    box-sizing: border-box;
    min-width: 0;
    display: flex;
    align-items: center;
    height: 100%;
    padding: 0 10px;
    border-right: 1px solid var(--po-border-subtle);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: 0;
  }

  .csv-table-viewer__add-column-cell {
    justify-content: center;
    padding: 0;
    color: var(--po-text-disabled);
    background: color-mix(in srgb, var(--po-control) 18%, transparent);
  }

  .csv-table-viewer__edge-button {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--po-text-muted);
    font-family: var(--po-font-sans);
    font-size: 17px;
    line-height: 18px;
    font-weight: 600;
    cursor: pointer;
    opacity: 0.42;
    transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
  }

  .csv-table-viewer__grid:hover .csv-table-viewer__edge-button,
  .csv-table-viewer__edge-button:focus-visible {
    opacity: 1;
  }

  .csv-table-viewer__edge-button:hover {
    background: var(--po-control-hover);
    color: var(--po-text);
  }

  .csv-table-viewer__add-row-band {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 4;
    width: 100%;
    min-width: var(--csv-grid-min-width);
    height: ${ADD_ROW_HEIGHT}px;
    display: grid;
    grid-template-columns: var(--csv-grid-template);
    align-items: center;
    box-sizing: border-box;
    border: none;
    border-top: 1px solid var(--po-border-subtle);
    border-bottom: 1px solid var(--po-border-subtle);
    background: transparent;
    color: var(--po-text-disabled);
    cursor: pointer;
    padding: 0;
    text-align: left;
    font-family: var(--po-font-sans);
  }

  .csv-table-viewer__add-row-gutter {
    grid-column: 1;
    position: sticky;
    left: 0;
    z-index: 1;
    height: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    box-sizing: border-box;
    padding-right: 10px;
    border-right: 1px solid var(--po-border);
    background: var(--po-canvas);
    color: var(--po-text-muted);
    font-size: 15px;
    line-height: 16px;
    font-weight: 600;
    opacity: 0.5;
    transition: opacity 0.12s ease, color 0.12s ease;
  }

  .csv-table-viewer__add-row-label {
    grid-column: 2 / -1;
    height: 100%;
    display: inline-flex;
    align-items: center;
    padding-left: 10px;
    color: var(--po-text-disabled);
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
    opacity: 0;
    transition: opacity 0.12s ease, color 0.12s ease;
  }

  .csv-table-viewer__add-row-band:hover {
    background: color-mix(in srgb, var(--po-control) 16%, transparent);
  }

  .csv-table-viewer__grid:hover .csv-table-viewer__add-row-label,
  .csv-table-viewer__add-row-band:focus-visible .csv-table-viewer__add-row-label,
  .csv-table-viewer__add-row-band:hover .csv-table-viewer__add-row-label {
    opacity: 1;
  }

  .csv-table-viewer__add-row-band:hover .csv-table-viewer__add-row-gutter,
  .csv-table-viewer__add-row-band:hover .csv-table-viewer__add-row-label {
    color: var(--po-text);
    opacity: 1;
  }

  .csv-table-viewer__header-cell {
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    color: var(--po-text-muted);
  }

  .csv-table-viewer__header-cell--selected,
  .csv-table-viewer__row-number--selected,
  .csv-table-viewer__body-cell--selected {
    background: color-mix(in srgb, var(--po-accent) 8%, var(--po-canvas) 92%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--po-accent) 40%, var(--po-border-strong) 60%);
    color: var(--po-text);
  }

  .csv-table-viewer__header-cell--selected,
  .csv-table-viewer__row-number--selected {
    background: color-mix(in srgb, var(--po-accent) 10%, var(--po-control) 90%);
  }

  .csv-table-viewer__column-header-cell {
    position: relative;
    overflow: visible;
    padding-right: 34px;
  }

  .csv-table-viewer__column-header-cell:focus-within,
  .csv-table-viewer__body-cell:focus-within {
    background: color-mix(in srgb, var(--po-accent) 9%, var(--po-canvas) 91%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--po-accent) 52%, var(--po-border-strong) 48%);
    color: var(--po-text);
  }

  .csv-table-viewer__body-cell {
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
    color: var(--po-text);
  }

  .csv-table-viewer__body-cell--empty {
    color: var(--po-text-disabled);
  }

  .csv-table-viewer__body-cell--selected.csv-table-viewer__body-cell--empty {
    color: var(--po-text-muted);
  }

  .csv-table-viewer__body-cell--editing {
    background: color-mix(in srgb, var(--po-accent) 9%, var(--po-canvas) 91%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--po-accent) 52%, var(--po-border-strong) 48%);
    color: var(--po-text);
  }

  .csv-table-viewer__cell-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }

  .csv-table-viewer__cell--number {
    justify-content: flex-end;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .csv-table-viewer__cell--date,
  .csv-table-viewer__cell--boolean {
    font-variant-numeric: tabular-nums;
  }

  .csv-table-viewer__input {
    width: 100%;
    min-width: 0;
    height: 100%;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: inherit;
    outline: none;
    padding: 0 4px;
    user-select: text;
  }

  .csv-table-viewer__input:hover {
    background: transparent;
  }

  .csv-table-viewer__input:focus {
    background: transparent;
    border-color: transparent;
    color: var(--po-text);
  }

  .csv-table-viewer__input::placeholder {
    color: var(--po-text-disabled);
  }

  .csv-table-viewer__corner,
  .csv-table-viewer__row-number {
    position: sticky;
    left: 0;
    z-index: 2;
    justify-content: flex-end;
    padding-right: 9px;
    border-right: 1px solid var(--po-border);
    background: color-mix(in srgb, var(--po-control) 58%, var(--po-canvas) 42%);
    color: var(--po-text-disabled);
    font-size: 11px;
    font-weight: 500;
  }

  .csv-table-viewer__row-number {
    gap: 3px;
    justify-content: flex-end;
    padding: 0 4px;
  }

  .csv-table-viewer__row-number > span {
    flex: 1;
    min-width: 0;
    text-align: right;
  }

  .csv-table-viewer__structure-menu-host {
    position: absolute;
    top: 50%;
    right: 6px;
    z-index: 8;
    transform: translateY(-50%);
  }

  .csv-table-viewer__row-menu-host {
    position: relative;
    top: auto;
    right: auto;
    flex-shrink: 0;
    transform: none;
  }

  .csv-table-viewer__structure-button {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--po-border);
    border-radius: 5px;
    background: color-mix(in srgb, var(--po-control) 58%, transparent);
    color: var(--po-text-muted);
    font-family: var(--po-font-sans);
    font-size: 13px;
    line-height: 12px;
    font-weight: 700;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
  }

  .csv-table-viewer__column-header-cell:hover .csv-table-viewer__structure-button,
  .csv-table-viewer__row-number:hover .csv-table-viewer__structure-button,
  .csv-table-viewer__structure-button[aria-expanded='true'],
  .csv-table-viewer__structure-button:focus-visible {
    opacity: 1;
  }

  .csv-table-viewer__structure-button:hover,
  .csv-table-viewer__structure-button[aria-expanded='true'] {
    background: var(--po-hover);
    color: var(--po-text);
  }

  .csv-table-viewer__menu-surface {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 142px;
    padding: 4px;
    border: 1px solid var(--po-border);
    border-radius: 6px;
    background: var(--po-panel-raised);
    box-shadow: 0 8px 20px var(--po-shadow);
    z-index: 12;
  }

  .csv-table-viewer__row-menu {
    top: 0;
    right: auto;
    left: calc(100% + 4px);
  }

  .csv-table-viewer__menu-surface button {
    width: 100%;
    height: 28px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--po-text-muted);
    font-family: var(--po-font-sans);
    font-size: 12.5px;
    line-height: 16px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }

  .csv-table-viewer__menu-surface button:hover {
    background: var(--po-hover);
    color: var(--po-text);
  }

  .csv-table-viewer__menu-surface button:disabled {
    color: var(--po-text-disabled);
    cursor: default;
  }

  .csv-table-viewer__menu-surface button:disabled:hover {
    background: transparent;
    color: var(--po-text-disabled);
  }

  .csv-table-viewer__corner {
    z-index: 4;
  }

  .csv-table-viewer__row-number {
    background: var(--po-canvas);
    position: sticky;
    overflow: visible;
  }

  .csv-table-viewer__body-row:nth-child(even) .csv-table-viewer__row-number {
    background: color-mix(in srgb, var(--po-control) 14%, var(--po-canvas) 86%);
  }

  .csv-table-viewer__empty {
    height: 100%;
    min-height: 180px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--po-text-disabled);
    font-size: 13px;
    font-weight: 500;
  }
`;

export default CsvTableViewer;
