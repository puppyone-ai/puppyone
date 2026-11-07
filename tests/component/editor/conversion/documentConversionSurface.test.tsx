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
const save = vi.fn(async () => ({ folderPath: "converted/report", openPath: "converted/report/report.md", paths: [] }));
const open = vi.fn();
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); vi.mocked(convertDocument).mockReset(); save.mockClear(); open.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(name = "report.docx") {
  await act(async () => root.render(withTestLocalization(<DocumentConversionProvider port={{ save, open }}><DocumentConversionSurface document={{ path: name, name, type: "document" }} fileUrl="blob:source"><div data-original>Original preview</div></DocumentConversionSurface></DocumentConversionProvider>)));
}
async function click(label: string) { const button = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); }
describe("document conversion workflow", () => {
  it("returns to recognition settings before converting again", async () => {
    vi.mocked(convertDocument).mockResolvedValue(result);
    await render("scan.pdf"); await click("Convert"); await click("Start conversion"); await click("Convert again");
    expect(container.querySelectorAll("select")).toHaveLength(2);
    expect(convertDocument).toHaveBeenCalledTimes(1);
    await click("Start conversion"); expect(convertDocument).toHaveBeenCalledTimes(2);
  });
  it("sends selected OCR mode and language for PDFs and shows recognition progress", async () => {
    vi.mocked(convertDocument).mockImplementation(async (_url, _format, _signal, progress) => { progress(2, 3, "ocr", 0.5); return new Promise(() => {}); });
    await render("scan.pdf"); await click("Convert");
    const selects = container.querySelectorAll("select");
    expect(selects[0].value).toBe("auto"); expect(selects[1].value).toBe("chi_sim+eng");
    await act(async () => { selects[0].value = "always"; selects[0].dispatchEvent(new Event("change", { bubbles: true })); selects[1].value = "eng"; selects[1].dispatchEvent(new Event("change", { bubbles: true })); });
    await click("Start conversion");
    expect(vi.mocked(convertDocument).mock.calls[0][4]).toEqual({ mode: "always", language: "eng" });
    expect(container.textContent).toContain("Recognizing page 2 of 3 · 50%");
    await click("Cancel"); expect(vi.mocked(convertDocument).mock.calls[0][2].aborted).toBe(true);
    expect(container.querySelectorAll("select")[0].value).toBe("always");
  });
  it("opens comparison without replacing the source, converts and saves only selected outputs", async () => {
    vi.mocked(convertDocument).mockResolvedValue(result);
    await render(); await click("Convert");
    expect(container.querySelector("[data-original]")).not.toBeNull();
    expect(container.textContent).toContain("Convert to Markdown");
    expect(container.textContent).toContain("Save to project root");
    expect(container.textContent).toContain("converted/");
    await click("Start conversion");
    expect(container.textContent).toContain("# Report");
    expect(container.textContent).toContain("Cells spanning rows");
    const checkbox = container.querySelector<HTMLInputElement>('input[data-output="markdown"]')!;
    await act(async () => checkbox.click());
    await click("Save and open");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ selection: { markdown: false, tableIds: ["table-001"] } }));
    expect(open).toHaveBeenCalledWith("converted/report/report.md");
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
  it("shows the saved project-relative folder rather than an internal resource URI", async () => {
    vi.mocked(convertDocument).mockResolvedValue(result);
    save.mockResolvedValueOnce({ folderPath: "puppyone-local://workspace/record/converted/report", openPath: "puppyone-local://workspace/record/converted/report/report.md", paths: [] });
    await render(); await click("Convert"); await click("Start conversion"); await click("Save and open");
    expect(container.querySelector(".document-conversion__save-location")?.textContent).toContain("converted/report");
    expect(container.querySelector(".document-conversion__save-location")?.textContent).not.toContain("puppyone-local:");
  });
});
