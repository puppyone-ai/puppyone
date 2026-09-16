import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileThemeCss } from "../../../../electron/main/themes/theme-css-compiler.mjs";
import { parseSingleFileThemeCss } from "../../../../electron/main/themes/theme-single-file-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const packagesRoot = path.join(repoRoot, "sub-themes");

function declarationsForSelector(css, selector) {
  const declarations = {};
  postcss.parse(css).walkRules((rule) => {
    if (rule.selector !== selector) return;
    for (const node of rule.nodes) {
      if (node.type === "decl") declarations[node.prop] = node.value;
    }
  });
  return declarations;
}

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [red, green, blue] = channels.map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

describe("built-in Sub Theme package architecture", () => {
  it("keeps one self-describing theme.css in every built-in package", () => {
    const packages = readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.name !== ".DS_Store")
      .sort((left, right) => left.name.localeCompare(right.name));
    expect(packages.map((entry) => entry.name)).toEqual([
      "default-github",
      "default-graphite",
      "default-neutral",
      "default-newspaper",
      "default-warm",
      "windows-xp-luna-blue",
    ]);
    for (const entry of packages) {
      expect(entry.isDirectory()).toBe(true);
      expect(readdirSync(path.join(packagesRoot, entry.name))).toEqual(["theme.css"]);
    }
  });

  it("parses and compiles every package through the same public token boundary", async () => {
    const themes = [];
    for (const directory of readdirSync(packagesRoot).sort()) {
      const sourcePath = `sub-themes/${directory}/theme.css`;
      const theme = parseSingleFileThemeCss(
        readFileSync(path.join(repoRoot, sourcePath), "utf8"),
        {
          sourcePath,
          allowReservedBuiltinId: true,
          allowBuiltinCompatibilityMetadata: true,
        },
      );
      expect(theme).not.toBeNull();
      expect(directory).toBe(theme.id.replaceAll(".", "-"));
      for (const target of theme.targets) {
        const result = await compileThemeCss({
          css: theme.stylesheets[target],
          themeId: theme.id,
          target,
          supportedModes: theme.modes,
          allowReservedBuiltinId: true,
        });
        expect(result.css).not.toMatch(/\.cm-|\.markdown-codemirror-editor|\.csv-table-editor/);
        expect(result.css).not.toContain("@puppyone");
        if (target === "application") {
          for (const mode of theme.modes) {
            expect(result.firstPaint?.[mode], `${theme.id}:${mode}`).toMatchObject({
              background: expect.stringMatching(/^#[0-9a-f]{6}$/),
              colorScheme: mode,
            });
          }
        }
      }
      themes.push(theme);
    }
    expect(themes.sort((left, right) => left.builtinOrder - right.builtinOrder).map(({ id }) => id))
      .toEqual([
        "default.neutral",
        "default.warm",
        "default.graphite",
        "default.github",
        "default.newspaper",
        "windows-xp.luna-blue",
      ]);
  });

  it("keeps the generated runtime registry synchronized", () => {
    expect(() => execFileSync(
      process.execPath,
      ["scripts/generate-builtin-sub-themes.mjs", "--check"],
      { cwd: repoRoot, stdio: "pipe" },
    )).not.toThrow();
  });

  it("keeps Neutral's Dark shell surfaces distinct from the editor", async () => {
    const sourcePath = "sub-themes/default-neutral/theme.css";
    const theme = parseSingleFileThemeCss(
      readFileSync(path.join(repoRoot, sourcePath), "utf8"),
      {
        sourcePath,
        allowReservedBuiltinId: true,
        allowBuiltinCompatibilityMetadata: true,
      },
    );
    const result = await compileThemeCss({
      css: theme.stylesheets.application,
      themeId: theme.id,
      target: "application",
      supportedModes: theme.modes,
      allowReservedBuiltinId: true,
    });
    const darkHost = `[data-po-appearance-root][data-sub-theme-id="default.neutral"]:where(.dark)`;
    const darkTokens = declarationsForSelector(result.css, darkHost);
    expect(darkTokens["--po-surface-chrome"]).toBe("#201e1c");
    expect(darkTokens["--po-header"]).toBe("var(--po-surface-chrome)");
    expect(darkTokens["--po-sidebar"]).toBe("var(--po-surface-chrome)");
    expect(darkTokens["--po-surface-chrome"]).not.toBe(darkTokens["--po-surface-editor"]);
    expect(darkTokens["--po-text"]).toBe("#fafafa");
  });

  it("keeps Warm's light shell surfaces from leaking into Dark mode", async () => {
    const sourcePath = "sub-themes/default-warm/theme.css";
    const theme = parseSingleFileThemeCss(
      readFileSync(path.join(repoRoot, sourcePath), "utf8"),
      {
        sourcePath,
        allowReservedBuiltinId: true,
        allowBuiltinCompatibilityMetadata: true,
      },
    );
    const result = await compileThemeCss({
      css: theme.stylesheets.application,
      themeId: theme.id,
      target: "application",
      supportedModes: theme.modes,
      allowReservedBuiltinId: true,
    });
    const darkHost = `[data-po-appearance-root][data-sub-theme-id="default.warm"]:where(.dark)`;
    expect(result.css).toContain(`${darkHost} {`);
    expect(result.css).toContain("--po-header: color-mix(in srgb, var(--po-surface-chrome) 40%, var(--po-surface-editor))");
    expect(result.css).toContain("--po-sidebar: color-mix(in srgb, var(--po-surface-chrome) 40%, var(--po-surface-editor))");
  });

  it("keeps Graphite's Dark text and syntax colors readable", async () => {
    const sourcePath = "sub-themes/default-graphite/theme.css";
    const theme = parseSingleFileThemeCss(
      readFileSync(path.join(repoRoot, sourcePath), "utf8"),
      {
        sourcePath,
        allowReservedBuiltinId: true,
        allowBuiltinCompatibilityMetadata: true,
      },
    );
    const result = await compileThemeCss({
      css: theme.stylesheets.application,
      themeId: theme.id,
      target: "application",
      supportedModes: theme.modes,
      allowReservedBuiltinId: true,
    });
    const darkHost = `[data-po-appearance-root][data-sub-theme-id="default.graphite"]:where(.dark)`;
    const darkTokens = declarationsForSelector(result.css, darkHost);
    expect(darkTokens["--po-text"]).toBe("#fafafa");
    expect(darkTokens["--po-text-muted"]).toBe("#a1a1aa");
    expect(darkTokens["--po-text-subtle"]).toBe("#71717a");
    expect(darkTokens["--po-json-key"]).toBe("#cbd5e1");
    expect(darkTokens["--po-json-string"]).toBe("#7dd3fc");
    expect(contrastRatio(darkTokens["--po-text"], darkTokens["--po-canvas"])).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(darkTokens["--po-text-muted"], darkTokens["--po-canvas"])).toBeGreaterThanOrEqual(4.5);
  });

  it("removes legacy preset palettes from the global token layer", () => {
    const globalTokens = readFileSync(path.join(repoRoot, "src/styles/tokens.css"), "utf8");
    const fallback = readFileSync(path.join(repoRoot, "src/styles/fallback-theme.generated.css"), "utf8");
    expect(globalTokens).not.toContain("data-light-theme-preset=");
    expect(globalTokens).not.toContain("data-dark-theme-preset=");
    expect(globalTokens).not.toContain("--po-surface-panel: #fafafa");
    expect(fallback).toContain("generated from sub-themes/default-neutral/theme.css");
    expect(fallback).toContain("--po-surface-panel: #fafafa");
  });
});
