import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OFFICE_PACKAGE_VALIDATION_WORKER_TIMEOUT_MS,
  validateOfficePackageInWorker,
} from "../packages/shared-ui/src/editor/security/officePackageValidationClient";
import {
  runOfficePackageValidationWorkerTask,
  validateOfficePackageDecompression,
  type OfficePackageValidationReport,
  type OfficePackageValidationWorkerResponse,
} from "../packages/shared-ui/src/editor/security/officePackageValidationTask";

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Office package decompression task", () => {
  it("streams every entry, counts DOCX XML start tags, and returns the original buffer", async () => {
    const arrayBuffer = await buildDocx("<w:document><w:p/><w:p/></w:document>");

    const result = await validateOfficePackageDecompression(arrayBuffer, { profile: "docx" });

    expect(result.arrayBuffer).toBe(arrayBuffer);
    expect(result.report.actualTotalUncompressedBytes).toBe(
      result.report.declaredTotalUncompressedBytes,
    );
    expect(result.report.docxXmlStartTags).toBe(3);
    expect(result.report.entries.find((entry) => entry.name === "word/document.xml"))
      .toMatchObject({
        actualUncompressedBytes: 37,
        declaredUncompressedBytes: 37,
        docxXmlStartTags: 3,
      });
  });

  it("rejects a stream whose actual output is larger than its forged declared size", async () => {
    const arrayBuffer = await buildDocx(`<w:document>${"payload".repeat(20)}</w:document>`);
    patchDeclaredUncompressedSize(arrayBuffer, "word/document.xml", 1);

    await expect(
      validateOfficePackageDecompression(arrayBuffer, { profile: "docx" }),
    ).rejects.toMatchObject({
      name: "OfficePackageValidationError",
      code: "actual-entry-size-mismatch",
      entryName: "word/document.xml",
      declaredBytes: 1,
    });
  });

  it("rejects a stream whose actual output is smaller than its forged declared size", async () => {
    const documentXml = `<w:document>${"payload".repeat(20)}</w:document>`;
    const arrayBuffer = await buildDocx(documentXml);
    const declaredBytes = new TextEncoder().encode(documentXml).byteLength + 50;
    patchDeclaredUncompressedSize(arrayBuffer, "word/document.xml", declaredBytes);

    await expect(
      validateOfficePackageDecompression(arrayBuffer, { profile: "docx" }),
    ).rejects.toMatchObject({
      name: "OfficePackageValidationError",
      code: "actual-entry-size-mismatch",
      entryName: "word/document.xml",
      declaredBytes,
      actualBytes: new TextEncoder().encode(documentXml).byteLength,
    });
  });

  it.each([
    {
      name: "per-entry",
      budget: { maxEntryUncompressedBytes: 32, maxTotalUncompressedBytes: 1_024 },
      code: "actual-entry-size-limit",
    },
    {
      name: "aggregate",
      budget: { maxEntryUncompressedBytes: 1_024, maxTotalUncompressedBytes: 64 },
      code: "actual-total-size-limit",
    },
  ])("enforces the actual $name decompression budget", async ({ budget, code }) => {
    const arrayBuffer = await buildDocx(`<w:document>${"x".repeat(256)}</w:document>`);
    patchDeclaredUncompressedSize(arrayBuffer, "word/document.xml", 1);

    await expect(
      validateOfficePackageDecompression(arrayBuffer, {
        profile: "docx",
        budget,
      }),
    ).rejects.toMatchObject({
      name: "OfficePackageValidationError",
      code,
      entryName: "word/document.xml",
    });
  });

  it("rejects a DOCX whose word XML exceeds the start-tag budget", async () => {
    const arrayBuffer = await buildDocx("<w:document><w:body><w:p/><w:p/></w:body></w:document>");

    await expect(
      validateOfficePackageDecompression(arrayBuffer, {
        profile: "docx",
        budget: { maxDocxXmlStartTags: 3 },
      }),
    ).rejects.toMatchObject({
      name: "OfficePackageValidationError",
      code: "docx-xml-start-tag-limit",
      entryName: "word/document.xml",
      actualBytes: 4,
      limit: 3,
    });
  });

  it("serializes failures and transfers the input buffer back from the worker task", async () => {
    const arrayBuffer = await buildDocx("<w:document><w:p/></w:document>");
    patchDeclaredUncompressedSize(arrayBuffer, "word/document.xml", 1);
    const postMessage = vi.fn();

    await runOfficePackageValidationWorkerTask(
      { arrayBuffer, options: { profile: "docx" } },
      postMessage,
    );

    expect(postMessage).toHaveBeenCalledOnce();
    const [response, transfer] = postMessage.mock.calls[0] as [
      OfficePackageValidationWorkerResponse,
      Transferable[],
    ];
    expect(response).toMatchObject({
      ok: false,
      error: {
        name: "OfficePackageValidationError",
        code: "actual-entry-size-mismatch",
        entryName: "word/document.xml",
      },
      arrayBuffer,
    });
    expect(transfer).toEqual([arrayBuffer]);
  });

  it("transfers the validated input buffer back from a successful worker task", async () => {
    const arrayBuffer = await buildDocx("<w:document><w:p/></w:document>");
    const postMessage = vi.fn();

    await runOfficePackageValidationWorkerTask(
      { arrayBuffer, options: { profile: "docx" } },
      postMessage,
    );

    const [response, transfer] = postMessage.mock.calls[0] as [
      OfficePackageValidationWorkerResponse,
      Transferable[],
    ];
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error("Expected a successful validation response.");
    expect(response.result.arrayBuffer).toBe(arrayBuffer);
    expect(transfer).toEqual([arrayBuffer]);
  });
});

describe("Office package validation worker client", () => {
  it("transfers the input in, accepts the validated buffer back, and terminates", async () => {
    const worker = new FakeWorker();
    stubWorker(worker);
    const arrayBuffer = new ArrayBuffer(16);
    const result = createResult(arrayBuffer);

    const validation = validateOfficePackageInWorker(arrayBuffer, { profile: "docx" });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    expect(worker.postMessage).toHaveBeenCalledWith(
      {
        arrayBuffer,
        options: { profile: "docx", budget: undefined },
      },
      [arrayBuffer],
    );

    worker.onmessage?.({ data: { ok: true, result } } as MessageEvent);

    await expect(validation).resolves.toBe(result);
    expect(result.arrayBuffer).toBe(arrayBuffer);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rehydrates a serialized validation error and terminates on an error result", async () => {
    const worker = new FakeWorker();
    stubWorker(worker);
    const validation = validateOfficePackageInWorker(new ArrayBuffer(8), { profile: "docx" });
    const rejection = expect(validation).rejects.toMatchObject({
      name: "OfficePackageValidationError",
      code: "actual-entry-size-mismatch",
      entryName: "word/document.xml",
    });

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    worker.onmessage?.({
      data: {
        ok: false,
        error: {
          name: "OfficePackageValidationError",
          message: "size mismatch",
          code: "actual-entry-size-mismatch",
          entryName: "word/document.xml",
          declaredBytes: 1,
          actualBytes: 10,
        },
        arrayBuffer: new ArrayBuffer(8),
      },
    } as MessageEvent);

    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates the worker when its AbortSignal is cancelled", async () => {
    const worker = new FakeWorker();
    stubWorker(worker);
    const controller = new AbortController();
    const validation = validateOfficePackageInWorker(new ArrayBuffer(8), {
      profile: "docx",
      signal: controller.signal,
    });
    const rejection = expect(validation).rejects.toMatchObject({ name: "AbortError" });

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    controller.abort();

    await rejection;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates an unresponsive worker at the default hard timeout", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    stubWorker(worker);
    const validation = validateOfficePackageInWorker(new ArrayBuffer(8), { profile: "docx" });
    const rejection = expect(validation).rejects.toMatchObject({ name: "TimeoutError" });

    await vi.advanceTimersByTimeAsync(DEFAULT_OFFICE_PACKAGE_VALIDATION_WORKER_TIMEOUT_MS);

    await rejection;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent<OfficePackageValidationWorkerResponse>) => void) | null = null;
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

async function buildDocx(documentXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("_rels/.rels", "<Relationships/>");
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "arraybuffer", compression: "STORE" });
}

function patchDeclaredUncompressedSize(
  arrayBuffer: ArrayBuffer,
  entryName: string,
  declaredBytes: number,
): void {
  const view = new DataView(arrayBuffer);
  const eocdOffset = findSignatureFromEnd(view, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  if (eocdOffset < 0) throw new Error("EOCD not found in test archive.");

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let cursor = view.getUint32(eocdOffset + 16, true);
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Malformed central directory in test archive.");
    }
    const nameBytes = view.getUint16(cursor + 28, true);
    const extraBytes = view.getUint16(cursor + 30, true);
    const commentBytes = view.getUint16(cursor + 32, true);
    const name = new TextDecoder().decode(new Uint8Array(arrayBuffer, cursor + 46, nameBytes));
    if (name === entryName) {
      const localOffset = view.getUint32(cursor + 42, true);
      view.setUint32(cursor + 24, declaredBytes, true);
      view.setUint32(localOffset + 22, declaredBytes, true);
      return;
    }
    cursor += 46 + nameBytes + extraBytes + commentBytes;
  }
  throw new Error(`Entry ${entryName} not found in test archive.`);
}

function findSignatureFromEnd(view: DataView, signature: number): number {
  for (let offset = view.byteLength - 4; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

function createResult(arrayBuffer: ArrayBuffer): {
  arrayBuffer: ArrayBuffer;
  report: OfficePackageValidationReport;
} {
  return {
    arrayBuffer,
    report: {
      profile: "docx",
      entryCount: 0,
      declaredTotalUncompressedBytes: 0,
      actualTotalUncompressedBytes: 0,
      docxXmlStartTags: 0,
      entries: [],
    },
  };
}
