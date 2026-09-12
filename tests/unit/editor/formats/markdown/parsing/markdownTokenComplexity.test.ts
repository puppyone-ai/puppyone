/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { findMarkdownImageTokens } from "../../../../../../packages/shared-ui/src/editor/markdown/features/image/markdownImageModel";
import { findMarkdownLinkTokens } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkModel";
import { findWikiLinkTokens } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/wikiLinkModel";
import {
  createMarkdownInlineFragment,
  MARKDOWN_INLINE_RICH_SOURCE_MAX_CHARS,
} from "../../../../../../packages/shared-ui/src/editor/markdown/composition/preview/markdownInlineRenderer";

describe("Markdown inline complexity bounds", () => {
  it("skips an already-inspected malformed link line instead of rescanning each opener", () => {
    const source = `${"[".repeat(100_000)}\n[valid](note.md)`;

    expect(findMarkdownLinkTokens(source)).toMatchObject([
      { label: "valid", href: "note.md" },
    ]);
  });

  it("keeps image and wiki scans bounded across malformed physical lines", () => {
    const malformedImages = `${"![".repeat(50_000)}\n![valid](image.png)`;
    const malformedWikiLinks = `${"[[".repeat(50_000)}\n[[Valid note]]`;

    expect(findMarkdownImageTokens(malformedImages)).toMatchObject([
      { alt: "valid", href: "image.png" },
    ]);
    expect(findWikiLinkTokens(malformedWikiLinks)).toMatchObject([
      { target: "Valid note" },
    ]);
  });

  it("degrades over-budget isolated inline previews to exact plain text", () => {
    const source = `[${"*".repeat(MARKDOWN_INLINE_RICH_SOURCE_MAX_CHARS)}](note.md)`;
    const fragment = createMarkdownInlineFragment(source);

    expect(fragment.textContent).toBe(source);
    expect(fragment.childNodes).toHaveLength(1);
    expect(fragment.firstChild).toBeInstanceOf(Text);
  });
});
