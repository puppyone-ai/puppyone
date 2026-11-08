import { describe, expect, it } from "vitest";
import {
  buildMarkdownImageSnippet,
  escapeMarkdownDestination,
  isDropImageName,
  relativeMarkdownDestination,
} from "../../../../../../src/shared-ui/editor/markdown/features/image/markdownImageDropSyntax";

describe("relativeMarkdownDestination", () => {
  it("returns a bare name for a sibling file", () => {
    expect(relativeMarkdownDestination("notes/a.md", "notes/p.png")).toBe("p.png");
  });
  it("climbs to a parent directory", () => {
    expect(relativeMarkdownDestination("notes/a.md", "assets/p.png")).toBe("../assets/p.png");
  });
  it("descends into a subdirectory", () => {
    expect(relativeMarkdownDestination("a.md", "img/p.png")).toBe("img/p.png");
  });
  it("returns null for a path outside the root", () => {
    expect(relativeMarkdownDestination("a.md", "../escape.png")).toBeNull();
  });
  it("resolves local resource identities within the same attached root", () => {
    expect(relativeMarkdownDestination(
      "puppyone-local://workspace/root/notes/a.md",
      "puppyone-local://workspace/root/assets/my%20photo%2523.png",
    )).toBe("../assets/my photo%23.png");
  });
  it("resolves Cloud paths within the full provider root", () => {
    const root = "puppyone-cloud://cloud.example/https/api/v1/owner/project/scope";
    expect(relativeMarkdownDestination(`${root}/notes/a.md`, `${root}/assets/p.png`, root))
      .toBe("../assets/p.png");
    expect(relativeMarkdownDestination(`${root}/a.md`, `${root}-other/p.png`, root)).toBeNull();
    expect(relativeMarkdownDestination(`${root}/a.md`, `${root}/p.png`)).toBeNull();
  });
  it("rejects references from another root or a mixed path namespace", () => {
    const document = "puppyone-local://workspace/root-a/a.md";
    expect(relativeMarkdownDestination(document, "puppyone-local://workspace/root-b/p.png")).toBeNull();
    expect(relativeMarkdownDestination(document, "assets/p.png")).toBeNull();
    expect(relativeMarkdownDestination("a.md", "file:///outside/p.png")).toBeNull();
  });
});

describe("escapeMarkdownDestination", () => {
  it("wraps destinations with spaces in angle brackets", () => {
    expect(escapeMarkdownDestination("my photo.png")).toBe("<my photo.png>");
  });
  it("wraps destinations with parentheses in angle brackets", () => {
    expect(escapeMarkdownDestination("a (1).png")).toBe("<a (1).png>");
  });
  it("percent-encodes fragment and query characters", () => {
    expect(escapeMarkdownDestination("a#b.png")).toBe("a%23b.png");
    expect(escapeMarkdownDestination("a?b.png")).toBe("a%3Fb.png");
  });
  it("preserves literal percent escapes and angle brackets in filenames", () => {
    expect(escapeMarkdownDestination("a%23.png")).toBe("a%2523.png");
    expect(escapeMarkdownDestination("a%ZZ.png")).toBe("a%25ZZ.png");
    expect(escapeMarkdownDestination("a<b>.png")).toBe("a%3Cb%3E.png");
  });
});

describe("buildMarkdownImageSnippet", () => {
  it("builds a standard image snippet", () => {
    expect(buildMarkdownImageSnippet("p.png", "p")).toBe("![p](p.png)");
  });
  it("drops whitespace from alt text", () => {
    expect(buildMarkdownImageSnippet("p.png", "my  photo\n")).toBe("![my photo](p.png)");
  });
});

describe("isDropImageName", () => {
  it("accepts common image extensions case-insensitively", () => {
    expect(isDropImageName("a.PNG")).toBe(true);
    expect(isDropImageName("a.webp")).toBe(true);
  });
  it("rejects non-images", () => {
    expect(isDropImageName("a.md")).toBe(false);
    expect(isDropImageName("a.pdf")).toBe(false);
  });
});
