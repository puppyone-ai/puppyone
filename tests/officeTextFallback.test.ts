import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OFFICE_TEXT_FALLBACK_WORKER_TIMEOUT_MS,
  extractOfficeTextFallbackInWorker,
} from "../packages/shared-ui/src/editor/viewers/office/officeTextFallbackClient";
import {
  extractOfficeTextFallback,
  runOfficeTextFallbackWorkerTask,
  type OfficeTextFallbackWorkerResponse,
  type PresentationTextFallbackResult,
} from "../packages/shared-ui/src/editor/viewers/office/officeTextFallbackTask";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Office text fallback task", () => {
  it("extracts presentation text in slide order without inflating slides concurrently", async () => {
    const arrayBuffer = await buildZip({
      "ppt/slides/slide2.xml": slideXml("Second", "Second body"),
      "ppt/slides/slide1.xml": slideXml("First &amp; title", "First body"),
    });

    const result = await extractOfficeTextFallback(arrayBuffer, {
      operation: "extract-presentation-text",
    });

    expect(result.operation).toBe("extract-presentation-text");
    if (result.operation !== "extract-presentation-text") throw new Error("Unexpected result.");
    expect(result.arrayBuffer).toBe(arrayBuffer);
    expect(result.slides).toEqual([
      { index: 1, title: "First & title", lines: ["First body"] },
      { index: 2, title: "Second", lines: ["Second body"] },
    ]);
    expect(result.report).toMatchObject({
      sourceSlideCount: 2,
      extractedSlideCount: 2,
      truncatedSlideCount: 0,
      totalOutputLines: 4,
    });
    expect(result.report.totalXmlBytes).toBeGreaterThan(0);
  });

  it("caps presentation extraction at the configured slide count, never above 300", async () => {
    const arrayBuffer = await buildZip({
      "ppt/slides/slide3.xml": slideXml("Three"),
      "ppt/slides/slide1.xml": slideXml("One"),
      "ppt/slides/slide2.xml": slideXml("Two"),
    });

    const result = await extractOfficeTextFallback(arrayBuffer, {
      operation: "extract-presentation-text",
      budget: { maxSlides: 2 },
    });

    if (result.operation !== "extract-presentation-text") throw new Error("Unexpected result.");
    expect(result.slides.map((slide) => slide.title)).toEqual(["One", "Two"]);
    expect(result.report).toMatchObject({
      sourceSlideCount: 3,
      extractedSlideCount: 2,
      truncatedSlideCount: 1,
    });
  });

  it.each([
    {
      name: "per-slide XML",
      entries: {
        "ppt/slides/slide1.xml": slideXml("Title", "x".repeat(100)),
      },
      budget: { maxSlideXmlBytes: 48 },
      code: "entry-xml-size-limit",
    },
    {
      name: "total XML",
      entries: {
        "ppt/slides/slide1.xml": slideXml("One"),
        "ppt/slides/slide2.xml": slideXml("Two"),
      },
      budget: { maxSlideXmlBytes: 1_024, maxTotalXmlBytes: 63 },
      code: "total-xml-size-limit",
    },
  ])("enforces the presentation $name budget", async ({ entries, budget, code }) => {
    const arrayBuffer = await buildZip(entries);

    await expect(
      extractOfficeTextFallback(arrayBuffer, {
        operation: "extract-presentation-text",
        budget,
      }),
    ).rejects.toMatchObject({ name: "OfficeTextFallbackError", code });
  });

  it("enforces the presentation per-slide output line budget", async () => {
    const arrayBuffer = await buildZip({
      "ppt/slides/slide1.xml": "<slide><p>One</p><p>Two</p><p>Three</p></slide>",
    });

    await expect(
      extractOfficeTextFallback(arrayBuffer, {
        operation: "extract-presentation-text",
        budget: { maxLinesPerSlide: 2 },
      }),
    ).rejects.toMatchObject({
      name: "OfficeTextFallbackError",
      code: "output-line-limit",
      entryName: "ppt/slides/slide1.xml",
      limit: 2,
    });
  });

  it("enforces the presentation total output line budget", async () => {
    const arrayBuffer = await buildZip({
      "ppt/slides/slide1.xml": "<slide><p>One</p><p>Body one</p></slide>",
      "ppt/slides/slide2.xml": "<slide><p>Two</p><p>Body two</p></slide>",
    });

    await expect(
      extractOfficeTextFallback(arrayBuffer, {
        operation: "extract-presentation-text",
        budget: { maxTotalLines: 3 },
      }),
    ).rejects.toMatchObject({
      name: "OfficeTextFallbackError",
      code: "output-line-limit",
      entryName: "ppt/slides/slide2.xml",
      actual: 4,
      limit: 3,
    });
  });

  it("extracts OpenDocument paragraphs, decodes entities, and caps output lines", async () => {
    const arrayBuffer = await buildZip({
      "content.xml": "<office><p>First <span>line</span></p><p>Second &amp; final</p><p>Third</p></office>",
    });

    const result = await extractOfficeTextFallback(arrayBuffer, {
      operation: "extract-opendocument-text",
      budget: { maxLines: 2 },
    });

    if (result.operation !== "extract-opendocument-text") throw new Error("Unexpected result.");
    expect(result.arrayBuffer).toBe(arrayBuffer);
    expect(result.lines).toEqual(["First line", "Second & final"]);
    expect(result.report).toMatchObject({
      outputLines: 2,
      truncatedLines: true,
    });
    expect(result.report.contentXmlBytes).toBeGreaterThan(0);
  });

  it("enforces the OpenDocument content.xml byte budget", async () => {
    const arrayBuffer = await buildZip({
      "content.xml": `<office><p>${"large".repeat(20)}</p></office>`,
    });

    await expect(
      extractOfficeTextFallback(arrayBuffer, {
        operation: "extract-opendocument-text",
        budget: { maxContentXmlBytes: 32 },
      }),
    ).rejects.toMatchObject({
      name: "OfficeTextFallbackError",
      code: "entry-xml-size-limit",
      entryName: "content.xml",
      limit: 32,
    });
  });

  it("rejects malformed XML instead of returning partial text", async () => {
    const arrayBuffer = await buildZip({
      "ppt/slides/slide1.xml": "<slide><p>Unclosed</slide>",
    });

    await expect(
      extractOfficeTextFallback(arrayBuffer, { operation: "extract-presentation-text" }),
    ).rejects.toMatchObject({
      name: "OfficeTextFallbackError",
      code: "malformed-xml",
      entryName: "ppt/slides/slide1.xml",
    });
  });

  it("rejects undeclared XML entities outside selected text nodes", async () => {
    const arrayBuffer = await buildZip({
      "content.xml": "<office><metadata>&unknown;</metadata><p>Visible</p></office>",
    });

    await expect(
      extractOfficeTextFallback(arrayBuffer, { operation: "extract-opendocument-text" }),
    ).rejects.toMatchObject({
      name: "OfficeTextFallbackError",
      code: "malformed-xml",
      entryName: "content.xml",
    });
  });

  it("rejects malformed XML attributes", async () => {
    const arrayBuffer = await buildZip({
      "content.xml": "<office broken=><p>Visible</p></office>",
    });

    await expect(
      extractOfficeTextFallback(arrayBuffer, { operation: "extract-opendocument-text" }),
    ).rejects.toMatchObject({
      name: "OfficeTextFallbackError",
      code: "malformed-xml",
      entryName: "content.xml",
    });
  });

  it("transfers the buffer back from the successful worker task", async () => {
    const arrayBuffer = await buildZip({ "content.xml": "<office><p>Hello</p></office>" });
    const postMessage = vi.fn();

    await runOfficeTextFallbackWorkerTask(
      { arrayBuffer, task: { operation: "extract-opendocument-text" } },
      postMessage,
    );

    const [response, transfer] = postMessage.mock.calls[0] as [
      OfficeTextFallbackWorkerResponse,
      Transferable[],
    ];
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error("Expected a successful response.");
    expect(response.result.arrayBuffer).toBe(arrayBuffer);
    expect(transfer).toEqual([arrayBuffer]);
  });
});

describe("Office text fallback worker client", () => {
  it("transfers input, accepts the result, and terminates the worker", async () => {
    const worker = new FakeWorker();
    stubWorker(worker);
    const arrayBuffer = new ArrayBuffer(16);
    const result = createPresentationResult(arrayBuffer);

    const extraction = extractOfficeTextFallbackInWorker(arrayBuffer, {
      operation: "extract-presentation-text",
    });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    expect(worker.postMessage).toHaveBeenCalledWith(
      {
        arrayBuffer,
        task: { operation: "extract-presentation-text" },
      },
      [arrayBuffer],
    );

    worker.onmessage?.({ data: { ok: true, result } } as MessageEvent);

    await expect(extraction).resolves.toBe(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates the worker when its AbortSignal is cancelled", async () => {
    const worker = new FakeWorker();
    stubWorker(worker);
    const controller = new AbortController();
    const extraction = extractOfficeTextFallbackInWorker(new ArrayBuffer(8), {
      operation: "extract-opendocument-text",
      signal: controller.signal,
    });
    const rejection = expect(extraction).rejects.toMatchObject({ name: "AbortError" });

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    controller.abort();

    await rejection;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rehydrates a task error and terminates on an error response", async () => {
    const worker = new FakeWorker();
    stubWorker(worker);
    const extraction = extractOfficeTextFallbackInWorker(new ArrayBuffer(8), {
      operation: "extract-opendocument-text",
    });
    const rejection = expect(extraction).rejects.toMatchObject({
      name: "OfficeTextFallbackError",
      code: "malformed-xml",
      entryName: "content.xml",
    });

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    worker.onmessage?.({
      data: {
        ok: false,
        error: {
          name: "OfficeTextFallbackError",
          message: "malformed",
          code: "malformed-xml",
          entryName: "content.xml",
        },
        arrayBuffer: new ArrayBuffer(8),
      },
    } as MessageEvent);

    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates an unresponsive worker at the default 10 second timeout", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    stubWorker(worker);
    const extraction = extractOfficeTextFallbackInWorker(new ArrayBuffer(8), {
      operation: "extract-presentation-text",
    });
    const rejection = expect(extraction).rejects.toMatchObject({ name: "TimeoutError" });

    await vi.advanceTimersByTimeAsync(DEFAULT_OFFICE_TEXT_FALLBACK_WORKER_TIMEOUT_MS);

    await rejection;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent<OfficeTextFallbackWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

function stubWorker(worker: FakeWorker): void {
  function WorkerStub() {
    return worker;
  }
  vi.stubGlobal("Worker", WorkerStub as unknown as typeof Worker);
}

async function buildZip(entries: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: "arraybuffer", compression: "STORE" });
}

function slideXml(title: string, body?: string): string {
  return `<slide><p><t>${title}</t></p>${body ? `<p><t>${body}</t></p>` : ""}</slide>`;
}

function createPresentationResult(arrayBuffer: ArrayBuffer): PresentationTextFallbackResult {
  return {
    operation: "extract-presentation-text",
    arrayBuffer,
    slides: [],
    report: {
      sourceSlideCount: 0,
      extractedSlideCount: 0,
      truncatedSlideCount: 0,
      totalXmlBytes: 0,
      totalOutputLines: 0,
    },
  };
}
