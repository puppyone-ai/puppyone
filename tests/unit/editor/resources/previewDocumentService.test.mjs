import { describe, expect, it } from "vitest";
import { createPreviewDocumentService } from "../../../../electron/main/preview-document-service.mjs";

describe("provider-neutral immutable preview documents", () => {
  it("serves exact snapshots with an opaque sandbox and no filesystem authority", async () => {
    const service = createPreviewDocumentService();
    const { url } = service.create(7, { content: "<h1>Cloud snapshot</h1>" });
    expect(url).not.toContain("Cloud snapshot");
    const response = service.handle({ url, method: "GET" });
    expect(await response.text()).toBe("<h1>Cloud snapshot</h1>");
    expect(response.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
    expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    expect(service.handle({ url, method: "HEAD" }).headers.get("content-length")).toBe("23");
    expect(await service.handle({ url, method: "HEAD" }).text()).toBe("");
  });
  it("permits page interaction in an opaque sandbox and restricts revocation to the owning sender", async () => {
    const service = createPreviewDocumentService();
    const a = service.create(7, { content: "A", interactive: true }).url;
    const b = service.create(8, { content: "B" }).url;
    const policy = service.handle({ url: a }).headers.get("content-security-policy");
    expect(policy).toContain("allow-scripts");
    expect(policy).toContain("allow-forms");
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).not.toContain("allow-top-navigation");
    expect(service.revoke(8, a)).toBe(false);
    service.revokeOwner(7);
    expect(service.handle({ url: a }).status).toBe(404);
    expect(await service.handle({ url: b }).text()).toBe("B");
    expect(service.revoke(8, b)).toBe(true);
    expect(service.revoke(8, b)).toBe(false);
  });
  it("rejects forged paths, methods and unbounded UTF-8 allocations", () => {
    const service = createPreviewDocumentService();
    const { url } = service.create(7, { content: "OK" });
    for (const modified of [`${url}?path=/private/file`, `${url}#token`, url.replace("document", "other"), url.replace("index.html", "other.html")]) {
      expect(service.handle({ url: modified }).status).toBe(404);
    }
    expect(service.handle({ url, method: "POST" }).status).toBe(405);
    expect(() => service.create(7, { content: "你".repeat(2 * 1024 * 1024) })).toThrow(/budget/);
    expect(() => service.create(-1, { content: "x" })).toThrow(/Invalid/);
  });
  it("bounds retained leases and releases capacity on owner close", () => {
    const service = createPreviewDocumentService();
    for (let i = 0; i < 128; i++) service.create(7, { content: "x" });
    expect(() => service.create(7, { content: "x" })).toThrow(/budget/);
    service.revokeOwner(7);
    expect(() => service.create(7, { content: "x" })).not.toThrow();
  });
});
