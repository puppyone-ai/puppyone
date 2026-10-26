import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const selectionCss = readFileSync(path.join(root, "packages/shared-ui/src/styles/editor/text-selection.css"), "utf8");
const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const declarations = (css: string, property: string) => [...uncommented(css).matchAll(
  new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`, "g"),
)].map((match) => match[1].trim());
const rules = (css: string) => [...uncommented(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1].replace(/\s+/g, " ").trim(), body: match[2] }));

function stylesheets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : stylesheets(file);
    return entry.name.endsWith(".css") ? [file] : [];
  });
}

describe("native text selection paint", () => {
  it("paints every native highlight from one opaque composite of the theme tint", () => {
    // Native selection rounds each line rectangle outward to device pixels, so
    // fractional neighbours overlap. Only an opaque paint keeps overlap inert.
    expect(declarations(selectionCss, "--po-selection-paint")).toEqual([
      "color(from color-mix(in srgb, color(from var(--po-selection-tint) srgb r g b / calc(alpha / (999 * (1 - alpha)))) 99.9%, var(--po-canvas, Canvas)) srgb r g b / 1)",
    ]);
    const nativePaints = rules(selectionCss)
      .filter(({ selector }) => selector.includes("::selection"))
      .flatMap(({ selector, body }) => declarations(`{${body}}`, "background-color").map((value) => ({ selector, value })));
    for (const { selector, value } of nativePaints) {
      if (value.startsWith("Highlight")) continue; // forced colors
      if (/:is\(img, svg, video, canvas\)::selection/.test(selector)) {
        expect(value, selector).toBe("var(--po-selection-tint)");
      } else {
        expect(value, selector).toMatch(/^var\(--po-selection-paint\)( !important)?$/);
      }
    }
  });

  it("keeps the composite and native selection paint out of feature stylesheets", () => {
    const owner = path.join(root, "packages/shared-ui/src/styles/editor/text-selection.css");
    const files = [...stylesheets(path.join(root, "src")), ...stylesheets(path.join(root, "packages/shared-ui/src"))]
      .filter((file) => file !== owner);
    for (const file of files) {
      const css = readFileSync(file, "utf8");
      const relative = path.relative(root, file);
      // Surfaces choose tints; they may only switch native paint off.
      for (const value of declarations(css, "--po-selection-paint")) expect(value, relative).toBe("transparent");
      for (const { selector, body } of rules(css)) {
        if (selector.includes("::selection")) expect(body, `${relative}: ${selector}`).not.toMatch(/background(-color)?\s*:/);
      }
      expect(css, relative).not.toContain("calc(alpha / (999");
    }
  });

  it("matches source-over for every tint alpha under CSS premultiplied color-mix", () => {
    // CSS Color 5 color-mix: premultiply, interpolate, un-premultiply.
    const mix = (top: number[], weight: number, bottom: number[]) => {
      const alpha = top[3] * weight + bottom[3] * (1 - weight);
      return [0, 1, 2].map((i) => (top[i] * top[3] * weight + bottom[i] * bottom[3] * (1 - weight)) / alpha);
    };
    const canvas = [0.086, 0.086, 0.086, 1];
    for (const alpha of [0, 0.05, 0.132, 0.22, 0.24, 0.28, 0.5, 0.7, 0.999, 1]) {
      const tint = [0.376, 0.647, 0.98, alpha];
      const realpha = Math.min(1, alpha / (999 * (1 - alpha)));
      const painted = mix([...tint.slice(0, 3), realpha], 0.999, canvas);
      const sourceOver = [0, 1, 2].map((i) => tint[i] * alpha + canvas[i] * (1 - alpha));
      painted.forEach((channel, i) => expect(Math.abs(channel - sourceOver[i]) * 255).toBeLessThan(0.5));
    }
  });
});
