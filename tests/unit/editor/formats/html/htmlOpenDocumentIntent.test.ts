import { describe, expect, it, vi } from "vitest";
import { openWorkspaceDocumentIntent, parseHtmlDocumentOpenTarget } from "../../../../../src/shared-ui/editor/viewers/html/htmlOpenDocumentIntent";

describe("parseHtmlDocumentOpenTarget", () => {
  it("accepts a plain workspace-relative document", () => {
    expect(parseHtmlDocumentOpenTarget("topics/foo.md")).toEqual({ target: "topics/foo.md", anchor: null });
  });

  it("splits a heading anchor", () => {
    expect(parseHtmlDocumentOpenTarget("topics/foo.md#证据")).toEqual({
      target: "topics/foo.md", anchor: "证据",
    });
  });

  it("drops the query string", () => {
    expect(parseHtmlDocumentOpenTarget("topics/foo.md?plain=1#a")).toEqual({
      target: "topics/foo.md", anchor: "a",
    });
  });

  it("rejects absolute, protocol and traversal targets", () => {
    expect(parseHtmlDocumentOpenTarget("/etc/passwd.md")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("//evil.example/a.md")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("javascript:alert(1)")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("../../outside.md")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("a/../../b.md")).toBeNull();
  });

  it("rejects non-document extensions", () => {
    expect(parseHtmlDocumentOpenTarget("a.exe")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("a.png")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("a")).toBeNull();
  });

  it("does not mistake a doubled dot inside a name for traversal", () => {
    expect(parseHtmlDocumentOpenTarget("a..b.md")).toEqual({ target: "a..b.md", anchor: null });
  });

  it("rejects a fragment-only target", () => {
    expect(parseHtmlDocumentOpenTarget("#only-anchor")).toBeNull();
  });
});

describe("openWorkspaceDocumentIntent", () => {
  const navigation = () => {
    const resolveReference = vi.fn((_source: string, raw: string) => ({
      kind: "workspace" as const,
      syntax: "workspace-path" as const,
      raw,
      label: raw,
      target: raw,
      anchor: raw.includes("#") ? raw.split("#")[1]! : null,
      status: "resolved" as const,
      path: "topics/foo.md",
      candidatePaths: ["topics/foo.md"],
    }));
    return {
      port: {
        resolveReference,
        canOpenReference: vi.fn(() => true),
        openReference: vi.fn(),
      },
      resolveReference,
    };
  };

  it("resolves an explicit relative path and keeps the fragment", () => {
    const { port, resolveReference } = navigation();
    openWorkspaceDocumentIntent(port, "board/kanban.html", { target: "topics/foo.md", anchor: "证据" });
    expect(resolveReference).toHaveBeenCalledWith("board/kanban.html", "./topics/foo.md#证据");
    expect(port.openReference).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the port refuses the reference", () => {
    const { port } = navigation();
    port.canOpenReference = vi.fn(() => false);
    openWorkspaceDocumentIntent(port, "board/kanban.html", { target: "topics/foo.md", anchor: null });
    expect(port.openReference).not.toHaveBeenCalled();
  });

  it("does nothing without a navigation port", () => {
    expect(() => openWorkspaceDocumentIntent(null, "board/kanban.html", {
      target: "topics/foo.md",
      anchor: null,
    })).not.toThrow();
  });
});
