import { bench, describe } from "vitest";
import { CsvDocumentModel } from "../../../../../packages/shared-ui/src/editor/viewers/csv/CsvDocumentModel";
import {
  buildTabularProjectionItems,
  calculateFixedTabularWindow,
  calculateVariableTabularWindow,
  createTabularOffsets,
} from "../../../../../packages/shared-ui/src/editor/table/tabularWindow";

const BENCHMARK_OPTIONS = {
  iterations: 3,
  time: 250,
  warmupIterations: 1,
  warmupTime: 50,
};

describe("CSV structured model", () => {
  const source = makeCsv(500, 20);
  const inputModel = new CsvDocumentModel("500x20-input.csv", source, ",");
  let inputSequence = 0;
  bench("500x20 cell transaction without source snapshot", () => {
    inputSequence += 1;
    inputModel.setCell(250, 10, `value-${inputSequence % 2}`);
  }, BENCHMARK_OPTIONS);

  const snapshotModel = new CsvDocumentModel("500x20-snapshot.csv", source, ",");
  let snapshotSequence = 0;
  bench("500x20 explicit persistence snapshot", () => {
    snapshotSequence += 1;
    snapshotModel.setCell(250, 10, `value-${snapshotSequence % 2}`);
    snapshotModel.readSnapshot();
  }, BENCHMARK_OPTIONS);
});

describe("CSV bounded viewport math", () => {
  const columnOffsets = createTabularOffsets(Array.from({ length: 256 }, () => 96));
  let scrollSequence = 0;
  bench("10000-row by 256-column two-axis window", () => {
    scrollSequence = (scrollSequence + 31) % (9_900 * 31);
    const rowRange = calculateFixedTabularWindow({
      count: 10_000,
      itemSize: 31,
      maximumItems: 78,
      overscanItems: 8,
      scrollOffset: scrollSequence,
      viewportSize: 620,
    });
    const columnRange = calculateVariableTabularWindow({
      offsets: columnOffsets,
      maximumItems: 24,
      overscanSize: 280,
      scrollOffset: scrollSequence % 20_000,
      viewportSize: 1_000,
    });
    buildTabularProjectionItems(10_000, rowRange, [], (start, end) => (end - start) * 31);
    buildTabularProjectionItems(256, columnRange, [], (start, end) => (
      columnOffsets[end] - columnOffsets[start]
    ));
  }, BENCHMARK_OPTIONS);
});

function makeCsv(rowCount: number, columnCount: number): string {
  return Array.from({ length: rowCount }, (_, rowIndex) => (
    Array.from({ length: columnCount }, (_, columnIndex) => `r${rowIndex}c${columnIndex}`).join(",")
  )).join("\n");
}
