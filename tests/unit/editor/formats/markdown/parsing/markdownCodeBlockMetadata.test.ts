import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  formatMarkdownCodeSourceReference,
  getMarkdownCodeBlock,
  inferCodeLanguageFromPath,
  parseMarkdownCodeFenceInfo,
  serializeMarkdownCodeBlock,
} from "../../../../../../packages/shared-ui/src/editor/markdown/features/code-block/codeBlockModel";

describe("Markdown code-fence metadata", () => {
  it("recognizes legacy line-range filenames and infers the language", () => {
    const state = EditorState.create({
      doc: "```83:99:package.json\n{\"private\": true}\n```",
    });

    expect(getMarkdownCodeBlock(state, 1)).toMatchObject({
      language: "json",
      sourceReference: {
        path: "package.json",
        startLine: 83,
        endLine: 99,
      },
      code: '{"private": true}',
    });
  });

  it("parses structured source metadata with quoted paths", () => {
    expect(parseMarkdownCodeFenceInfo(
      'typescript file="src/components/My View.tsx" lines="12-18"',
    )).toEqual({
      language: "typescript",
      sourceReference: {
        path: "src/components/My View.tsx",
        startLine: 12,
        endLine: 18,
      },
    });
  });

  it("infers a language when structured metadata omits it", () => {
    expect(parseMarkdownCodeFenceInfo('file="scripts/release.py" lines="4"')).toEqual({
      language: "python",
      sourceReference: {
        path: "scripts/release.py",
        startLine: 4,
        endLine: 4,
      },
    });
  });

  it("keeps ordinary language-only fences free of source metadata", () => {
    expect(parseMarkdownCodeFenceInfo("tsx")).toEqual({
      language: "tsx",
      sourceReference: null,
    });
  });

  it("serializes source metadata with a standard language as the first token", () => {
    expect(serializeMarkdownCodeBlock("json", '{"private": true}', {
      sourceReference: {
        path: "package.json",
        startLine: 83,
        endLine: 99,
      },
    })).toBe([
      '```json file="package.json" lines="83-99"',
      '{"private": true}',
      "```",
    ].join("\n"));
  });

  it("round-trips paths that require a tilde fence", () => {
    const serialized = serializeMarkdownCodeBlock("typescript", "const ok = true;", {
      sourceReference: {
        path: "src/odd`name.ts",
        startLine: 7,
        endLine: 9,
      },
    });
    const state = EditorState.create({ doc: serialized });

    expect(serialized.startsWith('~~~typescript file="src/odd`name.ts"')).toBe(true);
    expect(getMarkdownCodeBlock(state, 1)?.sourceReference).toEqual({
      path: "src/odd`name.ts",
      startLine: 7,
      endLine: 9,
    });
  });

  it("formats source labels compactly and maps common extensions", () => {
    expect(formatMarkdownCodeSourceReference({
      path: "backend/src/config.py",
      startLine: 206,
      endLine: 212,
    })).toBe("backend/src/config.py · L206–212");
    expect(inferCodeLanguageFromPath("src/main.mts")).toBe("typescript");
    expect(inferCodeLanguageFromPath("Dockerfile")).toBe("dockerfile");
  });
});
