import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOfficeArrayBuffer,
  OfficeResourceLimitError,
} from "../../../../../packages/shared-ui/src/editor/viewers/office/officeResourceLoader";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Office resource loading", () => {
  it("range-probes local resources and rejects oversized files before the full fetch", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1]), {
      status: 206,
      headers: {
        "Content-Length": "1",
        "Content-Range": "bytes 0-0/101",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOfficeArrayBuffer("puppyone-local://file/root/report.xlsx", { maxBytes: 100 }))
      .rejects.toBeInstanceOf(OfficeResourceLimitError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "puppyone-local://file/root/report.xlsx",
      expect.objectContaining({ headers: { Range: "bytes=0-0" } }),
    );
  });

  it("streams remote resources and stops once the byte budget is crossed", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel: cancelled,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));

    await expect(fetchOfficeArrayBuffer("https://example.test/report.xlsx", { maxBytes: 5 }))
      .rejects.toBeInstanceOf(OfficeResourceLimitError);
    expect(cancelled).toHaveBeenCalled();
  });

  it("returns the exact streamed bytes for an in-budget response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "Content-Length": "4" },
    })));

    const result = await fetchOfficeArrayBuffer("https://example.test/report.docx", { maxBytes: 4 });

    expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3, 4]);
  });

  it("rejects a declared oversized response without reading its body", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "Content-Length": "101" },
    })));

    await expect(fetchOfficeArrayBuffer("https://example.test/report.docx", { maxBytes: 100 }))
      .rejects.toBeInstanceOf(OfficeResourceLimitError);
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
  });
});
