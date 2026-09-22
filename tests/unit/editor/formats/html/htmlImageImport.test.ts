import { describe, expect, it, vi } from "vitest";
import { createDocumentAssetImportPort } from "../../../../../packages/shared-ui/src/editor/resource/DocumentAssetImport";
const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], "../unsafe-name.png", { type: "image/png" });

describe("document image import capability", () => {
  it("writes a unique image in the document directory before returning its portable path", async () => {
    const write = vi.fn(async (_files: File[], folder: string | null, options?: { preferredName?: string }) => ({ paths: [`${folder}/${options?.preferredName}`] }));
    const port = createDocumentAssetImportPort(write);
    const original = png();
    const first = await port.importImage("pages/index.html", original);
    const second = await port.importImage("pages/index.html", png());
    expect(first.path).toMatch(/^pages\/image-[a-z0-9-]+\.png$/);
    expect(second.path).not.toBe(first.path);
    expect(write.mock.calls[0]![1]).toBe("pages");
    expect(write.mock.calls[0]![0][0]).toBe(original);
    expect(write.mock.calls[0]![2]?.preferredName).not.toContain("unsafe");
  });
  it("rejects a spoofed MIME, SVG, traversal and over-budget import without writing", async () => {
    const write = vi.fn(async () => ({ paths: [] }));
    const port = createDocumentAssetImportPort(write);
    await expect(port.importImage("index.html", new File(["<script>bad()</script>"], "x.png", { type: "image/png" }))).rejects.toThrow("invalid-image");
    await expect(port.importImage("index.html", new File(["<svg></svg>"], "x.svg", { type: "image/svg+xml" }))).rejects.toThrow("invalid-image");
    await expect(port.importImage("../index.html", png())).rejects.toThrow("invalid-image");
    await expect(port.importImage("index.html", new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.png"))).rejects.toThrow("invalid-image");
    expect(write).not.toHaveBeenCalled();
  });
  it("propagates a failed write and rejects a result outside the admitted directory", async () => {
    const failing = createDocumentAssetImportPort(async () => { throw new Error("disk full"); });
    await expect(failing.importImage("page.html", png())).rejects.toThrow("disk full");
    const escaping = createDocumentAssetImportPort(async () => ({ paths: ["../private/image.png"] }));
    await expect(escaping.importImage("page.html", png())).rejects.toThrow("invalid-image-result");
  });
});
