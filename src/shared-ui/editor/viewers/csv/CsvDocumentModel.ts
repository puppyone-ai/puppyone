import type { EditorSourceSnapshot } from "../../sourceSnapshot";
import { DOCUMENT_HISTORY_POLICY } from "../../document-session/historyPolicy";
import {
  normalizeRows,
  parseDelimitedText,
  inferHeaderRow,
  stringifyDelimitedText,
  type DelimitedTextDelimiter,
  type DelimitedTextLayout,
  type ParsedDelimitedText,
} from "./csvDocument";
import {
  applyCsvTableOperation,
  type CsvTableFocusTarget,
  type CsvTableStructureOperation,
} from "./csvTableOperations";

export type CsvModelRow = Readonly<{
  id: string;
  cells: readonly string[];
}>;

export type CsvModelColumn = Readonly<{
  id: string;
}>;

export type CsvDocumentModelSnapshot = Readonly<{
  columns: readonly CsvModelColumn[];
  epoch: number;
  hasSource: boolean;
  layout: DelimitedTextLayout;
  revision: string;
  rows: readonly CsvModelRow[];
  suggestedHeader: boolean;
  warning?: ParsedDelimitedText["warning"];
}>;

export type CsvModelTransactionResult = Readonly<{
  changed: boolean;
  focus?: CsvTableFocusTarget;
  revision: string;
}>;

type CsvModelContent = Omit<CsvDocumentModelSnapshot, "revision">;

/**
 * Canonical structured CSV/TSV model. React subscribes to immutable snapshots;
 * complete source text is produced only through readSnapshot().
 */
export class CsvDocumentModel {
  readonly retainedSource = this;
  private inputEnabled = true;
  setInputEnabled = (enabled: boolean): void => { this.inputEnabled = enabled; };
  private readonly listeners = new Set<() => void>();
  private readonly undoStack: CsvModelContent[] = [];
  private readonly redoStack: CsvModelContent[] = [];
  private readonly historySizes = new WeakMap<readonly CsvModelRow[], number>();
  private identitySequence = 0;
  private revisionSequence = 0;
  private state: CsvDocumentModelSnapshot;
  private serializedCache: EditorSourceSnapshot;

  constructor(
    private readonly documentId: string,
    content: string,
    private readonly delimiter: DelimitedTextDelimiter,
  ) {
    const initial = this.parseContent(content, 0);
    this.state = {
      ...initial,
      revision: this.createRevision(),
    };
    this.serializedCache = { content, revision: this.state.revision };
  }

  readonly getSnapshot = (): CsvDocumentModelSnapshot => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose = (): void => {
    this.inputEnabled = false;
    this.listeners.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  };

  readSnapshot = (): EditorSourceSnapshot => {
    if (this.serializedCache.revision === this.state.revision) return this.serializedCache;
    const content = stringifyDelimitedText(
      this.state.rows.map((row) => row.cells),
      this.delimiter,
      this.state.layout,
      { preserveTerminalEmptyRecord: true },
    );
    this.serializedCache = { content, revision: this.state.revision };
    return this.serializedCache;
  };

  replaceContent = (content: string): EditorSourceSnapshot => {
    const nextContent = this.parseContent(content, this.state.epoch + 1);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.commit(nextContent, false);
    this.serializedCache = { content, revision: this.state.revision };
    return this.serializedCache;
  };

  setCell(rowIndex: number, columnIndex: number, value: string): CsvModelTransactionResult {
    if (!this.inputEnabled) return { changed: false, revision: this.state.revision };
    const row = this.state.rows[rowIndex];
    if (!row || !this.state.columns[columnIndex] || row.cells[columnIndex] === value) {
      return { changed: false, revision: this.state.revision };
    }
    const nextCells = [...row.cells];
    nextCells[columnIndex] = value;
    const nextRows = [...this.state.rows];
    nextRows[rowIndex] = { id: row.id, cells: nextCells };
    this.commit({
      ...this.contentState(),
      hasSource: true,
      rows: nextRows,
    });
    return { changed: true, revision: this.state.revision };
  }

  applyStructureOperation(
    headerEnabled: boolean,
    operation: CsvTableStructureOperation,
  ): CsvModelTransactionResult {
    if (!this.inputEnabled) return { changed: false, revision: this.state.revision };
    const currentMatrix = this.state.rows.map((row) => row.cells);
    const result = applyCsvTableOperation(currentMatrix, headerEnabled, operation);
    if (matricesEqual(currentMatrix, result.rows)) {
      return { changed: false, focus: result.focus, revision: this.state.revision };
    }

    const nextRowIds = transformRowIds(
      this.state.rows.map((row) => row.id),
      headerEnabled,
      operation,
      result.rows.length,
      result.focus,
      () => this.createIdentity("row"),
    );
    const nextColumnCount = Math.max(1, ...result.rows.map((row) => row.length));
    const nextColumnIds = transformColumnIds(
      this.state.columns.map((column) => column.id),
      operation,
      nextColumnCount,
      result.focus,
      () => this.createIdentity("column"),
    );
    const previousRows = new Map(this.state.rows.map((row) => [row.id, row]));
    const nextRows = result.rows.map((cells, index): CsvModelRow => {
      const id = nextRowIds[index] ?? this.createIdentity("row");
      const previous = previousRows.get(id);
      return previous && arraysEqual(previous.cells, cells)
        ? previous
        : { id, cells };
    });
    const nextColumns = nextColumnIds.map((id) => ({ id }));
    this.commit({
      ...this.contentState(),
      columns: nextColumns,
      hasSource: true,
      rows: nextRows,
    });
    return { changed: true, focus: result.focus, revision: this.state.revision };
  }

  appendRow(headerEnabled: boolean): CsvModelTransactionResult {
    const headerRows = headerEnabled ? 1 : 0;
    const currentDataRows = Math.max(0, this.state.rows.length - headerRows);
    if (!this.state.hasSource && !headerEnabled) {
      return {
        changed: false,
        focus: { rowIndex: 0, columnIndex: 0 },
        revision: this.state.revision,
      };
    }
    return this.applyStructureOperation(headerEnabled, {
      type: "expand-to-shape",
      rowIndex: Math.max(headerRows, this.state.rows.length - 1),
      columnIndex: 0,
      targetDataRowCount: currentDataRows + 1,
      targetColumnCount: this.state.columns.length,
    });
  }

  appendColumn(headerEnabled: boolean): CsvModelTransactionResult {
    return this.applyStructureOperation(headerEnabled, {
      type: "expand-to-shape",
      rowIndex: Math.min(headerEnabled ? 1 : 0, this.state.rows.length - 1),
      columnIndex: Math.max(0, this.state.columns.length - 1),
      targetDataRowCount: Math.max(0, this.state.rows.length - (headerEnabled ? 1 : 0)),
      targetColumnCount: this.state.columns.length + 1,
    });
  }

  undo(): CsvModelTransactionResult {
    if (!this.inputEnabled) return { changed: false, revision: this.state.revision };
    const previous = this.undoStack.pop();
    if (!previous) return { changed: false, revision: this.state.revision };
    this.redoStack.push(this.contentState());
    this.commit(previous, false);
    return { changed: true, revision: this.state.revision };
  }

  redo(): CsvModelTransactionResult {
    if (!this.inputEnabled) return { changed: false, revision: this.state.revision };
    const next = this.redoStack.pop();
    if (!next) return { changed: false, revision: this.state.revision };
    this.undoStack.push(this.contentState());
    this.commit(next, false);
    return { changed: true, revision: this.state.revision };
  }

  private parseContent(content: string, epoch: number): CsvModelContent {
    const parsed = parseDelimitedText(content, this.delimiter);
    const matrix = normalizeRows(parsed.rows);
    const rows = matrix.map((cells): CsvModelRow => ({
      id: this.createIdentity("row"),
      cells,
    }));
    const columnCount = Math.max(1, ...matrix.map((row) => row.length));
    const columns = Array.from({ length: columnCount }, (): CsvModelColumn => ({
      id: this.createIdentity("column"),
    }));
    return {
      columns,
      epoch,
      hasSource: content.length > 0,
      layout: parsed.layout,
      rows,
      suggestedHeader: inferHeaderRow(matrix),
      warning: parsed.warning,
    };
  }

  private commit(content: CsvModelContent, recordHistory = true): void {
    if (recordHistory) {
      this.undoStack.push(this.contentState());
      this.redoStack.length = 0;
    }
    this.trimHistory();
    this.state = { ...content, revision: this.createRevision() };
    this.serializedCache = { content: "", revision: "" };
    for (const listener of this.listeners) listener();
  }

  private contentState(): CsvModelContent {
    const { revision: _revision, ...content } = this.state;
    return content;
  }

  private trimHistory(): void {
    let bytes = 0;
    // Account conservatively for complete snapshots; structural sharing can
    // only reduce actual retention. Current content is never evicted.
    for (const stack of [this.undoStack, this.redoStack]) {
      let retained = 0;
      for (let index = stack.length - 1; index >= 0; index--) {
        const rows = stack[index].rows;
        let size = this.historySizes.get(rows);
        if (size === undefined) {
          size = rows.reduce((sum, row) => sum + 64 + row.cells.reduce((cellSum, cell) => cellSum + 16 + cell.length * 2, 0), 0);
          this.historySizes.set(rows, size);
        }
        if (retained >= DOCUMENT_HISTORY_POLICY.maxEntries || bytes + size > DOCUMENT_HISTORY_POLICY.maxBytes) break;
        bytes += size;
        retained++;
      }
      stack.splice(0, stack.length - retained);
    }
  }

  private createIdentity(kind: "row" | "column"): string {
    this.identitySequence += 1;
    return `${kind}:${this.identitySequence}`;
  }

  private createRevision(): string {
    this.revisionSequence += 1;
    return `csv:${this.documentId}:${this.revisionSequence}`;
  }
}

function transformRowIds(
  current: string[],
  headerEnabled: boolean,
  operation: CsvTableStructureOperation,
  nextCount: number,
  focus: CsvTableFocusTarget,
  create: () => string,
): string[] {
  const ids = [...current];
  const firstMovable = headerEnabled ? 1 : 0;
  const source = clampInteger(operation.rowIndex, firstMovable, Math.max(firstMovable, ids.length - 1));
  switch (operation.type) {
    case "insert-row-above":
    case "insert-row-below":
    case "duplicate-row":
      ids.splice(focus.rowIndex, 0, create());
      break;
    case "move-row-up":
    case "move-row-down":
    case "move-row-to":
      moveItem(ids, source, focus.rowIndex);
      break;
    case "delete-row":
      if (nextCount < ids.length) ids.splice(source, 1);
      break;
    default:
      break;
  }
  while (ids.length < nextCount) ids.push(create());
  return ids.slice(0, nextCount);
}

function transformColumnIds(
  current: string[],
  operation: CsvTableStructureOperation,
  nextCount: number,
  focus: CsvTableFocusTarget,
  create: () => string,
): string[] {
  const ids = [...current];
  const source = clampInteger(operation.columnIndex, 0, Math.max(0, ids.length - 1));
  switch (operation.type) {
    case "insert-column-left":
    case "insert-column-right":
      ids.splice(focus.columnIndex, 0, create());
      break;
    case "move-column-left":
    case "move-column-right":
    case "move-column-to":
      moveItem(ids, source, focus.columnIndex);
      break;
    case "delete-column":
      if (nextCount < ids.length) ids.splice(source, 1);
      break;
    default:
      break;
  }
  while (ids.length < nextCount) ids.push(create());
  return ids.slice(0, nextCount);
}

function moveItem<Value>(items: Value[], sourceIndex: number, targetIndex: number): void {
  if (sourceIndex === targetIndex || !items[sourceIndex]) return;
  const [item] = items.splice(sourceIndex, 1);
  items.splice(clampInteger(targetIndex, 0, items.length), 0, item);
}

function matricesEqual(
  left: readonly (readonly string[])[],
  right: readonly (readonly string[])[],
): boolean {
  return left.length === right.length && left.every((row, index) => arraysEqual(row, right[index]));
}

function arraysEqual<Value>(left: readonly Value[], right: readonly Value[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
