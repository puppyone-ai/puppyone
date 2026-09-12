import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { alignDocxBlocks } from "../../../../../src/features/source-control/diff/contributions/docx-redline/worker/align";
import { normalizeDocxDocumentXml } from "../../../../../src/features/source-control/diff/contributions/docx-redline/worker/normalize";
import {
  buildDocxRedlinePresentation,
  runDocxRedlineWorkerTask,
} from "../../../../../src/features/source-control/diff/contributions/docx-redline/worker/task";
import { buildDocxRedlineInWorker } from "../../../../../src/features/source-control/diff/contributions/docx-redline/worker/client";

describe("DOCX semantic redline", () => {
  it("normalizes runs, headings, list items, and table rows into stable blocks", () => {
    const blocks = normalizeDocxDocumentXml(documentXml([
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Release</w:t></w:r><w:r><w:t> notes</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>First item</w:t></w:r></w:p>',
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    ]));

    expect(blocks).toMatchObject([
      { kind: "heading", text: "Release notes", sourceIndex: 0 },
      { kind: "list-item", text: "First item", sourceIndex: 1 },
      { kind: "table-row", text: "Name | Status", cells: ["Name", "Status"], sourceIndex: 2 },
    ]);
  });

  it("parses namespace-aware OOXML independently of the chosen prefix", () => {
    const strictNamespace = "http://purl.oclc.org/ooxml/wordprocessingml/main";
    const xml = [
      `<doc:document xmlns:doc="${strictNamespace}"><doc:body>`,
      '<doc:p data-note="1 > 0"><doc:pPr><doc:pStyle doc:val="Heading2"/></doc:pPr>',
      "<!-- a > character in a comment must not confuse tokenization -->",
      "<doc:r><doc:t>Portable prefix</doc:t></doc:r></doc:p>",
      "</doc:body></doc:document>",
    ].join("");
    expect(normalizeDocxDocumentXml(xml)).toEqual([
      { kind: "heading", text: "Portable prefix", sourceIndex: 0 },
    ]);
  });

  it("omits tracked deletions and rejects DTDs and malformed XML", () => {
    const xml = documentXml([
      '<w:p><w:del><w:r><w:t>Removed text</w:t></w:r></w:del><w:r><w:t>Visible text</w:t></w:r></w:p>',
    ]);
    expect(normalizeDocxDocumentXml(xml)[0]?.text).toBe("Visible text");
    expect(() => normalizeDocxDocumentXml(
      '<!DOCTYPE w:document><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    )).toThrow(/document type/i);
    expect(() => normalizeDocxDocumentXml(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p>',
    )).toThrow(/malformed/i);
  });

  it("builds located paragraph and word-level additions and removals from validated fixtures", async () => {
    const before = await buildDocx(documentXml([
      paragraph("Stable introduction"),
      paragraph("The release is ready for internal testing."),
      paragraph("Stable ending"),
    ]));
    const after = await buildDocx(documentXml([
      paragraph("Stable introduction"),
      paragraph("The release is ready for broad customer testing."),
      paragraph("New deployment note"),
      paragraph("Stable ending"),
    ]));

    const model = await buildDocxRedlinePresentation(before, after);
    expect(model.state).toBe("ready");
    expect(model.stats).toMatchObject({
      blocksAdded: 1,
      blocksModified: 1,
      blocksChanged: 2,
    });
    expect(model.stats.wordsAdded).toBeGreaterThan(0);
    expect(model.stats.wordsDeleted).toBeGreaterThan(0);
    expect(model.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "modified", beforeIndex: 1, afterIndex: 1 }),
      expect.objectContaining({ kind: "added", afterIndex: 2 }),
    ]));
    const modified = model.changes.find((change) => change.kind === "modified");
    expect(modified?.segments.some((segment) => segment.kind === "remove" && segment.text.includes("internal"))).toBe(true);
    expect(modified?.segments.some((segment) => segment.kind === "add" && segment.text.includes("broad customer"))).toBe(true);
  });

  it("models one-sided added and deleted documents explicitly", async () => {
    const revision = await buildDocx(documentXml([paragraph("Only revision")]));
    const added = await buildDocxRedlinePresentation(null, revision.slice(0));
    const deleted = await buildDocxRedlinePresentation(revision.slice(0), null);

    expect(added).toMatchObject({ state: "added", stats: { blocksAdded: 1 } });
    expect(deleted).toMatchObject({ state: "deleted", stats: { blocksDeleted: 1 } });
  });

  it("aligns inserted blocks without turning stable neighbors into modifications", () => {
    const block = (text: string, sourceIndex: number) => ({ kind: "paragraph" as const, text, sourceIndex });
    const changes = alignDocxBlocks(
      [block("alpha", 0), block("omega", 1)],
      [block("alpha", 0), block("inserted", 1), block("omega", 2)],
    );
    expect(changes).toEqual([
      expect.objectContaining({ kind: "added", afterIndex: 1 }),
    ]);
  });

  it("rejects malformed packages and reports worker failures without a partial model", async () => {
    await expect(buildDocxRedlinePresentation(new Uint8Array([1, 2, 3]).buffer, null)).rejects.toThrow();
    const postMessage = vi.fn();
    await runDocxRedlineWorkerTask(
      { before: new Uint8Array([1, 2, 3]).buffer, after: null },
      postMessage,
    );
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ message: expect.any(String) }),
    }));
  });

  it("reports encrypted Word containers explicitly", async () => {
    const encryptedHeader = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(buildDocxRedlinePresentation(encryptedHeader.buffer, null)).rejects.toMatchObject({
      name: "DocxEncryptedError",
      message: expect.stringMatching(/encrypted|password/i),
    });
  });

  it("enforces semantic expansion budgets", () => {
    const oversized = documentXml([paragraph("x".repeat(2_000_001))]);
    expect(() => normalizeDocxDocumentXml(oversized)).toThrow(/budget/i);
  });

  it("honors cancellation before starting a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(buildDocxRedlineInWorker(new ArrayBuffer(1), null, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});

async function buildDocx(xml: string) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("_rels/.rels", "<Relationships/>");
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "arraybuffer", compression: "STORE" });
}

function documentXml(body: string[]) {
  return [
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    ...body,
    "</w:body></w:document>",
  ].join("");
}

function paragraph(text: string) {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}
