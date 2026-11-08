import React, { useRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { CsvTableEditor } from "../../../src/shared-ui/editor/viewers/csv/CsvTableEditor";
import type { EditorSourceSnapshotPort } from "../../../src/shared-ui/editor/sourceSnapshot";
import { withTestLocalization } from "../react/localization";

/** A mounted CSV table with its source snapshot, geometry and pointer stubs, for the table interaction tests. */
export let root: Root | null = null;

export let container: HTMLDivElement | null = null;

export let latestSnapshot = "";

export let changeCount = 0;

/** Registers the shared setup in the calling test file. */
export function setUpCsvTable() {
  beforeEach(async () => {
    window.localStorage.clear();
    latestSnapshot = "Name,Score\nAda,1\nLin,2";
    changeCount = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(<Harness />));
      await Promise.resolve();
    });
  });
  afterEach(async () => {
    act(() => root?.unmount());
    root = null;
    container = null;
    document.body.replaceChildren();
    vi.useRealTimers();
    window.localStorage.clear();
    vi.restoreAllMocks();
    await act(async () => Promise.resolve());
  });
}

export function Harness({ documentId = "table.csv" }: { documentId?: string }) {
  const initialContentRef = useRef(latestSnapshot);
  const snapshotPortRef = useRef<EditorSourceSnapshotPort | null>(null);
  return (
    <CsvTableEditor
      content={initialContentRef.current}
      documentId={documentId}
      nodeName="table.csv"
      readOnly={false}
      onSnapshotPortChange={(port) => {
        snapshotPortRef.current = port;
      }}
      onSourceRevisionChange={(revision) => {
        if (revision.origin !== "local-edit") return;
        changeCount += 1;
        latestSnapshot = snapshotPortRef.current?.readSnapshot().content ?? latestSnapshot;
      }}
    />
  );
}

export function mockTableGeometry() {
  const surface = container?.querySelector<HTMLElement>(".csv-table-editor__surface");
  const scrollContainer = container?.querySelector<HTMLElement>(".csv-table-editor__scroll");
  const table = container?.querySelector<HTMLTableElement>(".csv-table-editor__table");
  const headerRecordCell = container?.querySelector<HTMLTableCellElement>("thead [data-csv-record-index]");
  const headerCells = Array.from(container?.querySelectorAll<HTMLTableCellElement>("thead th[data-csv-column]") ?? []);
  const bodyRows = Array.from(container?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? []);
  if (!surface || !scrollContainer || !table || !headerRecordCell || headerCells.length !== 2 || bodyRows.length !== 2) {
    throw new Error("CSV table geometry could not be prepared.");
  }
  mockRect(scrollContainer, rect(80, 70, 800, 600));
  mockRect(surface, rect(100, 100, 223, 93));
  mockRect(table, rect(100, 100, 223, 93));
  mockRect(headerRecordCell, rect(100, 100, 31, 31));
  headerCells.forEach((cell, index) => mockRect(cell, rect(131 + index * 96, 100, 96, 31)));
  bodyRows.forEach((row, rowIndex) => {
    mockRect(row, rect(100, 131 + rowIndex * 31, 223, 31));
    const recordIndexCell = row.querySelector<HTMLTableCellElement>("[data-csv-record-index]");
    if (!recordIndexCell) throw new Error("CSV record index cell did not mount.");
    mockRect(recordIndexCell, rect(100, 131 + rowIndex * 31, 31, 31));
    Array.from(row.querySelectorAll<HTMLTableCellElement>("td[data-csv-column]")).forEach((cell, columnIndex) => {
      mockRect(cell, rect(131 + columnIndex * 96, 131 + rowIndex * 31, 96, 31));
    });
  });
  const firstBodyCell = bodyRows[0].querySelector<HTMLTableCellElement>("td[data-csv-column='0']");
  const firstRecordIndexCell = bodyRows[0].querySelector<HTMLTableCellElement>("[data-csv-record-index]");
  if (!firstBodyCell || !firstRecordIndexCell) throw new Error("CSV first data row did not mount.");
  return { firstBodyCell, firstHeaderCell: headerCells[0], firstRecordIndexCell };
}

export function findButton(label: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => (
      button.querySelector(".desktop-menu-item-label")?.textContent?.trim()
      ?? button.textContent?.trim()
    ) === label) ?? null;
}

export function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
}

export function pointerEvent(type: string, clientX: number, clientY: number, pointerId: number) {
  return new PointerEvent(type, { bubbles: true, button: 0, clientX, clientY, pointerId });
}

export function makePointerCaptureSafe(handle: HTMLElement) {
  let capturedPointer: number | null = null;
  Object.defineProperties(handle, {
    hasPointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointer === pointerId,
    },
    releasePointerCapture: {
      configurable: true,
      value: (pointerId: number) => {
        if (capturedPointer === pointerId) capturedPointer = null;
      },
    },
    setPointerCapture: {
      configurable: true,
      value: (pointerId: number) => {
        capturedPointer = pointerId;
      },
    },
  });
}

export function mockRect(element: Element, value: DOMRect) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => value,
  });
}

export function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Replaces the mounted table, as reopening the document would. */
export function remount(node: React.ReactNode) {
  root?.unmount();
  root = createRoot(container!);
  root.render(node);
}

/** Unmounts the table before the test ends, as closing its pane would. */
export function unmountRoot() {
  root?.unmount();
  root = null;
}

/** The CSV the next mounted table opens. */
export function setLatestSnapshot(value: string) {
  latestSnapshot = value;
}
