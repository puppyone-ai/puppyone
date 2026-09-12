// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  applyOfficeCjkFontFallbacks,
  ensureOfficeFontCompatibilityStyles,
  OFFICE_FONT_COMPATIBILITY_CSS,
} from "../../../../../packages/shared-ui/src/editor/viewers/office/officeFontCompatibility";

describe("local Office font compatibility", () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it("installs common Windows and Chinese aliases once", () => {
    ensureOfficeFontCompatibilityStyles(document);
    ensureOfficeFontCompatibilityStyles(document);

    expect(document.head.querySelectorAll("[data-office-font-compatibility]")).toHaveLength(1);
    expect(OFFICE_FONT_COMPATIBILITY_CSS).toContain('font-family: "黑体"');
    expect(OFFICE_FONT_COMPATIBILITY_CSS).toContain('local("Heiti SC")');
    expect(OFFICE_FONT_COMPATIBILITY_CSS).toContain('font-family: "Microsoft YaHei"');
    expect(OFFICE_FONT_COMPATIBILITY_CSS).toContain('font-family: "宋体"');
    expect(OFFICE_FONT_COMPATIBILITY_CSS).toContain('font-family: "Microsoft JhengHei"');
    expect(OFFICE_FONT_COMPATIBILITY_CSS).toContain('font-family: "Meiryo"');
    expect(OFFICE_FONT_COMPATIBILITY_CSS).toContain('font-family: "Malgun Gothic"');
    expect(OFFICE_FONT_COMPATIBILITY_CSS).toContain('font-family: "Aptos"');
  });

  it("keeps the authored font first and only appends a CJK fallback when needed", () => {
    const slide = document.createElement("div");
    slide.innerHTML = `
      <span id="cjk" style="font-family: 'Times New Roman'; font-size: 30px">黑体标题</span>
      <span id="latin" style="font-family: 'Times New Roman'; font-size: 18px">Quarterly report</span>
      <span id="authored" style="font-family: '黑体'; font-size: 22px">原始黑体</span>
      <svg><text id="svg-cjk" font-family="Cambria">图表文字</text></svg>
      <span id="japanese" style="font-family: 'Times New Roman'">プレゼン資料</span>
      <span id="korean" style="font-family: 'Times New Roman'">발표 자료</span>
      <span id="traditional" lang="zh-Hant" style="font-family: 'Times New Roman'">簡報資料</span>
    `;

    expect(applyOfficeCjkFontFallbacks(slide)).toBe(5);
    expect(slide.querySelector<HTMLElement>("#cjk")?.style.fontFamily).toMatch(
      /^"Times New Roman", "PingFang SC"/,
    );
    expect(slide.querySelector<HTMLElement>("#cjk")?.style.fontSize).toBe("30px");
    expect(slide.querySelector<HTMLElement>("#latin")?.style.fontFamily).toBe('"Times New Roman"');
    expect(slide.querySelector<HTMLElement>("#authored")?.style.fontFamily).toBe("黑体");
    expect(slide.querySelector("#svg-cjk")?.getAttribute("font-family")).toMatch(
      /^Cambria, "PingFang SC"/,
    );
    expect(slide.querySelector<HTMLElement>("#japanese")?.style.fontFamily).toContain(
      '"Hiragino Sans"',
    );
    expect(slide.querySelector<HTMLElement>("#korean")?.style.fontFamily).toContain(
      '"Apple SD Gothic Neo"',
    );
    expect(slide.querySelector<HTMLElement>("#traditional")?.style.fontFamily).toContain(
      '"PingFang TC"',
    );
  });
});
