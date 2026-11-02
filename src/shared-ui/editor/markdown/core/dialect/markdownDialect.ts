import { Facet } from "@codemirror/state";
import type { MarkdownDialectId } from "../../../registry/viewerTypes";

export const DEFAULT_MARKDOWN_DIALECT: MarkdownDialectId = "puppy-gfm";

export type MarkdownDialectResolution = Readonly<{
  dialect: MarkdownDialectId;
  source: "explicit" | "extension" | "fallback";
}>;

export function resolveMarkdownDialect({
  documentPath,
  explicitDialect,
}: {
  documentPath: string;
  explicitDialect?: MarkdownDialectId | string | null;
}): MarkdownDialectResolution {
  if (isMarkdownDialectId(explicitDialect)) {
    return { dialect: explicitDialect, source: "explicit" };
  }

  const normalizedPath = documentPath.trim().toLowerCase().split(/[?#]/, 1)[0] ?? "";
  if (normalizedPath.endsWith(".mdx")) {
    return { dialect: "openknowledge-mdx", source: "extension" };
  }

  return { dialect: DEFAULT_MARKDOWN_DIALECT, source: "fallback" };
}

export function isMarkdownDialectId(value: unknown): value is MarkdownDialectId {
  return value === "puppy-gfm" || value === "openknowledge-mdx";
}

/** CodeMirror-scoped dialect identity for parser, projection, and derived views. */
export const markdownDialectFacet = Facet.define<MarkdownDialectId, MarkdownDialectId>({
  combine(values) {
    return values[values.length - 1] ?? DEFAULT_MARKDOWN_DIALECT;
  },
});

