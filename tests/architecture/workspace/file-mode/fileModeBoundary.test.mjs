import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(repositoryRoot, file), "utf8");
const importsOf = (source) => [...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gms)]
  .map((match) => match[1]);

describe("File Mode boundary", () => {
  it("loads the project application only when the window needs it", () => {
    const main = read("src/main.tsx");
    expect(importsOf(main)).not.toContain("./App");
    expect(main).toContain('(await import("./App")).App');
    expect(main).toContain('(await import("./app/FileModeApp")).FileModeApp');
  });

  it("reads the window mode in one place", () => {
    const readers = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(path.join(repositoryRoot, directory), { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(child);
        else if (/\.tsx?$/.test(entry.name) && read(child).includes("#file-mode")) readers.push(child);
      }
    };
    walk("src");
    expect(readers).toEqual([path.join("src", "main.tsx")]);
  });

  it("keeps the project application unaware of File Mode", () => {
    const app = read("src/App.tsx");
    expect(app).not.toMatch(/file-?mode/i);
    expect(app).not.toContain("initialFile");
  });

  it("brings no project feature into the file window", () => {
    const imports = importsOf(read("src/app/FileModeApp.tsx"));
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier).not.toMatch(
        /(^|\/)(App|app-shell|desktop-agent|desktop-terminal|source-control|cloud|editor-workbench|data-workspace)(\/|$)/,
      );
    }
  });

  it("opens files before the first window restores a project", () => {
    const main = read("electron/main.mjs");
    const route = main.indexOf('app.on("open-file"');
    const ready = main.indexOf("app.whenReady()");
    expect(route).toBeGreaterThan(-1);
    expect(route).toBeLessThan(ready);
    expect(main.indexOf("await openPendingPaths()", ready))
      .toBeLessThan(main.indexOf("readLastActiveWorkspaceComposition()", ready));
  });
});
