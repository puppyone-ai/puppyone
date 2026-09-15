import { describe, expect, it, vi } from "vitest";
import {
  createDocumentNavigationPort,
  parseDocumentReferenceIntent,
} from "../../../../packages/shared-ui/src/editor/navigation/documentNavigation";

describe("document navigation boundary", () => {
  it("recognizes only complete, intentional cell references", () => {
    expect(parseDocumentReferenceIntent("https://example.com/docs")?.syntax).toBe("url");
    expect(parseDocumentReferenceIntent("[Docs](https://example.com/docs)")).toMatchObject({
      syntax: "markdown-link",
      label: "Docs",
      href: "https://example.com/docs",
    });
    expect(parseDocumentReferenceIntent("[[Spec|Design spec]]")).toMatchObject({
      syntax: "wiki-link",
      label: "Design spec",
      target: "Spec",
    });
    expect(parseDocumentReferenceIntent("[Spec](../notes/spec.md)")).toMatchObject({
      syntax: "markdown-link",
      label: "Spec",
      target: "../notes/spec.md",
    });
    expect(parseDocumentReferenceIntent("./notes/spec.md")).toMatchObject({
      syntax: "workspace-path",
      target: "./notes/spec.md",
    });
    expect(parseDocumentReferenceIntent("spec.md")).toBeNull();
    expect(parseDocumentReferenceIntent("Read https://example.com")).toBeNull();
  });

  it("denies unsafe external targets before they reach the host", () => {
    expect(parseDocumentReferenceIntent("javascript:alert(1)")).toMatchObject({
      kind: "denied",
      reason: "unsafe-protocol",
    });
    expect(parseDocumentReferenceIntent("https://user:secret@example.com")).toMatchObject({
      kind: "denied",
      reason: "credentials",
    });
    expect(parseDocumentReferenceIntent("https://example.com/%0aattack")).toMatchObject({
      kind: "denied",
      reason: "control-character",
    });
  });

  it("routes admitted external and workspace targets through host capabilities", async () => {
    const openExternalUrl = vi.fn();
    const openWorkspaceCandidates = vi.fn();
    const port = createDocumentNavigationPort({
      resolveWorkspaceReference(_sourcePath, target) {
        if (target === "Spec") {
          return {
            exists: true,
            ambiguous: false,
            path: "notes/spec.md",
            candidatePaths: ["notes/spec.md"],
          };
        }
        if (target === "Duplicate") {
          return {
            exists: false,
            ambiguous: true,
            path: null,
            candidatePaths: ["a/duplicate.md", "b/duplicate.md"],
          };
        }
        return { exists: false, ambiguous: false, path: null };
      },
      openExternalUrl,
      openWorkspaceCandidates,
    });

    const external = port.resolveReference("table.csv", "https://example.com/docs");
    const resolved = port.resolveReference("table.csv", "[[Spec]]");
    const ambiguous = port.resolveReference("table.csv", "[[Duplicate]]");
    const missing = port.resolveReference("table.csv", "[[Missing]]");
    if (!external || !resolved || !ambiguous || !missing) {
      throw new Error("Expected document references to resolve.");
    }
    expect(port.canOpenReference(external)).toBe(true);
    expect(port.canOpenReference(resolved)).toBe(true);
    expect(port.canOpenReference(ambiguous)).toBe(true);
    expect(port.canOpenReference(missing)).toBe(false);

    await port.openReference(external);
    await port.openReference(resolved);
    await port.openReference(ambiguous);
    await port.openReference(missing);

    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/docs");
    expect(openWorkspaceCandidates).toHaveBeenNthCalledWith(1, ["notes/spec.md"]);
    expect(openWorkspaceCandidates).toHaveBeenNthCalledWith(
      2,
      ["a/duplicate.md", "b/duplicate.md"],
    );
    expect(openWorkspaceCandidates).toHaveBeenCalledTimes(2);

    const forgedReference = {
      kind: "external",
      syntax: "url",
      raw: "javascript:alert(1)",
      label: "forged",
      href: "javascript:alert(1)",
    } as const;
    expect(port.canOpenReference(forgedReference)).toBe(false);
    await port.openReference(forgedReference);
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
  });

  it("reports external links unavailable when the Host omits that capability", () => {
    const port = createDocumentNavigationPort({});
    const reference = port.resolveReference("table.csv", "https://example.com");
    if (!reference) throw new Error("External reference did not resolve.");
    expect(port.canOpenReference(reference)).toBe(false);
  });
});
