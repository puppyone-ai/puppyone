import { EditorSelection, EditorState } from "@codemirror/state";
import { bench, describe } from "vitest";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { createMarkdownLinkGraph } from "../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkGraph";
import { requestMarkdownProjectionRange } from "../../../../../packages/shared-ui/src/editor/markdown/core/decorations/livePreviewDecorations";
import { markdownLivePreviewFocusEffect } from "../../../../../packages/shared-ui/src/editor/markdown/core/state/livePreviewFocus";
import { MarkdownBlockVirtualizer } from "../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/blockVirtualizer";
import { MARKDOWN_TABLE_MODEL_ROW_LIMIT } from "../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownBlockExecution";
import {
  makeFeatureHeavyMarkdown,
  makeLinkGraphDocuments,
  makeMarkdown,
  readRepositoryMarkdownCorpus,
  readRepositoryTextFile,
} from "../../../../support/performance/fixtures";

const BENCHMARK_OPTIONS = {
  iterations: 3,
  time: 250,
  warmupIterations: 1,
  warmupTime: 50,
};

const markdownDocuments = new Map(
  [200, 1_000, 3_000, 6_000, 10_000].map((lineCount) => [lineCount, makeMarkdown(lineCount)]),
);
const repositoryCorpus = readRepositoryMarkdownCorpus();
const repositoryArchitectureDocument = readRepositoryTextFile("README.md");
const syntheticLinkCorpora = new Map(
  [20, 100, 300].map((lineCount) => [lineCount, makeLinkGraphDocuments(250, lineCount)]),
);
const featureHeavyDocument = makeFeatureHeavyMarkdown(240);
const windowedTableDocument = makeOversizedTable(1_000);
const sourceFallbackTableDocument = makeOversizedTable(MARKDOWN_TABLE_MODEL_ROW_LIMIT + 1);

describe("Markdown EditorState construction", () => {
  bench(
    `repository README.md · ${repositoryArchitectureDocument.split("\n").length} lines · ${formatBytes(repositoryArchitectureDocument)}`,
    () => {
      EditorState.create({
        doc: repositoryArchitectureDocument,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension("safe", null, "README.md"),
        ],
      });
    },
    BENCHMARK_OPTIONS,
  );

  for (const lineCount of [200, 1_000, 3_000, 6_000, 10_000]) {
    const source = markdownDocuments.get(lineCount) ?? "";

    bench(`source mode · ${lineCount} lines · ${formatBytes(source)}`, () => {
      EditorState.create({
        doc: source,
        extensions: markdownCodeMirrorBaseExtensions(false),
      });
    }, BENCHMARK_OPTIONS);

    bench(`live preview · ${lineCount} lines · ${formatBytes(source)}`, () => {
      EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension("safe", null, "bench.md"),
        ],
      });
    }, BENCHMARK_OPTIONS);
  }
});

describe("Markdown link graph construction", () => {
  bench(
    `repository corpus · ${repositoryCorpus.length} documents · ${formatCorpusBytes(repositoryCorpus)}`,
    () => {
      createMarkdownLinkGraph(repositoryCorpus);
    },
    BENCHMARK_OPTIONS,
  );

  for (const linesPerDocument of [20, 100, 300]) {
    const corpus = syntheticLinkCorpora.get(linesPerDocument) ?? [];
    bench(
      `link-heavy · 250 documents × ${linesPerDocument} lines · ${formatCorpusBytes(corpus)}`,
      () => {
        createMarkdownLinkGraph(corpus);
      },
      BENCHMARK_OPTIONS,
    );
  }
});

describe("Markdown incremental projection", () => {
  const source = markdownDocuments.get(10_000) ?? "";
  const editHarnesses = [
    ["top", 4],
    ["middle", Math.floor(source.length / 2)],
    ["end", Math.max(0, source.length - 4)],
  ].map(([label, position]) => [label, createIncrementalEditHarness(source, Number(position))] as const);

  for (const [label, harness] of editHarnesses) {
    bench(`single-character ${label} edit · 10000 lines`, () => {
      harness.edit();
    }, BENCHMARK_OPTIONS);
  }

  const taskToggleHarness = createTaskToggleHarness(source, Math.floor(source.length / 2));
  bench("task checkbox token toggle · 10000 lines", () => {
    taskToggleHarness.toggle();
  }, BENCHMARK_OPTIONS);

  const revealPosition = Math.max(1, source.indexOf("bold") + 2);
  const revealHarness = createFocusRevealHarness(source, revealPosition);
  bench("focus/reveal range patch · 10000 lines", () => {
    revealHarness.toggle();
  }, BENCHMARK_OPTIONS);

  const heavyHarness = createIncrementalEditHarness(
    featureHeavyDocument,
    Math.floor(featureHeavyDocument.length / 2),
  );
  bench(
    `table/html/mermaid-heavy single-character edit · ${featureHeavyDocument.split("\n").length} lines`,
    () => heavyHarness.edit(),
    BENCHMARK_OPTIONS,
  );
});

describe("Markdown oversized-block execution", () => {
  bench("windowed table plan · 1000 rows", () => {
    createLivePreviewState(windowedTableDocument);
  }, BENCHMARK_OPTIONS);

  bench(`table visible-source fallback · ${MARKDOWN_TABLE_MODEL_ROW_LIMIT + 1} rows`, () => {
    createLivePreviewState(sourceFallbackTableDocument);
  }, BENCHMARK_OPTIONS);

  const virtualizer = new MarkdownBlockVirtualizer(5_000, (index) => 31 + (index % 5));
  let offset = 0;
  bench("variable-height nested range lookup · 5000 rows", () => {
    offset = (offset + 997) % Math.max(1, virtualizer.getTotalSize() - 800);
    virtualizer.getRange(offset, offset + 800, 8, [2_500]);
  }, BENCHMARK_OPTIONS);
});

function formatBytes(source: string): string {
  return `${Math.round(Buffer.byteLength(source) / 1024)} KiB`;
}

function formatCorpusBytes(documents: readonly { content?: string | null }[]): string {
  const bytes = documents.reduce(
    (total, document) => total + Buffer.byteLength(document.content ?? ""),
    0,
  );
  return `${Math.round(bytes / 1024)} KiB`;
}

function createLivePreviewState(source: string): EditorState {
  return EditorState.create({
    doc: source,
    extensions: [
      ...markdownCodeMirrorBaseExtensions(false),
      markdownLivePreviewExtension("safe", null, "bench.md"),
    ],
  });
}

function createIncrementalEditHarness(source: string, requestedPosition: number) {
  let state = createLivePreviewState(source);
  const position = Math.min(Math.max(0, requestedPosition), Math.max(0, state.doc.length - 1));
  state = state.update({
    effects: requestMarkdownProjectionRange(state, position, position + 1),
  }).state;
  let useAlternate = false;
  return {
    edit() {
      useAlternate = !useAlternate;
      state = state.update({
        changes: { from: position, to: position + 1, insert: useAlternate ? "x" : "y" },
      }).state;
    },
  };
}

function createFocusRevealHarness(source: string, position: number) {
  let state = createLivePreviewState(source);
  state = state.update({
    selection: EditorSelection.cursor(position),
    effects: requestMarkdownProjectionRange(state, position, position + 1),
  }).state;
  let focused = false;
  return {
    toggle() {
      focused = !focused;
      state = state.update({
        selection: EditorSelection.cursor(position),
        effects: markdownLivePreviewFocusEffect.of(focused),
      }).state;
    },
  };
}

function createTaskToggleHarness(source: string, requestedPosition: number) {
  let state = createLivePreviewState(source);
  const searchFrom = Math.min(Math.max(0, requestedPosition), source.length);
  const from = source.indexOf("[ ]", searchFrom);
  if (from < 0) throw new Error("Benchmark fixture has no task after the requested position");
  const to = from + 3;
  const line = state.doc.lineAt(from);
  state = state.update({
    effects: requestMarkdownProjectionRange(state, line.from, line.to),
  }).state;
  let checked = false;
  return {
    toggle() {
      checked = !checked;
      state = state.update({
        changes: { from, to, insert: checked ? "[x]" : "[ ]" },
      }).state;
    },
  };
}

function makeOversizedTable(bodyRowCount: number): string {
  return [
    "| Name | Value |",
    "| --- | ---: |",
    ...Array.from({ length: bodyRowCount }, (_, index) => `| row ${index} | ${index} |`),
  ].join("\n");
}
