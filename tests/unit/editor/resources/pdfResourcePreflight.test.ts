import { afterEach, describe, expect, it, vi } from "vitest";
import { preflightPdfResource } from "../../../../packages/shared-ui/src/editor/viewers/pdf/pdfResourcePreflight";

afterEach(() => vi.unstubAllGlobals());
const url = "https://cloud-fixture.puppyone.ai/api/v1/content/project/inline?path=report.pdf&token=fixture";
const signal = new AbortController().signal;

describe("PDF resource transport admission", () => {
  it("uses HEAD when supported", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { headers: { "Content-Type": "application/pdf", "Content-Length": "100" } }));
    vi.stubGlobal("fetch", fetcher);
    await preflightPdfResource(url, 1024, signal);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(url, expect.objectContaining({ method: "HEAD", redirect: "error", credentials: "omit", signal }));
  });

  it("preflights real Blob bytes without HEAD while preserving MIME and size checks", async () => {
    const pdf = URL.createObjectURL(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    const text = URL.createObjectURL(new Blob(["not a pdf"], { type: "text/plain" }));
    try {
      await preflightPdfResource(pdf, 1024, signal);
      await expect(preflightPdfResource(pdf, 4, signal)).rejects.toThrow("limit");
      await expect(preflightPdfResource(text, 1024, signal)).rejects.toThrow("resource");
    } finally { URL.revokeObjectURL(pdf); URL.revokeObjectURL(text); }
  });

  it.each([
    { type: "application/pdf", size: "100", error: null },
    { type: "text/html", size: "100", error: "resource" },
    { type: "application/pdf", size: "9999", error: "limit" },
    { type: "application/pdf", size: "0", error: "resource" },
  ])("handles a GET-only Cloud preview with $type / $size without buffering its body", async ({ type, size, error }) => {
    const response = new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": type, "Content-Length": size } });
    const cancel = vi.spyOn(response.body!, "cancel");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 405 })).mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetcher);
    const result = preflightPdfResource(url, 1024, signal);
    if (error) await expect(result).rejects.toThrow(error); else await result;
    expect(fetcher).toHaveBeenLastCalledWith(url, expect.objectContaining({ method: "GET", redirect: "error", signal }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.bodyUsed).toBe(true);
  });

  it("does not retry authentication failures or arbitrary insecure HTTP endpoints", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(preflightPdfResource(url, 1024, signal)).rejects.toThrow("resource");
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(preflightPdfResource("http://untrusted.example/a.pdf", 1024, signal)).rejects.toThrow("resource");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("admits the same signed preview on a loopback development service", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { headers: { "Content-Type": "application/pdf", "Content-Length": "100" } }));
    vi.stubGlobal("fetch", fetcher);
    await preflightPdfResource("http://127.0.0.1:8000/api/v1/content/p/inline?path=a.pdf&token=fixture", 1024, signal);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
