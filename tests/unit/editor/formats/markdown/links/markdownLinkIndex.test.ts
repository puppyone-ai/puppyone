/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownLinkGraph,
  createMarkdownLinkGraphIndex,
  createMarkdownLinkGraphIndexer,
  type MarkdownLinkGraphDocument,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkGraph";
import { MarkdownLinkIndexCoordinator } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/indexing/markdownLinkIndexCoordinator";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Markdown link index boundary", () => {
  it("reconstructs the same path resolution and backlinks from a serializable index", () => {
    const documents: MarkdownLinkGraphDocument[] = [
      {
        path: "notes/source.md",
        name: "source.md",
        content: "[Target](../target.md)\n[[target]]\n[Target again](../target.md)",
      },
      { path: "target.md", name: "target.md", content: "# Target" },
    ];
    const metadata = documents.map(({ path, name }) => ({ path, name, content: null }));
    const direct = createMarkdownLinkGraph(documents);
    const indexed = createMarkdownLinkGraph(
      metadata,
      createMarkdownLinkGraphIndex(documents),
    );

    expect(indexed.indexedDocumentCount).toBe(2);
    expect(indexed.resolveMarkdownLink("notes/source.md", "../target.md"))
      .toEqual(direct.resolveMarkdownLink("notes/source.md", "../target.md"));
    expect(indexed.getBacklinks("target.md")).toEqual(direct.getBacklinks("target.md"));
    expect(indexed.getBacklinks("target.md")[0]).toMatchObject({ count: 3 });
    expect(indexed.getBacklinks("target.md")[0]?.references.map((reference) => reference.lineNumber))
      .toEqual([1, 2, 3]);
  });

  it("cancels a superseded worker build and commits only the latest revision", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", IndexWorker);
    const coordinator = new MarkdownLinkIndexCoordinator();
    const first = coordinator.build([
      { path: "a.md", name: "a.md", content: "[b](b.md)" },
      { path: "b.md", name: "b.md", content: "" },
    ]);
    const firstOutcome = first.promise.catch((error: Error) => error);
    const second = coordinator.build([
      { path: "c.md", name: "c.md", content: "[d](d.md)" },
      { path: "d.md", name: "d.md", content: "" },
    ]);

    await vi.runAllTimersAsync();

    expect((await firstOutcome).name).toBe("AbortError");
    expect((await second.promise).indexedDocumentCount).toBe(2);
    coordinator.cancel();
    await Promise.resolve();
  });

  it("rejects deterministically when the production Worker fails", async () => {
    vi.useFakeTimers();
    class FailingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      postMessage() {
        window.setTimeout(() => {
          this.onerror?.({ message: "worker crashed" } as ErrorEvent);
        }, 0);
      }

      terminate() {}
    }
    vi.stubGlobal("Worker", FailingWorker);
    const coordinator = new MarkdownLinkIndexCoordinator();
    const request = coordinator.build([
      { path: "a.md", name: "a.md", content: "[b](b.md)" },
      { path: "b.md", name: "b.md", content: "" },
    ]);
    const outcome = request.promise.catch((error: Error) => error);

    await vi.runAllTimersAsync();

    await expect(outcome).resolves.toMatchObject({ message: "worker crashed" });
    await expect(coordinator.updateDocument({ path: "a.md", name: "a.md", content: "" }))
      .rejects.toThrow("worker crashed");
  });

  it("streams one document at a time and can update a saved document incrementally", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", IndexWorker);
    const coordinator = new MarkdownLinkIndexCoordinator();
    const metadata = [
      { path: "a.md", name: "a.md", content: null },
      { path: "b.md", name: "b.md", content: null },
    ];
    let activeReads = 0;
    let maxActiveReads = 0;
    const reads: string[] = [];
    const request = coordinator.buildFromReader(
      metadata,
      metadata.map(({ path }) => path),
      async (path) => {
        reads.push(path);
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        activeReads -= 1;
        return {
          path,
          name: path,
          content: path === "a.md" ? "[b](b.md)" : "",
        };
      },
    );

    await vi.runAllTimersAsync();
    const initial = await request.promise;
    expect(reads).toEqual(["a.md", "b.md"]);
    expect(maxActiveReads).toBe(1);
    expect(initial.indexedDocumentCount).toBe(2);
    expect(createMarkdownLinkGraph(metadata, initial).getBacklinks("b.md")[0]?.count).toBe(1);

    const updated = coordinator.updateDocument({
      path: "a.md",
      name: "a.md",
      content: "No links now",
    });
    await vi.runAllTimersAsync();
    const next = await updated;
    expect(createMarkdownLinkGraph(metadata, next).getBacklinks("b.md")).toEqual([]);
    coordinator.cancel();
    await Promise.resolve();
  });

  it("keeps backlink excerpts bounded for a link on a very long line", () => {
    const documents: MarkdownLinkGraphDocument[] = [
      {
        path: "source.md",
        name: "source.md",
        content: `${"before ".repeat(20_000)}[Target](target.md)${" after".repeat(20_000)}`,
      },
      { path: "target.md", name: "target.md", content: "" },
    ];

    const reference = createMarkdownLinkGraph(documents).getBacklinks("target.md")[0]?.references[0];
    expect(reference?.lineText.length).toBeLessThanOrEqual(320);
    expect(reference?.lineText).toContain("Target");
  });

  it("bounds the serializable backlink snapshot and reports source truncation", () => {
    const targets: MarkdownLinkGraphDocument[] = Array.from({ length: 10 }, (_, index) => ({
      path: `target-${index}.md`,
      name: `target-${index}.md`,
      content: "",
    }));
    const sources: MarkdownLinkGraphDocument[] = Array.from({ length: 801 }, (_, sourceIndex) => ({
      path: `source-${sourceIndex}.md`,
      name: `source-${sourceIndex}.md`,
      content: targets.map((target) => `[${target.name}](${target.path})`).join(" "),
    }));

    const snapshot = createMarkdownLinkGraphIndex([...targets, ...sources]);
    const storedBacklinks = snapshot.backlinks.reduce(
      (count, [, backlinks]) => count + backlinks.length,
      0,
    );
    const storedReferences = snapshot.backlinks.reduce(
      (count, [, backlinks]) => count + backlinks.reduce(
        (backlinkCount, backlink) => backlinkCount + backlink.references.length,
        0,
      ),
      0,
    );

    expect(storedBacklinks).toBeLessThanOrEqual(8_000);
    expect(storedReferences).toBeLessThanOrEqual(8_000);
    expect(snapshot.truncatedDocumentCount).toBeGreaterThan(0);
  });
});

class IndexWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  indexer: ReturnType<typeof createMarkdownLinkGraphIndexer> | null = null;
  postMessage(request: import("../../../../../../packages/shared-ui/src/editor/markdown/platform/indexing/markdownLinkIndexProtocol").MarkdownLinkIndexWorkerRequest) {
    if (request.type === "initialize") this.indexer = createMarkdownLinkGraphIndexer(request.documents);
    if (request.type === "index-document") this.indexer!.indexDocument(request.document);
    queueMicrotask(() => this.onmessage?.({ data: { requestId: request.requestId, operationId: request.operationId,
      type: request.type === "snapshot" ? "snapshot" : "ack",
      ...(request.type === "snapshot" ? { index: this.indexer!.createSnapshot() } : {}),
    } } as MessageEvent));
  }
  terminate() { this.onmessage = null; }
}
