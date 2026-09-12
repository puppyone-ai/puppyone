/**
 * @vitest-environment happy-dom
 */
import { createElement, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, bench, describe } from "vitest";
import { ExplorerTree } from "../../../../../packages/shared-ui/src/data/ExplorerTree";
import { FileOpenRequestCoordinator } from "../../../../../packages/shared-ui/src/data/file-open/fileOpenRequestCoordinator";
import { MarkdownCodeMirrorEditor } from "../../../../../packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor";
import {
  makeExplorerNodes,
  makeFeatureHeavyMarkdown,
  makeMarkdown,
  readRepositoryTextFile,
} from "../../../../support/performance/fixtures";
import { withBenchmarkLocalization } from "../../../../support/performance/localizationHarness";

const BENCHMARK_OPTIONS = {
  iterations: 3,
  time: 250,
  warmupIterations: 1,
  warmupTime: 50,
};

const markdownDocuments = new Map(
  [1_000, 3_000, 6_000, 10_000].map((lineCount) => [lineCount, makeMarkdown(lineCount)]),
);
const repositoryArchitectureDocument = readRepositoryTextFile("README.md");
const featureHeavyDocument = makeFeatureHeavyMarkdown(180);
const explorerHarnesses = new Map(
  [100, 250, 500, 1_000].map((rowCount) => [rowCount, createExplorerHarness(rowCount)]),
);

afterAll(() => {
  for (const harness of explorerHarnesses.values()) harness.destroy();
});

describe("Markdown React mount and disposal", () => {
  bench(
    `repository README.md · ${repositoryArchitectureDocument.split("\n").length} lines · ${formatBytes(repositoryArchitectureDocument)}`,
    async () => {
      await mountAndDisposeMarkdownEditor(repositoryArchitectureDocument, false);
    },
    BENCHMARK_OPTIONS,
  );

  for (const lineCount of [1_000, 3_000, 6_000, 10_000]) {
    const source = markdownDocuments.get(lineCount) ?? "";
    bench(`live preview · ${lineCount} lines · ${formatBytes(source)}`, async () => {
      await mountAndDisposeMarkdownEditor(source, false);
    }, BENCHMARK_OPTIONS);
  }

  const strictModeSource = markdownDocuments.get(6_000) ?? "";
  bench(`development StrictMode · 6000 lines · ${formatBytes(strictModeSource)}`, async () => {
    await mountAndDisposeMarkdownEditor(strictModeSource, true);
  }, BENCHMARK_OPTIONS);

  bench(
    `table/html/mermaid-heavy live preview · ${featureHeavyDocument.split("\n").length} lines`,
    async () => mountAndDisposeMarkdownEditor(featureHeavyDocument, false),
    BENCHMARK_OPTIONS,
  );
});

describe("Explorer selection update", () => {
  for (const rowCount of [100, 250, 500, 1_000]) {
    bench(`${rowCount} rendered rows`, () => {
      explorerHarnesses.get(rowCount)?.selectNext();
    }, BENCHMARK_OPTIONS);
  }
});

describe("Revision-bound file switching", () => {
  const harness = createFileSwitchHarness();
  bench("continuous A/B switch + cancellation", () => {
    harness.switchFile();
  }, BENCHMARK_OPTIONS);
});

async function mountAndDisposeMarkdownEditor(source: string, strictMode: boolean) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const root = createRoot(parent);
  const editor = withBenchmarkLocalization(createElement(MarkdownCodeMirrorEditor, {
    value: source,
    readOnly: false,
    livePreview: true,
    documentPath: "bench.md",
  }));

  flushSync(() => {
    root.render(strictMode ? createElement(StrictMode, null, editor) : editor);
  });
  await nextAnimationFrame();
  await nextAnimationFrame();
  flushSync(() => root.unmount());
  parent.remove();
}

function createFileSwitchHarness() {
  const coordinator = new FileOpenRequestCoordinator();
  let current = "A.md";
  let previous = coordinator.begin(current);
  return {
    switchFile() {
      current = current === "A.md" ? "B.md" : "A.md";
      const next = coordinator.begin(current);
      previous.commit(() => {
        throw new Error("A stale file-open request committed.");
      });
      next.commit(() => undefined);
      previous = next;
    },
  };
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

type ExplorerHarness = {
  destroy: () => void;
  selectNext: () => void;
};

function createExplorerHarness(rowCount: number): ExplorerHarness {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const root = createRoot(parent);
  const nodes = makeExplorerNodes(rowCount);
  let activeIndex = 0;

  const render = () => {
    const activePath = nodes[activeIndex]?.path ?? null;
    root.render(withBenchmarkLocalization(createElement(ExplorerTree, {
      nodes,
      activePath,
      selectedPaths: new Set(activePath ? [activePath] : []),
      expandedPaths: new Set<string>(),
      showRoot: false,
      onSelectNode: () => undefined,
      renderNodeActions: () => createElement("span", null, "…"),
    })));
  };

  flushSync(render);

  return {
    selectNext() {
      activeIndex = (activeIndex + 1) % Math.max(1, nodes.length);
      flushSync(render);
    },
    destroy() {
      flushSync(() => root.unmount());
      parent.remove();
    },
  };
}

function formatBytes(source: string): string {
  return `${Math.round(Buffer.byteLength(source) / 1024)} KiB`;
}
