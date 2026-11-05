import { describe, expect, it, vi } from "vitest";
import { createDocumentNavigationPort } from "../../../../../../src/shared-ui/editor/navigation/documentNavigation";
import {
  clearDocumentAnchorReveal,
  consumeDocumentAnchorReveal,
  requestDocumentAnchorReveal,
} from "../../../../../../src/shared-ui/editor/navigation/documentAnchorReveal";

const resolveWorkspaceReference = (sourcePath: string, target: string) => ({
  exists: true,
  ambiguous: false,
  path: `topics/${target.split("/").pop()}`,
  sourcePath,
});

describe("workspace references with a heading", () => {
  it("keeps the fragment out of the path and carries it as the anchor", () => {
    const port = createDocumentNavigationPort({ resolveWorkspaceReference });
    const reference = port.resolveReference("a.md", "./b.md#证据");
    expect(reference).toMatchObject({
      kind: "workspace",
      target: "./b.md",
      anchor: "证据",
      path: "topics/b.md",
    });
  });

  it("opens at the anchor when the host can reveal positions", async () => {
    const openWorkspaceCandidates = vi.fn();
    const openWorkspaceCandidateAt = vi.fn();
    const port = createDocumentNavigationPort({
      resolveWorkspaceReference,
      openWorkspaceCandidates,
      openWorkspaceCandidateAt,
    });
    const reference = port.resolveReference("a.md", "./b.md#证据");
    await port.openReference(reference!);
    expect(openWorkspaceCandidateAt).toHaveBeenCalledWith("topics/b.md", "证据");
    expect(openWorkspaceCandidates).not.toHaveBeenCalled();
  });

  it("still opens the document when the host cannot reveal positions", async () => {
    const openWorkspaceCandidates = vi.fn();
    const port = createDocumentNavigationPort({ resolveWorkspaceReference, openWorkspaceCandidates });
    const reference = port.resolveReference("a.md", "./b.md#证据");
    await port.openReference(reference!);
    expect(openWorkspaceCandidates).toHaveBeenCalledWith(["topics/b.md"]);
  });
});

describe("document anchor reveal requests", () => {
  it("keeps one pending request until the target document consumes it", () => {
    requestDocumentAnchorReveal("topics/b.md", "证据");
    const pending = consumeDocumentAnchorReveal();
    expect(pending).toMatchObject({ path: "topics/b.md", anchor: "证据" });
    clearDocumentAnchorReveal(pending!.id);
    expect(consumeDocumentAnchorReveal()).toBeNull();
  });
});
