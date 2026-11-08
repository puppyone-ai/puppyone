import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildHtmlPreviewDocument,
  getHtmlPreviewPolicy,
} from "../../../../src/shared-ui/editor/viewers/html/HtmlPreviewFrame";
import {
  htmlOpenDocumentScript,
  htmlPageViewportScript,
} from "../../../../src/shared-ui/editor/viewers/html/htmlPageViewport";

const frameSource = readFileSync(
  new URL("../../../../src/shared-ui/editor/viewers/html/HtmlPreviewFrame.tsx", import.meta.url),
  "utf8",
);

describe("HTML preview navigation boundary", () => {
  it("never grants the frame same-origin or top navigation", () => {
    for (const interactive of [false, true]) {
      for (const mode of ["safe", "localTrusted"] as const) {
        const { sandbox } = getHtmlPreviewPolicy(mode, interactive);
        expect(sandbox).not.toContain("allow-same-origin");
        expect(sandbox).not.toContain("allow-top-navigation");
      }
    }
  });

  it("injects fixed scripts whose only interpolation is the channel", () => {
    for (const script of [htmlOpenDocumentScript, htmlPageViewportScript]) {
      const first = script("00000000-0000-4000-8000-000000000001");
      const second = script("11111111-2222-4333-8444-555555555555");
      expect(first.replaceAll("00000000-0000-4000-8000-000000000001", "<channel>"))
        .toBe(second.replaceAll("11111111-2222-4333-8444-555555555555", "<channel>"));
      expect(first).not.toContain("${");
    }
  });

  it("keeps page markup out of the injected script text", () => {
    const output = buildHtmlPreviewDocument(
      `<html><head></head><body><p>${"x".repeat(64)}</p></body></html>`,
      null,
      getHtmlPreviewPolicy("safe", true),
      "viewport-channel",
      "document-channel",
    );
    expect(output).toContain("viewport-channel");
    expect(output).toContain("document-channel");
    // The page's own text stays page content; it is never concatenated into
    // either injected script.
    const scriptText = [...output.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1]).join("\n");
    expect(scriptText).toContain("document-channel");
    expect(scriptText).not.toContain("xxxxxxxx");
  });

  it("does not reach for host capabilities while projecting the page", () => {
    expect(frameSource).not.toMatch(/dataTransfer|clipboard|ipcRenderer|nodeIntegration/);
  });
});
