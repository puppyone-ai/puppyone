import {
  EDITABLE_TABLE_COLUMN_INITIAL_MAX_WIDTH,
  EDITABLE_TABLE_COLUMN_RESIZE_MAX_WIDTH,
  clampEditableTableColumnWidth,
  estimateEditableTableColumnWidth,
  estimateEditableTableColumnWidths,
  fitEditableTableColumnWidths,
} from "../../table/editableTableLayout";
import type {
  CsvDocumentModel,
  CsvModelColumn,
  CsvModelRow,
} from "./CsvDocumentModel";

export const CSV_COLUMN_MAX_WIDTH = EDITABLE_TABLE_COLUMN_RESIZE_MAX_WIDTH;
export const CSV_COLUMN_INITIAL_MAX_WIDTH = EDITABLE_TABLE_COLUMN_INITIAL_MAX_WIDTH;

export type CsvColumnLayoutSnapshot = Readonly<{
  columnIds: readonly string[];
  revision: string;
  widths: readonly number[];
}>;

export type CsvColumnLayoutPersistence = Readonly<{
  read: (columnCount: number) => readonly number[] | undefined;
  write: (widths: readonly number[]) => void;
}>;

/**
 * View-only CSV column geometry. It deliberately lives beside, rather than
 * inside, CsvDocumentModel: editing cell content must never resize the table
 * or enter column widths into document undo/redo history.
 */
export class CsvColumnLayoutModel {
  private readonly knownWidths = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private unsubscribeFromDocument: (() => void) | null = null;
  private revisionSequence = 0;
  private sourceEpoch: number;
  private state: CsvColumnLayoutSnapshot;

  constructor(
    private readonly documentModel: CsvDocumentModel,
    private readonly persistence: CsvColumnLayoutPersistence,
  ) {
    const document = documentModel.getSnapshot();
    const estimatedWidths = estimateWidths(document.rows, document.columns.length);
    const restoredWidths = normalizeRestoredWidths(
      persistence.read(document.columns.length),
      document.columns.length,
    );
    const widths = restoredWidths ?? estimatedWidths;
    document.columns.forEach((column, index) => {
      this.knownWidths.set(column.id, widths[index]);
    });
    this.sourceEpoch = document.epoch;
    this.state = this.createSnapshot(document.columns, widths);
  }

  readonly getSnapshot = (): CsvColumnLayoutSnapshot => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    // React may discard a render or replay subscriptions in StrictMode. Only
    // mounted consumers own a document subscription; reconnecting also catches
    // structural edits made while this view was detached.
    if (!this.unsubscribeFromDocument) {
      this.unsubscribeFromDocument = this.documentModel.subscribe(this.syncFromDocument);
      this.syncFromDocument();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.unsubscribeFromDocument?.();
        this.unsubscribeFromDocument = null;
      }
    };
  };

  readonly setColumnWidth = (columnIndex: number, width: number): void => {
    const columnId = this.state.columnIds[columnIndex];
    if (!columnId) return;
    const normalizedWidth = clampColumnWidth(width);
    if (normalizedWidth === this.state.widths[columnIndex]) return;
    const widths = replaceAt(this.state.widths, columnIndex, normalizedWidth);
    this.knownWidths.set(columnId, normalizedWidth);
    this.publish(this.state.columnIds, widths);
  };

  readonly commitColumnWidths = (): void => {
    this.persistence.write(this.state.widths);
  };

  autoFitColumn(columnIndex: number): void {
    const document = this.documentModel.getSnapshot();
    if (!document.columns[columnIndex]) return;
    this.setColumnWidth(
      columnIndex,
      estimateEditableTableColumnWidth(document.rows, columnIndex, (row) => row.cells),
    );
    this.commitColumnWidths();
  }

  resetColumnWidths(): void {
    const document = this.documentModel.getSnapshot();
    this.replaceAllWidths(estimateWidths(document.rows, document.columns.length));
  }

  fitToViewport(availableWidth: number): void {
    if (!Number.isFinite(availableWidth) || availableWidth <= 0) return;
    this.replaceAllWidths(fitCsvColumnWidths(this.state.widths, availableWidth));
  }

  private readonly syncFromDocument = (): void => {
    const document = this.documentModel.getSnapshot();
    const previousIds = this.state.columnIds;
    const nextIds = document.columns.map((column) => column.id);
    const sameColumns = arraysEqual(previousIds, nextIds);

    // Cell edits and row-only operations are intentionally geometry-neutral.
    if (sameColumns && document.epoch === this.sourceEpoch) return;

    const estimates = estimateWidths(document.rows, document.columns.length);
    let widths: readonly number[];
    if (document.epoch !== this.sourceEpoch) {
      // External source replacement creates fresh model identities. Preserve
      // compatible tracks by ordinal, then estimate only genuinely new ones.
      widths = document.columns.map((column, index) => {
        const width = this.state.widths[index] ?? estimates[index];
        this.knownWidths.set(column.id, width);
        return width;
      });
      this.sourceEpoch = document.epoch;
    } else {
      // Structural transactions retain column identities, so widths follow a
      // moved column and survive delete/undo through the known-width cache.
      widths = document.columns.map((column, index) => {
        const width = this.knownWidths.get(column.id) ?? estimates[index];
        this.knownWidths.set(column.id, width);
        return width;
      });
    }

    this.publish(nextIds, widths);
    this.persistence.write(widths);
  };

  private replaceAllWidths(widths: readonly number[]): void {
    if (arraysEqual(this.state.widths, widths)) {
      this.commitColumnWidths();
      return;
    }
    this.state.columnIds.forEach((columnId, index) => {
      this.knownWidths.set(columnId, widths[index]);
    });
    this.publish(this.state.columnIds, widths);
    this.commitColumnWidths();
  }

  private publish(columnIds: readonly string[], widths: readonly number[]): void {
    this.state = this.createSnapshot(columnIds, widths);
    for (const listener of this.listeners) listener();
  }

  private createSnapshot(
    columns: readonly CsvModelColumn[] | readonly string[],
    widths: readonly number[],
  ): CsvColumnLayoutSnapshot {
    this.revisionSequence += 1;
    return {
      columnIds: columns.map((column) => typeof column === "string" ? column : column.id),
      revision: `csv-column-layout:${this.revisionSequence}`,
      widths,
    };
  }
}

export function fitCsvColumnWidths(
  currentWidths: readonly number[],
  availableWidth: number,
): readonly number[] {
  return fitEditableTableColumnWidths(currentWidths, availableWidth, CSV_COLUMN_MAX_WIDTH);
}

function estimateWidths(rows: readonly CsvModelRow[], columnCount: number): readonly number[] {
  return estimateEditableTableColumnWidths(rows, columnCount, (row) => row.cells)
    .map((width) => Math.min(CSV_COLUMN_INITIAL_MAX_WIDTH, width));
}

function normalizeRestoredWidths(
  widths: readonly number[] | undefined,
  columnCount: number,
): readonly number[] | undefined {
  if (!widths || widths.length !== columnCount) return undefined;
  if (widths.some((width) => !Number.isFinite(width) || width <= 0)) return undefined;
  return widths.map(clampColumnWidth);
}

function clampColumnWidth(width: number): number {
  return clampEditableTableColumnWidth(width, CSV_COLUMN_MAX_WIDTH);
}

function replaceAt<T>(items: readonly T[], index: number, value: T): readonly T[] {
  const next = [...items];
  next[index] = value;
  return next;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
