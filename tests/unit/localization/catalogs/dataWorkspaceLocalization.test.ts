import { describe, expect, it } from "vitest";
import { createMessageFormatter } from "@puppyone/localization/core";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import simplifiedChineseCatalog from "../../../../src/localization/catalog-loaders/zh-Hans";
import {
  defaultCreateName,
  getCreateEntryInitialContent,
  getDesktopFileTypeOptions,
  normalizeCreateEntryName,
  toDesktopNodeActionError,
} from "../../../../src/features/data-workspace/nodeActions";
import {
  formatFileOperationNotice,
  type FileOperationNotice,
} from "../../../../src/features/data-workspace/useFileClipboard";
import { DEFAULT_EXPERIMENTAL_SETTINGS } from "../../../../src/preferences";

const english = createMessageFormatter({
  locale: "en",
  catalog: englishCatalog,
  fallbackCatalog: englishCatalog,
});
const simplifiedChinese = createMessageFormatter({
  locale: "zh-Hans",
  catalog: simplifiedChineseCatalog,
  fallbackCatalog: englishCatalog,
});

describe("data workspace localization boundaries", () => {
  it("formats the same semantic clipboard notice in the active locale", () => {
    const notice: FileOperationNotice = {
      tone: "info",
      code: "completed",
      mode: "copy",
      count: 2,
      targetFolderPath: "projects/docs",
    };

    expect(formatFileOperationNotice(notice, english)).toBe("Copied 2 items to ⁨docs⁩.");
    expect(formatFileOperationNotice(notice, simplifiedChinese)).toBe("已将 2 个项目复制到 ⁨docs⁩。");
  });

  it("keeps operation failures semantic until they reach the presentation layer", () => {
    expect(toDesktopNodeActionError(new Error("disk full"))).toEqual({
      code: "operation-failed",
      detail: "disk full",
    });

    let invalidNameError: unknown;
    try {
      normalizeCreateEntryName("folder", "../archive");
    } catch (error) {
      invalidNameError = error;
    }
    expect(toDesktopNodeActionError(invalidNameError)).toEqual({ code: "name-invalid" });
  });

  it("localizes generated names and templates without translating stable file syntax", () => {
    expect(defaultCreateName("folder", english)).toBe("Untitled Folder");
    expect(defaultCreateName("folder", simplifiedChinese)).toBe("未命名文件夹");

    expect(normalizeCreateEntryName("markdown", "Notes")).toBe("Notes.md");
    expect(normalizeCreateEntryName("contextMap", "Knowledge")).toBe("Knowledge.contextmap");
    expect(normalizeCreateEntryName("csv", "Data")).toBe("Data.csv");
    expect(normalizeCreateEntryName("csv", "Data.tsv")).toBe("Data.tsv");

    expect(getCreateEntryInitialContent("csv", {
      csvHeaders: ["第 1 列", "第 2 列", "第 3 列"],
      puppyFlow: { title: "未命名流程", prompts: ["分析", "应用"] },
    })).toBe("第 1 列,第 2 列,第 3 列\n,,\n,,\n");
    expect(getCreateEntryInitialContent("contextMap", {
      csvHeaders: ["A", "B", "C"],
      puppyFlow: { title: "Flow", prompts: ["Analyze", "Apply"] },
    })).toContain('"scope": "."');
  });

  it("localizes known and previously unseen file type labels", () => {
    const englishOptions = getDesktopFileTypeOptions(".custom", english);
    const chineseOptions = getDesktopFileTypeOptions(".custom", simplifiedChinese);

    expect(englishOptions.find(({ extension }) => extension === ".custom")?.label)
      .toBe("Current type (⁨.custom⁩)");
    expect(chineseOptions.find(({ extension }) => extension === ".custom")?.label)
      .toBe("当前类型（⁨.custom⁩）");
    expect(chineseOptions.find(({ extension }) => extension === ".txt")?.label)
      .toBe("文本 (.txt)");
    expect(getDesktopFileTypeOptions(
      ".contextmap",
      english,
      DEFAULT_EXPERIMENTAL_SETTINGS,
    ).find(({ extension }) => extension === ".contextmap")?.label)
      .toBe("Context Map (.contextmap)");
  });
});
