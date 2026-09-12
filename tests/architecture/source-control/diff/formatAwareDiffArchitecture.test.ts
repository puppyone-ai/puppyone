import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gitStatusView = read("../../../../src/features/source-control/GitStatusView.tsx");
const gitFileDiffSurface = read("../../../../src/features/source-control/diff/GitFileDiffSurface.tsx");
const formatAwareDiff = read("../../../../src/features/source-control/diff/FormatAwareDiff.tsx");
const registry = read("../../../../src/features/source-control/diff/core/registry.ts");
const asyncContribution = read("../../../../src/features/source-control/diff/core/createAsyncDiffContribution.tsx");
const docxContribution = read("../../../../src/features/source-control/diff/contributions/docx-redline/contribution.tsx");
const provider = read("../../../../src/features/source-control/diff/contributions/docx-redline/provider.ts");
const packageParser = read("../../../../src/features/source-control/diff/contributions/docx-redline/worker/package.ts");
const workerClient = read("../../../../src/features/source-control/diff/contributions/docx-redline/worker/client.ts");
const revisionAuthority = read("../../../../local-api/git/revision-pair.mjs");
const ipc = read("../../../../electron/main/ipc/workspace-git-ipc.mjs");

describe("format-aware diff architecture", () => {
  it("keeps format decisions in the ordered registry rather than GitStatusView", () => {
    expect(gitStatusView).toContain("<GitFileDiffSurface");
    expect(gitFileDiffSurface).toContain("<FormatAwareDiff");
    expect(gitStatusView).not.toMatch(/\.docx|format\.id|file\.binary\s*\?/);
    expect(gitFileDiffSurface).not.toMatch(/\.docx|file\.binary\s*\?/);
    expect(gitFileDiffSurface).toContain("resolveDiffViewer(file)");
    expect(gitFileDiffSurface).toContain("resolvedViewer={resolvedViewer}");
    expect(formatAwareDiff).not.toContain("resolveDiffViewer");
    expect(formatAwareDiff).toContain("resolvedViewer: ResolvedDiffViewer");
    const contributionOrder = registry.slice(registry.indexOf("Object.freeze"));
    expect(contributionOrder.indexOf("docxRedlineContribution"))
      .toBeLessThan(contributionOrder.indexOf("textUnifiedContribution"));
    expect(contributionOrder.indexOf("textUnifiedContribution"))
      .toBeLessThan(contributionOrder.indexOf("binarySummaryContribution"));
    expect(registry).toContain("resolveFileFormat");
  });

  it("keeps async lifecycle generic and heavy DOCX parsing behind provider and worker boundaries", () => {
    expect(docxContribution).toContain('import("./provider")');
    expect(docxContribution).toContain("createAsyncDiffContribution");
    expect(asyncContribution).toContain("new AbortController");
    expect(asyncContribution).toContain("loadSequenceRef");
    expect(docxContribution).not.toContain("jszip");
    expect(registry).not.toContain("docxRedlineTask");
    expect(provider).toContain("buildDocxRedlineInWorker");
    expect(workerClient).toContain("new Worker");
    expect(packageParser).toContain("validateOfficePackageDecompression");
    expect(packageParser).toContain('await import("jszip")');
  });

  it("keeps resource authority and cancellation in trusted IPC", () => {
    expect(ipc).toContain('"workspace:git-file-diff-cancel"');
    expect(ipc).toContain('"workspace:git-diff-resource-read"');
    expect(ipc).toContain("ownerWebContentsId: event.sender.id");
    expect(ipc).toContain("offset: request?.offset");
    expect(ipc).toContain("controller.signal");
    expect(revisionAuthority).toContain("fsConstants.O_NOFOLLOW");
    expect(revisionAuthority).toContain("handle.stat()");
    expect(revisionAuthority).not.toContain("fs.readFile(canonicalCandidate");
  });
});

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
