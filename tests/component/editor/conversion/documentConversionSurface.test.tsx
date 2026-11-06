/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTestLocalization } from "../../../support/react/localization";
import { DocumentConversionProvider } from "../../../../src/shared-ui/editor/conversion/DocumentConversionProvider";
import { DocumentConversionSurface } from "../../../../src/shared-ui/editor/conversion/DocumentConversionSurface";
import type { ConversionResult } from "../../../../src/shared-ui/editor/conversion/types";
import { convertDocument } from "../../../../src/shared-ui/editor/conversion/conversionClient";
vi.mock("../../../../src/shared-ui/editor/conversion/conversionClient", () => ({ convertDocument: vi.fn() }));
vi.mock("../../../../src/shared-ui/editor/conversion/ConversionMarkdownPreview", () => ({ default: ({ result }: { result: ConversionResult }) => <pre>{result.markdown}</pre> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const result: ConversionResult = { markdown: "# Report\n", fingerprint: "abc", tables: [{ id: "table-001", rows: [["Code"], ["0012"]] }], assets: [], warnings: [{ code: "merged-cells" }] };
let root: Root; let container: HTMLDivElement;
const save = vi.fn(async () => ({ folderPath: "report-converted", openPath: "report-converted/report.md", paths: [] }));
const open = vi.fn();
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); vi.mocked(convertDocument).mockReset(); save.mockClear(); open.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(name = "report.docx") {
  await act(async () => root.render(withTestLocalization(<DocumentConversionProvider port={{ save, open }}><DocumentConversionSurface document={{ path: name, name, type: "document" }} fileUrl="blob:source"><div data-original>Original preview</div></DocumentConversionSurface></DocumentConversionProvider>)));
}
async function click(label: string) { const button = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); }
describe("document conversion workflow", () => {
  it("opens comparison without replacing the source, converts and saves only selected outputs", async () => {
    vi.mocked(convertDocument).mockResolvedValue(result);
    await render(); await click("Convert");
    expect(container.querySelector("[data-original]")).not.toBeNull();
    expect(container.textContent).toContain("Convert to Markdown");
    await click("Start conversion");
    expect(container.textContent).toContain("# Report");
    expect(container.textContent).toContain("Cells spanning rows");
    const checkbox = container.querySelector<HTMLInputElement>('input[data-output="markdown"]')!;
    await act(async () => checkbox.click());
    await click("Save and open");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ selection: { markdown: false, tableIds: ["table-001"] } }));
    expect(open).toHaveBeenCalledWith("report-converted/report.md");
  });
  it("cancels parsing and does not publish late results", async () => {
    let complete!: (result: ConversionResult) => void;
    vi.mocked(convertDocument).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await render(); await click("Convert"); await click("Start conversion");
    const signal = vi.mocked(convertDocument).mock.calls[0][2];
    await click("Cancel"); expect(signal.aborted).toBe(true);
    await act(async () => complete(result));
    expect(container.textContent).not.toContain("# Report");
    expect(save).not.toHaveBeenCalled();
  });
  it("explains scan-only PDFs and supports retry without saving an empty result", async () => {
    const { DocumentConversionError } = await import("../../../../src/shared-ui/editor/conversion/types");
    vi.mocked(convertDocument).mockRejectedValue(new DocumentConversionError("ocr-required"));
    await render("scan.pdf"); await click("Convert"); await click("Start conversion");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("OCR");
    expect([...container.querySelectorAll("button")].find(button => button.textContent?.includes("Save and open"))).toBeUndefined();
    vi.mocked(convertDocument).mockResolvedValue(result); await click("Retry");
    expect(container.textContent).toContain("# Report");
  });
  it("does not add conversion controls to unsupported input", async () => {
    await render("report.pptx"); expect(container.textContent).toBe("Original preview");
  });
});
