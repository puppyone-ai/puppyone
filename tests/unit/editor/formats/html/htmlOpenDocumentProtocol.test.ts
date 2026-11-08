import { describe, expect, it } from "vitest";
import { decodeHtmlOpenDocumentMessage } from "../../../../../src/shared-ui/editor/viewers/html/htmlBridgeProtocol";

const channel = "11111111-2222-3333-4444-555555555555";
const message = (overrides: Record<string, unknown> = {}) => ({
  type: "puppyone-html-open-document",
  channel,
  target: "topics/foo.md",
  ...overrides,
});

describe("decodeHtmlOpenDocumentMessage", () => {
  it("accepts a well-formed message with the expected channel", () => {
    expect(decodeHtmlOpenDocumentMessage(message(), channel)).toEqual({
      type: "puppyone-html-open-document",
      channel,
      target: "topics/foo.md",
    });
  });

  it("rejects a forged message with the wrong channel", () => {
    expect(decodeHtmlOpenDocumentMessage(message({ channel: "guess" }), channel)).toBeNull();
  });

  it("rejects a missing channel", () => {
    expect(decodeHtmlOpenDocumentMessage({ ...message(), channel: undefined }, channel)).toBeNull();
  });

  it("rejects control characters and backslashes in the target", () => {
    expect(decodeHtmlOpenDocumentMessage(message({ target: "a\u0000.md" }), channel)).toBeNull();
    expect(decodeHtmlOpenDocumentMessage(message({ target: "..\\a.md" }), channel)).toBeNull();
  });

  it("rejects an empty or oversized target", () => {
    expect(decodeHtmlOpenDocumentMessage(message({ target: "" }), channel)).toBeNull();
    expect(decodeHtmlOpenDocumentMessage(message({ target: "a".repeat(2049) }), channel)).toBeNull();
  });

  it("rejects unrelated message types", () => {
    expect(decodeHtmlOpenDocumentMessage({ type: "viewport", x: 1, y: 2 }, channel)).toBeNull();
  });
});
