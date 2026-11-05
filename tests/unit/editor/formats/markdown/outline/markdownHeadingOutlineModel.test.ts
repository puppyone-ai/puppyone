import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  buildMarkdownOutlineTree,
  collectMarkdownHeadingOutlineEntries,
} from "../../../../../../src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline";

const stateOf = (doc: string) => EditorState.create({ doc });

describe("collectMarkdownHeadingOutlineEntries", () => {
  it("strips inline markdown from plainTitle but keeps raw title", () => {
    const [heading] = collectMarkdownHeadingOutlineEntries(stateOf("## 用 **粗体** 和 `代码`\n"));
    expect(heading.plainTitle).toBe("用 粗体 和 代码");
    expect(heading.title).toBe("用 **粗体** 和 `代码`");
  });

  it("ignores # inside fenced code blocks", () => {
    const headings = collectMarkdownHeadingOutlineEntries(
      stateOf("```bash\n# 注释\n```\n## 真标题\n"),
    );
    expect(headings.map((h) => h.title)).toEqual(["真标题"]);
  });

  it("recognizes setext headings", () => {
    const headings = collectMarkdownHeadingOutlineEntries(stateOf("标题一\n=====\n\n标题二\n-----\n"));
    expect(headings).toEqual([
      expect.objectContaining({ level: 1, title: "标题一" }),
      expect.objectContaining({ level: 2, title: "标题二" }),
    ]);
  });

  it("keeps every duplicate heading as a distinct entry", () => {
    const headings = collectMarkdownHeadingOutlineEntries(stateOf("## 背景\n\n## 背景\n"));
    expect(headings).toHaveLength(2);
    expect(headings[0].from).not.toBe(headings[1].from);
  });
});

describe("buildMarkdownOutlineTree", () => {
  it("nests headings by level and tolerates skipped levels", () => {
    const headings = collectMarkdownHeadingOutlineEntries(
      stateOf("# A\n## B\n#### D\n## C\n# E\n"),
    );
    const tree = buildMarkdownOutlineTree(headings);
    expect(tree.map((node) => node.heading.title)).toEqual(["A", "E"]);
    expect(tree[0].children.map((node) => node.heading.title)).toEqual(["B", "C"]);
    expect(tree[0].children[0].children.map((node) => node.heading.title)).toEqual(["D"]);
  });
});
