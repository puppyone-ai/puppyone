/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorSourceSnapshotPort } from "../../../../../packages/shared-ui/src/editor/sourceSnapshot";
import { CsvTableEditor } from "../../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableEditor";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CSV bounded renderer performance", () => {
  it("keeps a 500 by 20 table below the mounted row and cell budgets", async () => {
    const snapshotPort: { current: EditorSourceSnapshotPort | null } = { current: null };
    const localRevisions: string[] = [];
    await act(async () => {
      root.render(withTestLocalization(
        <CsvTableEditor
          content={makeCsv(500, 20)}
          documentId="500x20.csv"
          nodeName="500x20.csv"
          readOnly={false}
          onSnapshotPortChange={(port) => { snapshotPort.current = port; }}
          onSourceRevisionChange={(revision) => {
            if (revision.origin === "local-edit") localRevisions.push(revision.revision);
          }}
        />,
      ));
      await Promise.resolve();
    });

    const table = required<HTMLTableElement>(container, ".csv-table-editor__table");
    expect(table.getAttribute("aria-rowcount")).toBe("500");
    expect(Number(table.dataset.csvMountedRows)).toBeLessThanOrEqual(80);
    expect(Number(table.dataset.csvMountedCells)).toBeLessThanOrEqual(2_000);
    expect(container.querySelectorAll("tbody tr[data-csv-row]").length).toBeLessThanOrEqual(80);
    expect(container.querySelectorAll("input[data-csv-row][data-csv-column]").length)
      .toBeLessThanOrEqual(2_000);

    if (!snapshotPort.current) throw new Error("CSV snapshot port did not attach.");
    const readSnapshot = vi.spyOn(snapshotPort.current, "readSnapshot");
    const target = required<HTMLInputElement>(container, 'input[data-csv-row="0"][data-csv-column="0"]');
    const stable = required<HTMLInputElement>(container, 'input[data-csv-row="1"][data-csv-column="0"]');
    await act(async () => {
      setInputValue(target, "updated");
      target.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(localRevisions).toHaveLength(1);
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(container.querySelector('input[data-csv-row="1"][data-csv-column="0"]')).toBe(stable);
    expect(snapshotPort.current.readSnapshot().content.startsWith("updated,r0c1")).toBe(true);
  });

  it("advances the logical row window while keeping DOM bounded", async () => {
    await renderCsv(500, 20, "row-window.csv");
    const table = required<HTMLTableElement>(container, ".csv-table-editor__table");
    const scroll = required<HTMLDivElement>(container, ".csv-table-editor__scroll");
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 310 });

    await act(async () => {
      scroll.scrollTop = 300 * 31;
      scroll.dispatchEvent(new Event("scroll"));
      await waitForFrames(2);
    });

    expect(Number(table.dataset.csvVirtualRowStart)).toBeGreaterThan(250);
    expect(container.querySelector('tbody tr[data-csv-row="300"]')).toBeInstanceOf(
      HTMLTableRowElement,
    );
    expect(Number(table.dataset.csvMountedRows)).toBeLessThanOrEqual(80);
  });

  it("leads a fast vertical scroll and contracts to the resting buffer", async () => {
    vi.useFakeTimers();
    await renderCsv(500, 20, "velocity-window.csv");
    const table = required<HTMLTableElement>(container, ".csv-table-editor__table");
    const scroll = required<HTMLDivElement>(container, ".csv-table-editor__scroll");
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 310 });

    await act(async () => {
      // Establish a deterministic baseline sample before the large jump. The
      // browser may emit an initial scroll sample at different points in the
      // mount lifecycle, while velocity-aware overscan requires two samples.
      scroll.scrollTop = 0;
      scroll.dispatchEvent(new Event("scroll"));
      scroll.scrollTop = 300 * 31;
      scroll.dispatchEvent(new Event("scroll"));
      scroll.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });

    const fastStart = Number(table.dataset.csvVirtualRowStart);
    const fastEnd = Number(table.dataset.csvVirtualRowEnd);
    expect(fastStart).toBeLessThanOrEqual(300);
    expect(fastEnd).toBeGreaterThanOrEqual(342);
    expect(Number(table.dataset.csvMountedRows)).toBeLessThanOrEqual(80);
    expect(Number(table.dataset.csvMountedCells)).toBeLessThanOrEqual(2_000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(170);
    });

    const restingEnd = Number(table.dataset.csvVirtualRowEnd);
    expect(restingEnd).toBeGreaterThanOrEqual(310);
    expect(restingEnd).toBeLessThan(fastEnd);
  });

  it("expands horizontal scroll coverage temporarily and preserves visible cells when it contracts", async () => {
    vi.useFakeTimers();
    await renderCsv(500, 100, "horizontal-buffer.csv");
    const table = required<HTMLTableElement>(container, ".csv-table-editor__table");
    const scroll = required<HTMLDivElement>(container, ".csv-table-editor__scroll");
    Object.defineProperty(scroll, "clientWidth", { configurable: true, value: 600 });
    await act(async () => {
      scroll.scrollLeft = 0;
      scroll.dispatchEvent(new Event("scroll"));
      scroll.scrollLeft = 60 * 96;
      scroll.dispatchEvent(new Event("scroll"));
      scroll.dispatchEvent(new Event("scroll"));
    });
    const visibleCell = required<HTMLInputElement>(container, 'input[data-csv-row="0"][data-csv-column="60"]');
    const movingColumns = Number(table.dataset.csvMountedColumns);
    expect(Number(table.dataset.csvMountedCells)).toBeLessThanOrEqual(2_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(170); });
    expect(Number(table.dataset.csvMountedColumns)).toBeLessThan(movingColumns);
    expect(container.querySelector('input[data-csv-row="0"][data-csv-column="60"]')).toBe(visibleCell);
    expect(Number(table.dataset.csvMountedCells)).toBeLessThanOrEqual(2_000);
  });

  it("adapts to a 100-column table without crossing the mounted-cell budget", async () => {
    await renderCsv(500, 100, "column-window.csv");
    const table = required<HTMLTableElement>(container, ".csv-table-editor__table");
    const scroll = required<HTMLDivElement>(container, ".csv-table-editor__scroll");
    Object.defineProperty(scroll, "clientWidth", { configurable: true, value: 600 });

    expect(table.getAttribute("aria-colcount")).toBe("101");
    expect(Number(table.dataset.csvMountedColumns)).toBeLessThan(100);
    expect(Number(table.dataset.csvMountedCells)).toBeLessThanOrEqual(2_000);

    await act(async () => {
      scroll.scrollLeft = 60 * 96;
      scroll.dispatchEvent(new Event("scroll"));
      await waitForFrames(2);
    });

    expect(Number(table.dataset.csvVirtualColumnStart)).toBeGreaterThan(40);
    expect(container.querySelector('input[data-csv-column="60"]')).toBeInstanceOf(HTMLInputElement);
    expect(Number(table.dataset.csvMountedCells)).toBeLessThanOrEqual(2_000);
  });
});

async function renderCsv(rowCount: number, columnCount: number, documentId: string): Promise<void> {
  await act(async () => {
    root.render(withTestLocalization(
      <CsvTableEditor
        content={makeCsv(rowCount, columnCount)}
        documentId={documentId}
        nodeName={documentId}
      />,
    ));
    await Promise.resolve();
  });
}

function makeCsv(rowCount: number, columnCount: number): string {
  return Array.from({ length: rowCount }, (_, rowIndex) => (
    Array.from({ length: columnCount }, (_, columnIndex) => `r${rowIndex}c${columnIndex}`).join(",")
  )).join("\n");
}

function required<ElementType extends Element>(owner: ParentNode, selector: string): ElementType {
  const element = owner.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing required CSV test element: ${selector}`);
  return element;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
}

async function waitForFrames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}
