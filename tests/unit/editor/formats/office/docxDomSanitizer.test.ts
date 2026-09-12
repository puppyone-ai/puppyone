import { describe, expect, it } from "vitest";
import {
  assertDocxDomWithinBudget,
  classifyDocxLink,
  containsUnsafeDocxCss,
  DocxDomLimitError,
  isSafeDocxResourceUrl,
} from "../../../../../packages/shared-ui/src/editor/security/docxDomSanitizer";

describe("assertDocxDomWithinBudget", () => {
  it("accepts a rendered tree within both budgets", () => {
    const root = createBudgetRoot(20, 2);
    expect(() => assertDocxDomWithinBudget(root, { maxElements: 20, maxPages: 2 })).not.toThrow();
  });

  it("rejects element and page explosions before attachment", () => {
    expect(() => assertDocxDomWithinBudget(createBudgetRoot(21, 2), {
      maxElements: 20,
      maxPages: 2,
    })).toThrow(DocxDomLimitError);
    expect(() => assertDocxDomWithinBudget(createBudgetRoot(20, 3), {
      maxElements: 20,
      maxPages: 2,
    })).toThrow(/3 pages/);
  });
});

describe("classifyDocxLink", () => {
  it("preserves only same-document fragments as directly navigable links", () => {
    expect(classifyDocxLink("#heading-2")).toEqual({
      kind: "internal",
      href: "#heading-2",
    });
    expect(classifyDocxLink("  #footnote-1  ")).toEqual({
      kind: "internal",
      href: "#footnote-1",
    });
  });

  it("turns http, https, and mailto links into normalized external actions", () => {
    expect(classifyDocxLink("https://example.com/a?q=1")).toEqual({
      kind: "external",
      href: "https://example.com/a?q=1",
      protocol: "https:",
    });
    expect(classifyDocxLink("HTTP://EXAMPLE.COM")).toEqual({
      kind: "external",
      href: "http://example.com/",
      protocol: "http:",
    });
    expect(classifyDocxLink("mailto:person@example.com")).toEqual({
      kind: "external",
      href: "mailto:person@example.com",
      protocol: "mailto:",
    });
  });

  it("strips active, local, relative, credentialed, and obfuscated URLs", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "puppyone-local://file/root/secret",
      "blob:https://example.com/id",
      "//example.com/path",
      "relative/path",
      "https://user:password@example.com/",
      "https://example.com/%0aheader",
      "java\nscript:alert(1)",
      "",
    ]) {
      expect(classifyDocxLink(value), value).toEqual({ kind: "remove" });
    }
  });
});

describe("isSafeDocxResourceUrl", () => {
  it("allows only inert embedded resources and fragments", () => {
    expect(isSafeDocxResourceUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isSafeDocxResourceUrl("data:font/woff2;base64,AAAA")).toBe(true);
    expect(isSafeDocxResourceUrl("blob:https://app.invalid/id")).toBe(true);
    expect(isSafeDocxResourceUrl("about:blank")).toBe(true);
    expect(isSafeDocxResourceUrl("#embedded-shape")).toBe(true);
  });

  it("rejects network, scriptable data, application, and local-file resources", () => {
    expect(isSafeDocxResourceUrl("https://tracker.example/pixel.png")).toBe(false);
    expect(isSafeDocxResourceUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeDocxResourceUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeDocxResourceUrl("file:///tmp/image.png")).toBe(false);
    expect(isSafeDocxResourceUrl("puppyone-local://file/root/secret.png")).toBe(false);
  });
});

describe("containsUnsafeDocxCss", () => {
  it("accepts ordinary styles plus embedded and fragment resource URLs", () => {
    expect(containsUnsafeDocxCss("color: #222; margin-left: 12px")).toBe(false);
    expect(containsUnsafeDocxCss("src: url(data:font/woff2;base64,AAAA)")).toBe(false);
    expect(containsUnsafeDocxCss("fill: url(#gradient-1)")).toBe(false);
    expect(containsUnsafeDocxCss("background-image: url('blob:https://app.invalid/id')")).toBe(false);
  });

  it("rejects network loads, imports, legacy script CSS, escapes, and malformed url tokens", () => {
    for (const value of [
      "background: url(https://tracker.example/pixel.png)",
      "@import 'https://tracker.example/style.css'",
      "width: expression(alert(1))",
      "behavior: url(#default#time2)",
      "-moz-binding: url(http://example.com/xbl.xml#x)",
      "background: javascript:alert(1)",
      "background: u\\72l(https://tracker.example/pixel.png)",
      "background: url('https://tracker.example/pixel.png'",
      "background: url(data:image/png;base64,AAAA); mask: url('https://tracker.example/x'",
    ]) {
      expect(containsUnsafeDocxCss(value), value).toBe(true);
    }
  });
});

function createBudgetRoot(elementCount: number, pageCount: number): ParentNode {
  return {
    querySelectorAll(selector: string) {
      return { length: selector === "*" ? elementCount : pageCount };
    },
  } as unknown as ParentNode;
}
