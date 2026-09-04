/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  applyTypographyToElement,
  resolveTypography,
  withTypographyScale,
} from "../src/features/typography";

describe("typography runtime boundary", () => {
  it("applies trusted primaries and categories without overriding product fallbacks", () => {
    const element = document.createElement("div");
    element.style.setProperty("--po-font-content", '"Legacy full stack"');
    const resolved = resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES);

    applyTypographyToElement(element, resolved);

    expect(element.dataset.fontUiCategory).toBe("sans");
    expect(element.dataset.fontContentCategory).toBe("sans");
    expect(element.dataset.fontCodeCategory).toBe("monospace");
    expect(element.dataset.fontTerminalCategory).toBe("monospace");
    expect(element.style.getPropertyValue("--po-font-content")).toBe("");
    expect(element.style.getPropertyValue("--po-font-content-primary")).toBe('"Geist Sans"');
    expect(element.style.getPropertyValue("--po-font-code-primary")).toBe('"Geist Mono"');
  });

  it("applies one coordinated preset to every semantic role on a surface", () => {
    const element = document.createElement("div");
    element.style.setProperty("--po-user-text-size-conversation", "20px");
    element.style.setProperty("--po-user-terminal-font-size", "20px");
    element.dataset.textSizeConversationMode = "explicit";
    const preferences = withTypographyScale(
      DEFAULT_TYPOGRAPHY_PREFERENCES,
      "rightSidebar",
      "large",
    );

    applyTypographyToElement(element, resolveTypography(preferences));

    expect(element.style.getPropertyValue("--po-user-left-sidebar-font-size")).toBe("14px");
    expect(element.style.getPropertyValue("--po-user-left-sidebar-meta-font-size")).toBe("12px");
    expect(element.style.getPropertyValue("--po-user-left-sidebar-line-height")).toBe("19px");
    expect(element.style.getPropertyValue("--po-user-header-font-size")).toBe("15px");
    expect(element.style.getPropertyValue("--po-user-header-line-height")).toBe("20px");
    expect(element.style.getPropertyValue("--po-user-header-meta-font-size")).toBe("13px");
    expect(element.style.getPropertyValue("--po-user-header-meta-line-height")).toBe("18px");
    expect(element.style.getPropertyValue("--po-user-text-size-conversation")).toBe("16px");
    expect(element.style.getPropertyValue("--po-user-right-sidebar-control-line-height")).toBe("21px");
    expect(element.style.getPropertyValue("--po-user-right-sidebar-meta-font-size")).toBe("14px");
    expect(element.style.getPropertyValue("--po-user-right-sidebar-meta-line-height")).toBe("20px");
    expect(element.style.getPropertyValue("--po-user-right-sidebar-caption-font-size")).toBe("13px");
    expect(element.style.getPropertyValue("--po-user-right-sidebar-caption-line-height")).toBe("18px");
    expect(element.style.getPropertyValue("--po-user-right-sidebar-micro-font-size")).toBe("12px");
    expect(element.style.getPropertyValue("--po-user-right-sidebar-micro-line-height")).toBe("16px");
    expect(element.style.getPropertyValue("--po-user-right-sidebar-code-font-size")).toBe("14px");
    expect(element.style.getPropertyValue("--po-user-terminal-font-size")).toBe("14px");
    expect(element.style.getPropertyValue("--po-user-right-sidebar-heading-1-font-size")).toBe("23px");
    expect(element.style.getPropertyValue("--po-user-right-sidebar-heading-2-font-size")).toBe("18px");
    expect(element.style.getPropertyValue("--po-user-text-size-content")).toBe("15px");
    expect(element.style.getPropertyValue("--po-user-editor-line-height")).toBe("24px");
    expect(element.style.getPropertyValue("--po-user-text-size-data")).toBe("13px");
    expect(element.style.getPropertyValue("--po-user-code-font-size")).toBe("13px");
    expect(element.style.getPropertyValue("--po-user-editor-heading-1-font-size")).toBe("30px");
    expect(element.style.getPropertyValue("--po-user-editor-heading-2-font-size")).toBe("23px");
    expect(element.style.getPropertyValue("--po-user-editor-heading-3-font-size")).toBe("19px");
    expect(element.style.getPropertyValue("--po-user-editor-heading-4-font-size")).toBe("17px");
    expect(element.style.getPropertyValue("--po-user-editor-heading-5-font-size")).toBe("16px");
    expect(element.style.getPropertyValue("--po-user-editor-heading-6-font-size")).toBe("15px");
    expect(element.dataset.typographyEditorScale).toBe("medium");
    expect(element.dataset.typographyRightSidebarScale).toBe("large");
    expect(element.dataset.typographyLeftSidebarScale).toBe("medium");
    expect(element.dataset.typographyHeaderScale).toBe("medium");
    expect(element.dataset.textSizeConversationMode).toBeUndefined();
    expect(element.dataset.textSizeMonospaceMode).toBeUndefined();
  });
});
