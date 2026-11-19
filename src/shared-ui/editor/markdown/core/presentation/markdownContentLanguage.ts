export type MarkdownContentLanguageSource = "explicit" | "document" | "interface";

export type MarkdownContentLanguageResolution = {
  language: string;
  source: MarkdownContentLanguageSource;
};

const DOCUMENT_LANGUAGE_SAMPLE_LIMIT = 12_000;
const MIN_SCRIPT_SIGNAL = 2;
const HAN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const KANA_PATTERN = /[\u3040-\u30ff\u31f0-\u31ff]/g;
const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g;

// These are high-signal pairs, not a language dictionary. Explicit document
// metadata remains authoritative; this heuristic only chooses the macOS/
// Windows CJK fallback when a Markdown file has no language metadata.
const SIMPLIFIED_HAN = new Set("体国学会发为个们后里台湾与点来说开关问题实际应该还让从么过齐户谈".split(""));
const TRADITIONAL_HAN = new Set("體國學會發為個們後裡臺灣與點來說開關問題實際應該還讓從麼過齊戶談".split(""));

export function resolveMarkdownContentLanguage(
  content: string,
  interfaceLocale: string,
  explicitLanguage?: string | null,
): MarkdownContentLanguageResolution {
  if (explicitLanguage?.trim()) {
    return {
      language: normalizeContentLanguage(explicitLanguage),
      source: "explicit",
    };
  }

  const sample = content.slice(0, DOCUMENT_LANGUAGE_SAMPLE_LIMIT);
  const kanaCount = countMatches(sample, KANA_PATTERN);
  if (kanaCount >= MIN_SCRIPT_SIGNAL) return { language: "ja", source: "document" };

  const hangulCount = countMatches(sample, HANGUL_PATTERN);
  if (hangulCount >= MIN_SCRIPT_SIGNAL) return { language: "ko", source: "document" };

  const hanCount = countMatches(sample, HAN_PATTERN);
  if (hanCount >= MIN_SCRIPT_SIGNAL) {
    const variant = inferHanVariant(sample, interfaceLocale);
    return { language: variant, source: "document" };
  }

  return {
    language: normalizeContentLanguage(interfaceLocale),
    source: "interface",
  };
}

export function normalizeContentLanguage(locale: string) {
  const normalized = locale.trim().replaceAll("_", "-");
  const lower = normalized.toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-")) {
    return lower.includes("hant") || /-(tw|hk|mo)(?:-|$)/.test(lower)
      ? "zh-Hant"
      : "zh-Hans";
  }
  if (lower === "ja" || lower.startsWith("ja-")) return "ja";
  if (lower === "ko" || lower.startsWith("ko-")) return "ko";
  return normalized || "en";
}

function inferHanVariant(sample: string, interfaceLocale: string) {
  let simplified = 0;
  let traditional = 0;
  for (const character of sample) {
    if (SIMPLIFIED_HAN.has(character)) simplified += 1;
    if (TRADITIONAL_HAN.has(character)) traditional += 1;
  }
  if (traditional > simplified) return "zh-Hant";
  if (simplified > traditional) return "zh-Hans";
  return normalizeContentLanguage(interfaceLocale) === "zh-Hant" ? "zh-Hant" : "zh-Hans";
}

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}
