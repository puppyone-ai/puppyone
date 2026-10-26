import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const read = (relativePath: string) => readFileSync(`${repositoryRoot}${relativePath}`, "utf8");

const fileIconsCss = read("packages/shared-ui/src/styles/file-icons.css");
const sharedPatternsCss = read("packages/shared-ui/src/styles/shared-ui-patterns.css");
const rules = fileIconsCss.replace(/\/\*[\s\S]*?\*\//g, "").trim();

describe("Appearance → Show file icons", () => {
  it("ships with the shared UI styles", () => {
    expect(sharedPatternsCss).toMatch(/@import\s+["']\.\/file-icons\.css["']/);
  });

  it("hides only file glyphs, never folder chevrons, and keeps the slot for alignment", () => {
    expect(rules).toBe(
      ':where([data-file-icons="hidden"]) .tree-row.file .tree-icon-slot > * {\n  visibility: hidden;\n}',
    );
    expect(rules).not.toMatch(/\.folder|disclosure|display\s*:\s*none|width\s*:/);
  });
});
