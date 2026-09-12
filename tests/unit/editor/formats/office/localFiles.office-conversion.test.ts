import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalDataPort } from "../../../../../src/lib/localFiles";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local Office conversion bridge", () => {
  it("uses one request id for conversion and AbortSignal cancellation", async () => {
    let rejectConversion: ((reason: Error) => void) | null = null;
    const convertOfficeDocumentToDocx = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectConversion = reject;
    }));
    const cancelOfficeDocumentToDocxConversion = vi.fn(async () => {
      rejectConversion?.(new Error("main process cancelled"));
      return { cancelled: true };
    });
    vi.stubGlobal("window", {
      puppyoneDesktop: {
        convertOfficeDocumentToDocx,
        cancelOfficeDocumentToDocxConversion,
      },
    });

    const dataPort = createLocalDataPort("/workspace");
    const controller = new AbortController();
    const conversion = dataPort.convertOfficeDocumentToDocx?.("document.rtf", {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(convertOfficeDocumentToDocx).toHaveBeenCalledOnce());
    controller.abort();

    await expect(conversion).rejects.toMatchObject({
      name: "AbortError",
      message: "Office conversion was cancelled.",
    });
    expect(cancelOfficeDocumentToDocxConversion).toHaveBeenCalledOnce();
    expect(cancelOfficeDocumentToDocxConversion.mock.calls[0][0].requestId)
      .toBe(convertOfficeDocumentToDocx.mock.calls[0][0].requestId);
    expect(convertOfficeDocumentToDocx.mock.calls[0][0]).toMatchObject({
      rootPath: "/workspace",
      path: "document.rtf",
    });
  });

  it("does not start a conversion for an already-aborted signal", async () => {
    const convertOfficeDocumentToDocx = vi.fn();
    const cancelOfficeDocumentToDocxConversion = vi.fn();
    vi.stubGlobal("window", {
      puppyoneDesktop: {
        convertOfficeDocumentToDocx,
        cancelOfficeDocumentToDocxConversion,
      },
    });

    const controller = new AbortController();
    controller.abort();
    const dataPort = createLocalDataPort("/workspace");

    await expect(dataPort.convertOfficeDocumentToDocx?.("document.rtf", {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(convertOfficeDocumentToDocx).not.toHaveBeenCalled();
    expect(cancelOfficeDocumentToDocxConversion).not.toHaveBeenCalled();
  });

  it("returns converted bytes without issuing a cancellation", async () => {
    const convertOfficeDocumentToDocx = vi.fn(async () => ({
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      warnings: ["sample warning"],
    }));
    const cancelOfficeDocumentToDocxConversion = vi.fn();
    vi.stubGlobal("window", {
      puppyoneDesktop: {
        convertOfficeDocumentToDocx,
        cancelOfficeDocumentToDocxConversion,
      },
    });

    const dataPort = createLocalDataPort("/workspace");
    const result = await dataPort.convertOfficeDocumentToDocx?.("document.rtf");

    expect(Array.from(new Uint8Array(result?.arrayBuffer ?? new ArrayBuffer(0))))
      .toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(result?.warnings).toEqual(["sample warning"]);
    expect(cancelOfficeDocumentToDocxConversion).not.toHaveBeenCalled();
  });
});
