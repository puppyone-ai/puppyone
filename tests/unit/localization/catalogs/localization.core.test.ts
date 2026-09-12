import { describe, expect, it, vi } from "vitest";
import {
  APP_LOCALES,
  LOCALE_DESCRIPTORS,
  createLocaleFormatters,
  createMessageFormatter,
  resolveLocaleState,
  resolveSystemLocale,
  type LocaleCatalog,
} from "@puppyone/localization/core";
import { createPseudoCatalog } from "@puppyone/localization/testing";

describe("desktop locale resolution", () => {
  it("keeps the generated locale contract aligned with the manifest", () => {
    expect(LOCALE_DESCRIPTORS.map(({ locale }) => locale)).toEqual([...APP_LOCALES]);
    expect(LOCALE_DESCRIPTORS).toHaveLength(8);
  });

  it.each([
    [["en-GB"], "en"],
    [["es-MX"], "es"],
    [["pt-PT"], "pt-BR"],
    [["fr-CA"], "fr"],
    [["de-AT"], "de"],
    [["ja-JP"], "ja"],
    [["ko-KR"], "ko"],
    [["zh-CN"], "zh-Hans"],
    [["zh-Hans-HK"], "zh-Hans"],
  ] as const)("matches %j to %s", (languages, expected) => {
    expect(resolveSystemLocale(languages)).toBe(expected);
  });

  it("does not silently map Traditional Chinese to Simplified Chinese", () => {
    expect(resolveSystemLocale(["zh-TW", "es-MX"])).toBe("es");
    expect(resolveSystemLocale(["zh-Hant", "zh-HK"])).toBe("en");
  });

  it("normalizes malformed values and derives direction from the manifest", () => {
    expect(resolveLocaleState("unsupported", ["not a locale", "fr-FR"])).toEqual({
      preference: "system",
      locale: "fr",
      direction: "ltr",
      systemLanguages: ["fr-FR"],
    });
  });
});

describe("localized message and value formatting", () => {
  const fallbackCatalog: LocaleCatalog = {
    "common.messageUnavailable": "Unavailable",
    "test.fallback": "English fallback",
  };

  it("uses the selected locale's CLDR plural categories", () => {
    const catalog: LocaleCatalog = {
      "common.messageUnavailable": "Indisponible",
      "test.count": "{count, plural, one {one} other {other}}",
    };
    const t = createMessageFormatter({ locale: "fr", catalog, fallbackCatalog });
    expect([0, 1, 2].map((count) => t("test.count", { count }))).toEqual([
      "one",
      "one",
      "other",
    ]);
  });

  it("falls back to English without exposing a message ID", () => {
    const onDiagnostic = vi.fn();
    const t = createMessageFormatter({
      locale: "de",
      catalog: { "common.messageUnavailable": "Nicht verfügbar" },
      fallbackCatalog,
      onDiagnostic,
    });
    expect(t("test.fallback")).toBe("English fallback");
    expect(t("test.missing")).toBe("Nicht verfügbar");
    expect(onDiagnostic).toHaveBeenCalledTimes(2);
  });

  it("formats and sorts with the selected locale explicitly", () => {
    const formatters = createLocaleFormatters("de");
    expect(formatters.formatNumber(1234.5)).toMatch(/1[.\u00a0]234,5/);
    expect(formatters.formatList(["A", "B"])).toBe("A und B");
    const values = ["z", "ä", "a"];
    values.sort(formatters.getCollator({ sensitivity: "base" }).compare);
    expect(values[0]).toBe("ä");
  });
});

describe("non-shipping pseudo locales", () => {
  const source: LocaleCatalog = {
    "common.messageUnavailable": "Unavailable",
    "test.project": "Open {project} in PuppyOne with {count, plural, one {# file} other {# files}}.",
  };

  it("expands only catalog literals while preserving ICU values and protected brands", () => {
    const catalog = createPseudoCatalog(source, "expanded-ltr");
    const t = createMessageFormatter({ locale: "en", catalog, fallbackCatalog: source });
    const output = t("test.project", { project: "工程 Alpha", count: 2 });

    expect(output).toContain("工程 Alpha");
    expect(output).toContain("PuppyOne");
    expect(output).toContain("ƒíïľéëš");
    expect(output).toMatch(/^⟦.*⟧$/u);
  });

  it("creates RTL-script product copy without rewriting inserted user data", () => {
    const catalog = createPseudoCatalog(source, "mirrored-rtl");
    const t = createMessageFormatter({ locale: "fr", catalog, fallbackCatalog: source });
    const output = t("test.project", { project: "Alpha/路径", count: 1 });

    expect(output).toContain("Alpha/路径");
    expect(output).toContain("PuppyOne");
    expect(output).toContain("فيله");
    expect(output.startsWith("\u2067⟦")).toBe(true);
    expect(output.endsWith("⟧\u2069")).toBe(true);
  });
});
