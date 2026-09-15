import { describe, expect, it } from "vitest";
import {
  normalizeContentLanguage,
  resolveMarkdownContentLanguage,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/presentation/markdownContentLanguage";

describe("Markdown content language", () => {
  it("detects a Chinese document independently from the interface locale", () => {
    expect(resolveMarkdownContentLanguage(
      "# 计划\n\n- 用户访谈集齐十个\n- 修复编辑器问题",
      "en-US",
    )).toEqual({ language: "zh-Hans", source: "document" });

    expect(resolveMarkdownContentLanguage(
      "# 計畫\n\n- 使用者訪談集齊十個\n- 修復編輯器問題",
      "en-US",
    )).toEqual({ language: "zh-Hant", source: "document" });
  });

  it("prefers kana and hangul signals before the shared Han script", () => {
    expect(resolveMarkdownContentLanguage("設計資料を更新する", "zh-CN").language).toBe("ja");
    expect(resolveMarkdownContentLanguage("문서 설계를 업데이트합니다", "en").language).toBe("ko");
  });

  it("keeps explicit metadata authoritative and normalizes locale variants", () => {
    expect(resolveMarkdownContentLanguage("简体内容", "en", "zh_TW")).toEqual({
      language: "zh-Hant",
      source: "explicit",
    });
    expect(normalizeContentLanguage("zh-CN")).toBe("zh-Hans");
    expect(normalizeContentLanguage("en-US")).toBe("en-US");
  });

  it("falls back to the interface language when the document has no script signal", () => {
    expect(resolveMarkdownContentLanguage("# Release notes", "en-US")).toEqual({
      language: "en-US",
      source: "interface",
    });
  });
});
