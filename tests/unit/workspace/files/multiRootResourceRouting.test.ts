import { describe, expect, it } from "vitest";
import {
  createWorkspaceResourceUri,
  createWorkspaceRootUri,
  qualifyDataResourcePath,
  type AiEditRequest,
  type MarkdownLinkGraph,
} from "../../../../packages/shared-ui/src";
import {
  fromContextMapRelativePath,
  getContextMapScopePath,
  toContextMapRelativePath,
} from "../../../../packages/shared-ui/src/editor/viewers/context-map/contextMapDocument";
import {
  resolveMarkdownAssetPath,
  resolveMarkdownMediaReference,
} from "../../../../packages/shared-ui/src/editor/markdown/features/media/markdownMediaReference";
import { qualifyAiEditRequest } from "../../../../src/features/data-workspace/useAiEditReviewRequest";

describe("multi-root Resource URI routing", () => {
  it("keeps Context Map scope and relative paths inside the owning Folder URI", () => {
    const root = createWorkspaceRootUri("alpha-instance");
    const document = createWorkspaceResourceUri(root, "maps/team.contextmap");
    const scope = createWorkspaceResourceUri(root, "maps");
    const child = createWorkspaceResourceUri(root, "maps/docs/README.md");

    expect(getContextMapScopePath(document)).toBe(scope);
    expect(toContextMapRelativePath(scope, child)).toBe("docs/README.md");
    expect(fromContextMapRelativePath(scope, "docs/README.md")).toBe(child);
  });

  it("preserves an indexed Markdown media Resource URI through AssetBroker routing", () => {
    const root = createWorkspaceRootUri("beta-instance");
    const source = createWorkspaceResourceUri(root, "notes/README.md");
    const image = createWorkspaceResourceUri(root, "assets/diagram.png");
    const linkGraph = {
      resolveWikiLink: () => ({ exists: true, ambiguous: false, path: image }),
    } as unknown as MarkdownLinkGraph;

    const reference = resolveMarkdownMediaReference(source, "diagram.png", "wiki-target", linkGraph);
    expect(reference).toBe(image);
    expect(resolveMarkdownAssetPath(source, reference!)).toBe(image);
  });

  it("qualifies Git, Agent, and AI provider paths at an explicit Folder boundary", () => {
    const root = createWorkspaceRootUri("gamma-instance");
    const readme = createWorkspaceResourceUri(root, "README.md");
    const request: AiEditRequest = {
      id: "request-1",
      sessionId: "session-1",
      files: [{
        id: "file-1",
        requestId: "request-1",
        path: "README.md",
        status: "modified",
        beforeHash: "before",
        afterHash: "after",
        additions: 1,
        deletions: 1,
        hunks: [],
      }],
    };

    expect(qualifyDataResourcePath(root, "README.md")).toBe(readme);
    expect(qualifyAiEditRequest(request, root)?.files[0]?.path).toBe(readme);
  });
});
