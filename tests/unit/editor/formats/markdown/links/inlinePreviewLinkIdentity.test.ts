import { describe, expect, it } from "vitest";
import { getInlinePreviewLinkIdentity } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/inlinePreviewLinkIdentity";
import { createMarkdownLinkGraph } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkGraph";

const graph = (paths: string[], revision: number) => createMarkdownLinkGraph(
  paths.map((path) => ({ path, name: path.split("/").at(-1)! })), undefined, revision,
);
const key = (sources: string[], paths: string[], revision: number, documentPath = "note.md") => (
  getInlinePreviewLinkIdentity(sources, graph(paths, revision), documentPath)
);

describe("isolated inline preview link dependencies", () => {
  it("ignores unrelated files for plain text, line breaks and ordinary anchors", () => {
    const sources = ["plain text", "line<br />break", "[link](target.md)"];
    expect(key(sources, [], 1)).toBe(key(sources, ["folder/new.md"], 2));
  });

  it("retains resolved wiki links and wiki media when only unrelated files change", () => {
    const sources = ["[[target#heading|label]]", "![[picture.png|100]]"];
    expect(key(sources, ["target.md", "picture.png"], 1))
      .toBe(key(sources, ["target.md", "picture.png", "unrelated.md"], 2));
  });

  it("invalidates when a missing wiki target appears or disappears", () => {
    expect(key(["[[target]]"], [], 1)).not.toBe(key(["[[target]]"], ["target.md"], 2));
  });

  it("invalidates when a target becomes ambiguous", () => {
    expect(key(["[[target]]"], ["one/target.md"], 1))
      .not.toBe(key(["[[target]]"], ["one/target.md", "two/target.md"], 2));
  });

  it("considers fragments outside the currently mounted viewport", () => {
    const sources = ["visible row", "other row", "[[target]]"];
    expect(key(sources, [], 1)).not.toBe(key(sources, ["target.md"], 2));
  });

  it("resolves dependencies in the owning document's directory", () => {
    const paths = ["one/target.md", "two/target.md"];
    expect(key(["[[target]]"], paths, 1, "one/note.md"))
      .not.toBe(key(["[[target]]"], paths, 1, "two/note.md"));
  });

  it("ignores escaped wiki syntax", () => {
    expect(key([String.raw`\[[target]]`], [], 1))
      .toBe(key([String.raw`\[[target]]`], ["target.md"], 2));
  });

  it("conservatively refreshes HTML with entity-decoded link candidates", () => {
    const sources = ["<span>&#91;&#91;target&#93;&#93;</span>"];
    expect(key(sources, [], 1)).not.toBe(key(sources, ["target.md"], 2));
  });
});
