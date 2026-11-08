/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import {
  buildHtmlPreviewDocument,
  getHtmlPreviewPolicy,
  readHtmlOpenDocumentIntent,
} from "../../../../../src/shared-ui/editor/viewers/html/HtmlPreviewFrame";

const channel = "11111111-2222-3333-4444-555555555555";

function frame(contentWindow: object | null) {
  return { contentWindow } as unknown as HTMLIFrameElement;
}

describe("readHtmlOpenDocumentIntent", () => {
  it("accepts a document intent from this frame's own window", () => {
    const window = {};
    const intent = readHtmlOpenDocumentIntent({
      source: window as unknown as MessageEventSource,
      data: { type: "puppyone-html-open-document", channel, target: "../topics/foo.md#证据" },
    }, frame(window), channel);
    // Traversal is refused by the target validator even with a valid channel.
    expect(intent).toBeNull();
    expect(readHtmlOpenDocumentIntent({
      source: window as unknown as MessageEventSource,
      data: { type: "puppyone-html-open-document", channel, target: "topics/foo.md#证据" },
    }, frame(window), channel)).toEqual({ target: "topics/foo.md", anchor: "证据" });
  });

  it("drops messages from another window", () => {
    const intent = readHtmlOpenDocumentIntent({
      source: { other: true } as unknown as MessageEventSource,
      data: { type: "puppyone-html-open-document", channel, target: "topics/foo.md" },
    }, frame({}), channel);
    expect(intent).toBeNull();
  });

  it("drops forged channels", () => {
    const window = {};
    expect(readHtmlOpenDocumentIntent({
      source: window as unknown as MessageEventSource,
      data: { type: "puppyone-html-open-document", channel: "guess", target: "topics/foo.md" },
    }, frame(window), channel)).toBeNull();
  });

  it("drops messages without a live frame", () => {
    expect(readHtmlOpenDocumentIntent({
      source: null,
      data: { type: "puppyone-html-open-document", channel, target: "topics/foo.md" },
    }, null, channel)).toBeNull();
  });
});

describe("preview projection bridge", () => {
  it("injects the open-document script with the injected channel only", () => {
    const policy = getHtmlPreviewPolicy("safe", true);
    const output = buildHtmlPreviewDocument(
      "<html><head></head><body><a href=\"topics/foo.md\">Open</a></body></html>",
      null,
      policy,
      undefined,
      channel,
    );
    expect(output).toContain("puppyone-html-open-document");
    expect(output).toContain(channel);
    // The page content itself never becomes script text.
    expect(output).not.toContain("<script>const channel");
    expect(output).not.toContain("javascript:channel");
  });

  it("keeps the sandbox unchanged", () => {
    const policy = getHtmlPreviewPolicy("safe", true);
    expect(policy.sandbox).not.toContain("allow-same-origin");
    expect(policy.sandbox).not.toContain("allow-top-navigation");
  });
});
