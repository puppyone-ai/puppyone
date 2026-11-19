const OFFICE_FONT_STYLE_ID = "puppyone-office-font-compatibility";

const CJK_TEXT_PATTERN = /[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/u;
const JAPANESE_TEXT_PATTERN = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const KOREAN_TEXT_PATTERN = /[\uac00-\ud7af]/u;
const JAPANESE_FONT_PATTERN = /meiryo|yu\s+(?:gothic|mincho)|ms\s+p?(?:gothic|mincho)|hiragino|游ゴシック|游明朝|メイリオ/i;
const KOREAN_FONT_PATTERN = /malgun|batang|gulim|dotum|apple\s+sd\s+gothic|applemyungjo|맑은\s*고딕|바탕|굴림|돋움/i;
const TRADITIONAL_CHINESE_FONT_PATTERN = /jhenghei|mingliu|dfkai|pingfang\s+tc|songti\s+tc|kaiti\s+tc|微軟正黑體|新細明體|細明體|標楷體/i;
const CJK_COMPATIBLE_FONT_PATTERN = /pingfang|heiti|songti|kaiti|fangsong|yahei|dengxian|simhei|simsun|nsimsun|jhenghei|mingliu|dfkai|meiryo|yu\s+(?:gothic|mincho)|ms\s+p?(?:gothic|mincho)|hiragino|malgun|batang|gulim|dotum|apple\s+sd\s+gothic|applemyungjo|黑体|宋体|新宋体|楷体|仿宋|等线|微软雅黑|微軟正黑體|新細明體|細明體|標楷體|noto\s+(?:sans|serif)\s+cjk|source\s+han|arial\s+unicode/i;
const SIMPLIFIED_CHINESE_FALLBACK_STACK = [
  '"PingFang SC"',
  '"Heiti SC"',
  '"Microsoft YaHei"',
  '"Noto Sans CJK SC"',
  '"Arial Unicode MS"',
  "sans-serif",
].join(", ");
const TRADITIONAL_CHINESE_FALLBACK_STACK = [
  '"PingFang TC"',
  '"Heiti TC"',
  '"Microsoft JhengHei"',
  '"Noto Sans CJK TC"',
  '"Arial Unicode MS"',
  "sans-serif",
].join(", ");
const JAPANESE_FALLBACK_STACK = [
  '"Hiragino Sans"',
  '"Yu Gothic"',
  '"Meiryo"',
  '"Noto Sans CJK JP"',
  '"Arial Unicode MS"',
  "sans-serif",
].join(", ");
const KOREAN_FALLBACK_STACK = [
  '"Apple SD Gothic Neo"',
  '"Malgun Gothic"',
  '"Noto Sans CJK KR"',
  '"Arial Unicode MS"',
  "sans-serif",
].join(", ");

/**
 * Local aliases for common Windows Office fonts. They only participate when a
 * document asks for the matching family, so source typography remains in
 * control whenever the authored font is available.
 */
export const OFFICE_FONT_COMPATIBILITY_CSS = `
  @font-face {
    font-family: "宋体";
    src: local("Songti SC"), local("STSong"), local("Noto Serif CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "SimSun";
    src: local("Songti SC"), local("STSong"), local("Noto Serif CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "新宋体";
    src: local("Songti SC"), local("STSong"), local("Noto Serif CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "NSimSun";
    src: local("Songti SC"), local("STSong"), local("Noto Serif CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "黑体";
    src: local("Heiti SC"), local("STHeiti"), local("PingFang SC"), local("Noto Sans CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "SimHei";
    src: local("Heiti SC"), local("STHeiti"), local("PingFang SC"), local("Noto Sans CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "等线";
    src: local("PingFang SC"), local("Microsoft YaHei"), local("Noto Sans CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "DengXian";
    src: local("PingFang SC"), local("Microsoft YaHei"), local("Noto Sans CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "微软雅黑";
    src: local("PingFang SC"), local("Microsoft YaHei"), local("Noto Sans CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "Microsoft YaHei";
    src: local("PingFang SC"), local("Microsoft YaHei"), local("Noto Sans CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "Microsoft JhengHei";
    src: local("PingFang TC"), local("Heiti TC"), local("Noto Sans CJK TC");
    font-display: swap;
  }

  @font-face {
    font-family: "微軟正黑體";
    src: local("PingFang TC"), local("Heiti TC"), local("Noto Sans CJK TC");
    font-display: swap;
  }

  @font-face {
    font-family: "PMingLiU";
    src: local("Songti TC"), local("STSongti-TC-Regular"), local("Noto Serif CJK TC");
    font-display: swap;
  }

  @font-face {
    font-family: "MingLiU";
    src: local("Songti TC"), local("STSongti-TC-Regular"), local("Noto Serif CJK TC");
    font-display: swap;
  }

  @font-face {
    font-family: "新細明體";
    src: local("Songti TC"), local("STSongti-TC-Regular"), local("Noto Serif CJK TC");
    font-display: swap;
  }

  @font-face {
    font-family: "細明體";
    src: local("Songti TC"), local("STSongti-TC-Regular"), local("Noto Serif CJK TC");
    font-display: swap;
  }

  @font-face {
    font-family: "DFKai-SB";
    src: local("Kaiti TC"), local("STKaiti-TC-Regular"), local("Noto Serif CJK TC");
    font-display: swap;
  }

  @font-face {
    font-family: "標楷體";
    src: local("Kaiti TC"), local("STKaiti-TC-Regular"), local("Noto Serif CJK TC");
    font-display: swap;
  }

  @font-face {
    font-family: "Meiryo";
    src: local("Hiragino Sans"), local("Yu Gothic"), local("Noto Sans CJK JP");
    font-display: swap;
  }

  @font-face {
    font-family: "MS Gothic";
    src: local("Hiragino Sans"), local("Yu Gothic"), local("Noto Sans CJK JP");
    font-display: swap;
  }

  @font-face {
    font-family: "MS Mincho";
    src: local("Hiragino Mincho ProN"), local("Yu Mincho"), local("Noto Serif CJK JP");
    font-display: swap;
  }

  @font-face {
    font-family: "Yu Gothic";
    src: local("YuGothic"), local("Hiragino Sans"), local("Noto Sans CJK JP");
    font-display: swap;
  }

  @font-face {
    font-family: "Yu Mincho";
    src: local("YuMincho"), local("Hiragino Mincho ProN"), local("Noto Serif CJK JP");
    font-display: swap;
  }

  @font-face {
    font-family: "Malgun Gothic";
    src: local("Apple SD Gothic Neo"), local("Noto Sans CJK KR");
    font-display: swap;
  }

  @font-face {
    font-family: "Gulim";
    src: local("Apple SD Gothic Neo"), local("Noto Sans CJK KR");
    font-display: swap;
  }

  @font-face {
    font-family: "Dotum";
    src: local("Apple SD Gothic Neo"), local("Noto Sans CJK KR");
    font-display: swap;
  }

  @font-face {
    font-family: "Batang";
    src: local("AppleMyungjo"), local("Noto Serif CJK KR");
    font-display: swap;
  }

  @font-face {
    font-family: "仿宋";
    src: local("STFangsong"), local("FangSong"), local("Noto Serif CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "FangSong";
    src: local("STFangsong"), local("FangSong"), local("Noto Serif CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "楷体";
    src: local("Kaiti SC"), local("STKaiti"), local("KaiTi"), local("Noto Serif CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "KaiTi";
    src: local("Kaiti SC"), local("STKaiti"), local("KaiTi"), local("Noto Serif CJK SC");
    font-display: swap;
  }

  @font-face {
    font-family: "Calibri";
    src: local("Aptos"), local("Calibri"), local("Arial");
    font-display: swap;
  }

  @font-face {
    font-family: "Aptos";
    src: local("Aptos"), local("Calibri"), local("Arial");
    font-display: swap;
  }

  @font-face {
    font-family: "Aptos Display";
    src: local("Aptos Display"), local("Avenir Next"), local("Arial");
    font-display: swap;
  }

  @font-face {
    font-family: "Cambria";
    src: local("Cambria"), local("Georgia"), local("Times New Roman");
    font-display: swap;
  }
`;

export function ensureOfficeFontCompatibilityStyles(targetDocument: Document): void {
  if (targetDocument.getElementById(OFFICE_FONT_STYLE_ID)) return;

  const style = targetDocument.createElement("style");
  style.id = OFFICE_FONT_STYLE_ID;
  style.dataset.officeFontCompatibility = "true";
  style.textContent = OFFICE_FONT_COMPATIBILITY_CSS;
  targetDocument.head.append(style);
}

function getEastAsianFallbackStack(
  text: string,
  declaredFamily: string,
  language: string,
): string {
  if (language.startsWith("ko") || KOREAN_TEXT_PATTERN.test(text) || KOREAN_FONT_PATTERN.test(declaredFamily)) {
    return KOREAN_FALLBACK_STACK;
  }
  if (language.startsWith("ja") || JAPANESE_TEXT_PATTERN.test(text) || JAPANESE_FONT_PATTERN.test(declaredFamily)) {
    return JAPANESE_FALLBACK_STACK;
  }
  if (
    language.startsWith("zh-hant")
    || language.startsWith("zh-tw")
    || language.startsWith("zh-hk")
    || TRADITIONAL_CHINESE_FONT_PATTERN.test(declaredFamily)
  ) {
    return TRADITIONAL_CHINESE_FALLBACK_STACK;
  }
  return SIMPLIFIED_CHINESE_FALLBACK_STACK;
}

/**
 * The PPTX renderer preserves declared font stacks. Some Office files keep the
 * East Asian family only in theme metadata, though, and a run can reach the DOM
 * as Times New Roman alone. Append a local CJK fallback to those runs without
 * replacing the authored family, size, weight, or spacing.
 */
export function applyOfficeCjkFontFallbacks(root: ParentNode): number {
  const selector = "[style], [font-family]";
  const candidates: Array<HTMLElement | SVGElement> = [
    ...(root instanceof Element && root.matches(selector) ? [root as HTMLElement | SVGElement] : []),
    ...root.querySelectorAll<HTMLElement | SVGElement>(selector),
  ];
  let updatedCount = 0;

  for (const element of candidates) {
    const text = element.textContent ?? "";
    if (!CJK_TEXT_PATTERN.test(text)) continue;

    const inlineFamily = element.style.fontFamily.trim();
    const attributeFamily = element.getAttribute("font-family")?.trim() ?? "";
    const declaredFamily = inlineFamily || attributeFamily;
    if (!declaredFamily || CJK_COMPATIBLE_FONT_PATTERN.test(declaredFamily)) continue;

    const language = element.closest("[lang]")?.getAttribute("lang")?.toLowerCase() ?? "";
    const compatibleFamily = `${declaredFamily}, ${getEastAsianFallbackStack(
      text,
      declaredFamily,
      language,
    )}`;
    if (inlineFamily) {
      const priority = element.style.getPropertyPriority("font-family");
      element.style.setProperty("font-family", compatibleFamily, priority);
    } else {
      element.setAttribute("font-family", compatibleFamily);
    }
    updatedCount += 1;
  }

  return updatedCount;
}
