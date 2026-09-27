/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tooltipCss = readFileSync(
  resolve(process.cwd(), "src/styles/tooltip.css"),
  "utf8",
);

describe("desktop tooltip theme", () => {
  it("follows the overlay colors through light, dark, and sub-theme changes", () => {
    const style = document.createElement("style");
    style.textContent = `
      .test-appearance {
        --po-editor-bg: rgb(250, 250, 250);
        --po-border-subtle: rgb(232, 232, 232);
        --po-menu-shadow: none;
        --po-text: rgb(20, 20, 20);
      }
      .test-appearance.dark {
        --po-editor-bg: rgb(30, 30, 30);
        --po-border-subtle: rgb(48, 48, 48);
        --po-text: rgb(245, 245, 245);
      }
      ${tooltipCss}
    `;
    document.head.append(style);
    const appearance = document.createElement("div");
    appearance.className = "test-appearance";
    const tooltip = document.createElement("div");
    tooltip.className = "desktop-tooltip";
    appearance.append(tooltip);
    document.body.append(appearance);

    expect(getComputedStyle(tooltip).backgroundColor).toBe("rgb(250, 250, 250)");
    expect(getComputedStyle(tooltip).color).toBe("rgb(20, 20, 20)");

    appearance.classList.add("dark");
    expect(getComputedStyle(tooltip).backgroundColor).toBe("rgb(30, 30, 30)");
    expect(getComputedStyle(tooltip).color).toBe("rgb(245, 245, 245)");
    expect(getComputedStyle(tooltip).borderTopColor).toBe("rgb(48, 48, 48)");

    appearance.style.setProperty("--po-editor-bg", "rgb(65, 45, 95)");
    appearance.style.setProperty("--po-text", "rgb(255, 245, 255)");
    expect(getComputedStyle(tooltip).backgroundColor).toBe("rgb(65, 45, 95)");
    expect(getComputedStyle(tooltip).color).toBe("rgb(255, 245, 255)");

    appearance.remove();
    style.remove();
  });
});
