import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  openKnowledgeMdxFeatureComposition,
  puppyGfmFeatureComposition,
  getMarkdownFeatureComposition,
} from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";
import {
  DEFAULT_MARKDOWN_DIALECT,
  markdownDialectFacet,
  resolveMarkdownDialect,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/dialect/markdownDialect";
import { markdownFeatureCompositionFacet } from "../../../../../../packages/shared-ui/src/editor/markdown/core/features/markdownFeatureContract";
import { markdownCodeMirrorLanguageExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";

describe("Markdown dialect resolution", () => {
  it("uses explicit Host metadata before the file extension", () => {
    expect(resolveMarkdownDialect({
      documentPath: "notes/example.md",
      explicitDialect: "openknowledge-mdx",
    })).toEqual({ dialect: "openknowledge-mdx", source: "explicit" });
    expect(resolveMarkdownDialect({
      documentPath: "notes/example.mdx",
      explicitDialect: "puppy-gfm",
    })).toEqual({ dialect: "puppy-gfm", source: "explicit" });
  });

  it("uses .mdx as an explicit extension signal and keeps ordinary .md conservative", () => {
    expect(resolveMarkdownDialect({ documentPath: "notes/example.mdx" }))
      .toEqual({ dialect: "openknowledge-mdx", source: "extension" });
    expect(resolveMarkdownDialect({ documentPath: "notes/example.MDX?revision=2" }))
      .toEqual({ dialect: "openknowledge-mdx", source: "extension" });
    expect(resolveMarkdownDialect({ documentPath: "notes/example.md" }))
      .toEqual({ dialect: DEFAULT_MARKDOWN_DIALECT, source: "fallback" });
  });

  it("ignores invalid Host metadata and still honors an explicit .mdx extension", () => {
    expect(resolveMarkdownDialect({
      documentPath: "notes/example.mdx#section",
      explicitDialect: "unknown-dialect",
    })).toEqual({ dialect: "openknowledge-mdx", source: "extension" });
    expect(resolveMarkdownDialect({
      documentPath: "notes/example.md",
      explicitDialect: "unknown-dialect",
    })).toEqual({ dialect: "puppy-gfm", source: "fallback" });
  });

  it("does not infer a dialect from document contents", () => {
    expect(resolveMarkdownDialect({
      documentPath: "notes/<Tabs><Tab label='x'>.md",
      explicitDialect: null,
    }).dialect).toBe("puppy-gfm");
  });

  it("selects one immutable composition for the whole document", () => {
    expect(getMarkdownFeatureComposition("puppy-gfm")).toBe(puppyGfmFeatureComposition);
    expect(getMarkdownFeatureComposition("openknowledge-mdx")).toBe(openKnowledgeMdxFeatureComposition);
  });

  it.each([
    ["puppy-gfm", puppyGfmFeatureComposition],
    ["openknowledge-mdx", openKnowledgeMdxFeatureComposition],
  ] as const)("installs matching %s parser and semantic facets atomically", (dialect, composition) => {
    const state = EditorState.create({
      doc: "content",
      extensions: [markdownCodeMirrorLanguageExtension(dialect)],
    });

    expect(state.facet(markdownDialectFacet)).toBe(dialect);
    expect(state.facet(markdownFeatureCompositionFacet)).toBe(composition);
  });
});
