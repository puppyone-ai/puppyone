import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createThemeService } from "../../../../electron/main/themes/theme-service.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("host-owned CSS theme service", () => {
  it("installs the theme guide without copying bundled CSS or changing user themes", async () => {
    const userDataPath = await createTemporaryDirectory();
    const bundledThemesPath = await createTemporaryDirectory();
    for (const [filename, name] of [
      ["alto", "Alto"],
      ["jade", "Jade"],
      ["newspaper", "Newspaper"],
      ["rainbow", "Rainbow"],
      ["github", "GitHub"],
      ["forest", "Forest"],
      ["night", "Night"],
      ["rose", "Rose"],
    ]) {
      await createSingleFilePack(
        bundledThemesPath,
        `${filename}.css`,
        `builtin.pack.${filename}`,
        name,
      );
    }
    await writeFile(path.join(bundledThemesPath, "README.md"), "# PuppyOne themes\n", "utf8");
    const themeRoot = path.join(userDataPath, "themes");
    await mkdir(themeRoot, { recursive: true });
    await createSingleFilePack(
      themeRoot,
      "personal.css",
      "com.example.personal",
      "Personal",
    );
    const personalThemePath = path.join(themeRoot, "personal.css");
    const personalTheme = await readFile(personalThemePath, "utf8");
    const service = createThemeService({ userDataPath, bundledThemesPath, shell: createShell() });

    const snapshot = await service.listThemes();
    expect(snapshot.themes).toHaveLength(1);
    expect(snapshot.themes[0]).toMatchObject({
      id: "com.example.personal",
      name: "Personal",
      source: "local-css",
      targets: ["application", "markdown", "csv"],
    });
    const installedReadme = path.join(userDataPath, "themes", "README.md");
    expect(await readFile(installedReadme, "utf8")).toBe("# PuppyOne themes\n");
    expect(await readFile(personalThemePath, "utf8")).toBe(personalTheme);
    expect((await readdir(themeRoot)).filter((entry) => entry.endsWith(".css")))
      .toEqual(["personal.css"]);

    await writeFile(installedReadme, "# My theme notes\n", "utf8");
    await service.listThemes();
    expect(await readFile(installedReadme, "utf8")).toBe("# My theme notes\n");
  });

  it("installs the guide for a previous starter catalog without overwriting themes", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    await mkdir(themeRoot, { recursive: true });
    await writeFile(path.join(themeRoot, ".puppyone-starter-themes-v4"), "4\n", "utf8");
    const userTheme = "/* keep my theme */\nbody { color: rebeccapurple }\n";
    await writeFile(path.join(themeRoot, "forest.css"), userTheme, "utf8");

    const service = createThemeService({
      userDataPath,
      bundledThemesPath: path.join(process.cwd(), "electron", "themes"),
      shell: createShell(),
    });
    await service.listThemes();

    expect(await readFile(path.join(themeRoot, "README.md"), "utf8"))
      .toContain("Where this folder belongs");
    expect(await readFile(path.join(themeRoot, "forest.css"), "utf8")).toBe(userTheme);
    expect(await readFile(path.join(themeRoot, ".puppyone-theme-guide-v1"), "utf8"))
      .toBe("1\n");
  });

  it("ships the theme guide without distributable CSS assets", async () => {
    const userDataPath = await createTemporaryDirectory();
    const bundledThemesPath = path.join(process.cwd(), "electron", "themes");
    const service = createThemeService({
      userDataPath,
      bundledThemesPath,
      shell: createShell(),
    });

    const snapshot = await service.listThemes();

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.themes).toEqual([]);
    expect(await readFile(path.join(userDataPath, "themes", "README.md"), "utf8"))
      .toContain("Where this folder belongs");
    expect((await readdir(bundledThemesPath)).filter((entry) => entry.endsWith(".css")))
      .toEqual([]);
  });

  it("discovers manifest packages and metadata-free token themes", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    await mkdir(path.join(themeRoot, "paper"), { recursive: true });
    await writeJson(path.join(themeRoot, "paper", "theme.json"), {
      schemaVersion: 1,
      id: "com.example.paper",
      name: "Paper",
      version: "1.0.0",
      modes: ["light"],
      targets: ["markdown", "csv"],
      entrypoints: { markdown: "markdown.css", csv: "csv.css" },
    });
    await writeFile(path.join(themeRoot, "paper", "markdown.css"), ":root { --po-md-content-color: #392f28 }", "utf8");
    await writeFile(path.join(themeRoot, "paper", "csv.css"), ":root { --po-csv-surface-background: #ede4d6 }", "utf8");
    await writeFile(path.join(themeRoot, "newsprint.css"), ":root { --po-md-content-color: #222 }", "utf8");

    const service = createThemeService({ userDataPath, shell: createShell() });
    const snapshot = await service.listThemes();

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.themes.map(({ id, source, targets }) => ({ id, source, targets }))).toEqual([
      { id: "local.css.newsprint", source: "local-css", targets: ["markdown"] },
      { id: "com.example.paper", source: "local-package", targets: ["markdown", "csv"] },
    ]);
    expect(snapshot.themes[0].compiledCss.markdown).toContain('data-sub-theme-id="local.css.newsprint"');
    expect(snapshot.themes[0].compiledCss.markdown).toContain("--po-host-md-content-color");
    expect(snapshot.themes[1].compiledCss.csv).toContain("--po-host-csv-surface-background");
    expect(JSON.stringify(snapshot)).not.toContain(userDataPath);
  });

  it("loads a coordinated single CSS theme across all declared surfaces", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    await mkdir(themeRoot, { recursive: true });
    await writeFile(path.join(themeRoot, "forest.css"), `
      @puppyone-theme {
        id: com.example.forest;
        name: Forest;
        version: 1.0.0;
        author: Example Studio;
        modes: light dark;
      }
      @puppyone application {
        .theme-root { --po-canvas: #f4f8f5; --po-accent: #2f6f52; }
        .dark .theme-root { --po-canvas: #102019; --po-accent: #70b899; }
      }
      @puppyone markdown {
        :root { --po-md-content-color: #27352f; }
        .dark .theme-root { --po-md-content-color: #d4e2dc; }
      }
      @puppyone csv {
        .theme-root { --po-csv-surface-color: #27352f; }
        .dark .theme-root { --po-csv-surface-color: #d4e2dc; }
      }
    `, "utf8");

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.themes).toHaveLength(1);
    expect(snapshot.themes[0]).toMatchObject({
      id: "com.example.forest",
      name: "Forest",
      author: "Example Studio",
      version: "1.0.0",
      modes: ["light", "dark"],
      targets: ["application", "markdown", "csv"],
      source: "local-css",
      firstPaint: {
        light: { background: "#f4f8f5", colorScheme: "light" },
        dark: { background: "#102019", colorScheme: "dark" },
      },
    });
    expect(snapshot.themes[0].compiledCss.application).toContain("data-po-appearance-root");
    expect(snapshot.themes[0].compiledCss.markdown).toContain("--po-host-md-content-color");
    expect(snapshot.themes[0].compiledCss.csv).toContain("--po-host-csv-surface-color");
  });

  it("rejects global font injection from a coordinated theme.css package", async () => {
    const userDataPath = await createTemporaryDirectory();
    const packagePath = path.join(userDataPath, "themes", "reader");
    await mkdir(path.join(packagePath, "fonts"), { recursive: true });
    await writeFile(path.join(packagePath, "fonts", "reader.woff2"), Buffer.from("font-data"));
    await writeFile(path.join(packagePath, "theme.css"), `
      @puppyone-theme {
        id: com.example.reader;
        name: Reader;
        version: 1.0.0;
        author: Example Studio;
        modes: light dark;
      }
      @puppyone application {
        .theme-root { --po-accent: #2f6f52; }
        .dark .theme-root { --po-accent: #70b899; }
      }
      @puppyone markdown {
        @font-face {
          font-family: Reader;
          src: url("./fonts/reader.woff2") format("woff2");
        }
        :root { --po-md-content-font: Reader; }
      }
      @puppyone csv {
        .theme-root { --po-csv-surface-color: #27352f; }
        .dark .theme-root { --po-csv-surface-color: #d4e2dc; }
      }
    `, "utf8");

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.themes).toEqual([]);
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({
      source: "reader",
      message: expect.stringContaining("Unsupported theme CSS at-rule: @font-face"),
    }));
  });

  it("requires coordinated metadata in a directory theme.css", async () => {
    const userDataPath = await createTemporaryDirectory();
    const packagePath = path.join(userDataPath, "themes", "reader");
    await mkdir(packagePath, { recursive: true });
    await writeFile(path.join(packagePath, "theme.css"), "body { color: #27352f }", "utf8");

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.themes).toEqual([]);
    expect(snapshot.diagnostics).toContainEqual({
      source: "reader",
      message: "A directory theme.css must contain @puppyone-theme metadata.",
    });
  });

  it("rejects a directory theme.css symlink that escapes its package", async () => {
    const userDataPath = await createTemporaryDirectory();
    const packagePath = path.join(userDataPath, "themes", "reader");
    await mkdir(packagePath, { recursive: true });
    const outsideCss = path.join(userDataPath, "outside-theme.css");
    await createSingleFilePack(userDataPath, "outside-theme.css", "com.example.reader", "Reader");
    await symlink(outsideCss, path.join(packagePath, "theme.css"));

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.themes).toEqual([]);
    expect(snapshot.diagnostics[0]).toMatchObject({ source: "reader" });
    expect(snapshot.diagnostics[0].message).toContain("escapes its package");
  });

  it("prefers theme.json when a directory also contains theme.css", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    const packagePath = path.join(themeRoot, "reader");
    await createPackage(themeRoot, "reader", "com.example.manifest-reader", "Manifest Reader");
    await createSingleFilePack(packagePath, "theme.css", "com.example.css-reader", "CSS Reader");

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.themes).toHaveLength(1);
    expect(snapshot.themes[0]).toMatchObject({
      id: "com.example.manifest-reader",
      name: "Manifest Reader",
      source: "local-package",
    });
  });

  it("rejects imported CSS that attempts to inject global fonts", async () => {
    const userDataPath = await createTemporaryDirectory();
    const packagePath = path.join(userDataPath, "themes", "reader");
    await mkdir(path.join(packagePath, "styles"), { recursive: true });
    await mkdir(path.join(packagePath, "fonts"), { recursive: true });
    await writeJson(path.join(packagePath, "theme.json"), {
      schemaVersion: 1,
      id: "com.example.reader",
      name: "Reader",
      version: "1.0.0",
      modes: ["light"],
      targets: ["markdown"],
      entrypoints: { markdown: "markdown.css" },
    });
    await writeFile(path.join(packagePath, "markdown.css"), '@import "./styles/content.css";', "utf8");
    await writeFile(
      path.join(packagePath, "styles", "content.css"),
      '@font-face { font-family: Reader; src: url("../fonts/reader.woff2") format("woff2") } :root { --po-md-content-font: Reader }',
      "utf8",
    );
    await writeFile(path.join(packagePath, "fonts", "reader.woff2"), Buffer.from("font-data"));

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.themes).toEqual([]);
    expect(snapshot.diagnostics[0]).toMatchObject({ source: "reader" });
    expect(snapshot.diagnostics[0].message).toContain("Unsupported theme CSS at-rule: @font-face");
    expect(snapshot.diagnostics[0].message).not.toContain(userDataPath);
  });

  it("isolates invalid themes and reports duplicate IDs deterministically", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    await createPackage(themeRoot, "a-first", "com.example.duplicate", "First");
    await createPackage(themeRoot, "b-second", "com.example.duplicate", "Second");
    await mkdir(path.join(themeRoot, "broken"), { recursive: true });
    await writeFile(path.join(themeRoot, "broken", "theme.json"), "{", "utf8");
    await writeFile(path.join(themeRoot, "remote.css"), 'body { background: url("https://example.com/pixel.png") }', "utf8");

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.themes).toHaveLength(1);
    expect(snapshot.themes[0]).toMatchObject({ id: "com.example.duplicate", name: "First" });
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.source)).toEqual([
      "b-second",
      "broken",
      "remote.css",
    ]);
    expect(snapshot.diagnostics.every((diagnostic) => !diagnostic.message.includes(userDataPath))).toBe(true);
  });

  it("creates and opens only its exact user-data theme directory", async () => {
    const userDataPath = await createTemporaryDirectory();
    const shell = createShell();
    const service = createThemeService({ userDataPath, shell });

    const result = await service.openDirectory();

    expect(result).toEqual({ opened: true });
    expect(shell.openPath).toHaveBeenCalledExactlyOnceWith(path.join(userDataPath, "themes"));
  });

  it("creates one-file local theme packages and reveals each new theme.css", async () => {
    const userDataPath = await createTemporaryDirectory();
    const shell = createShell();
    const service = createThemeService({ userDataPath, shell });

    await expect(service.createTheme()).resolves.toEqual({
      created: true,
      themeId: "local.user.custom-theme",
    });
    await expect(service.createTheme()).resolves.toEqual({
      created: true,
      themeId: "local.user.custom-theme-2",
    });

    const firstCss = path.join(userDataPath, "themes", "custom-theme", "theme.css");
    const secondCss = path.join(userDataPath, "themes", "custom-theme-2", "theme.css");
    expect(await readFile(firstCss, "utf8")).toContain("id: local.user.custom-theme;");
    expect(await readFile(firstCss, "utf8")).toContain(".dark .theme-root");
    expect(await readFile(secondCss, "utf8")).toContain("name: Custom Theme 2;");
    expect(shell.showItemInFolder).toHaveBeenNthCalledWith(1, await realpath(firstCss));
    expect(shell.showItemInFolder).toHaveBeenNthCalledWith(2, await realpath(secondCss));

    const snapshot = await service.listThemes();
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.themes.map(({ id }) => id)).toEqual([
      "local.user.custom-theme",
      "local.user.custom-theme-2",
    ]);
    expect(snapshot.themes[0].firstPaint).toEqual({
      light: { background: "#fafafa", colorScheme: "light" },
      dark: { background: "#161413", colorScheme: "dark" },
    });
  });

  it("keeps a legacy managed Custom CSS directory on disk without loading it", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    const legacyRoot = path.join(themeRoot, "puppyone-custom-css");
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(path.join(legacyRoot, "markdown.css"), "body { color: teal }", "utf8");
    const service = createThemeService({ userDataPath, shell: createShell() });

    const snapshot = await service.listThemes();

    expect(snapshot.themes.some((theme) => theme.id === "local.puppyone.custom-css")).toBe(false);
    expect(await readFile(path.join(legacyRoot, "markdown.css"), "utf8"))
      .toBe("body { color: teal }");
  });

  it("reserves the Custom CSS id for the managed package directory", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    await createPackage(
      themeRoot,
      "aaa-custom-css-impostor",
      "local.puppyone.custom-css",
      "Impostor",
    );
    await writeFile(
      path.join(themeRoot, "aaa-custom-css-impostor", "markdown.css"),
      "body { color: red }",
      "utf8",
    );
    const service = createThemeService({ userDataPath, shell: createShell() });

    const snapshot = await service.listThemes();
    const customThemes = snapshot.themes.filter((theme) => (
      theme.id === "local.puppyone.custom-css"
    ));

    expect(customThemes).toHaveLength(0);
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({
      source: "aaa-custom-css-impostor",
      message: expect.stringContaining("reserved for legacy compatibility"),
    }));
  });

  it("rejects a user-data theme root redirected through a symlink", async () => {
    const userDataPath = await createTemporaryDirectory();
    const outside = await createTemporaryDirectory();
    await symlink(outside, path.join(userDataPath, "themes"));

    const service = createThemeService({ userDataPath, shell: createShell() });

    await expect(service.listThemes()).rejects.toThrow("theme root");
    await expect(readFile(path.join(outside, "markdown.css"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects manifest entrypoint symlinks that escape a package", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    const packagePath = path.join(themeRoot, "escaped");
    await mkdir(packagePath, { recursive: true });
    await writeJson(path.join(packagePath, "theme.json"), {
      schemaVersion: 1,
      id: "com.example.escaped",
      name: "Escaped",
      version: "1.0.0",
      modes: ["light"],
      targets: ["markdown"],
      entrypoints: { markdown: "markdown.css" },
    });
    const outsideCss = path.join(userDataPath, "outside.css");
    await writeFile(outsideCss, "body { color: red }", "utf8");
    await symlink(outsideCss, path.join(packagePath, "markdown.css"));

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.themes).toEqual([]);
    expect(snapshot.diagnostics[0]).toMatchObject({ source: "escaped" });
    expect(snapshot.diagnostics[0].message).toContain("escapes its package");
  });

  it("rejects manifest symlinks that escape a package", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    const packagePath = path.join(themeRoot, "manifest-link");
    await mkdir(packagePath, { recursive: true });
    const outsideManifest = path.join(userDataPath, "outside-theme.json");
    await writeJson(outsideManifest, {
      schemaVersion: 1,
      id: "com.example.manifest-link",
      name: "Manifest Link",
      version: "1.0.0",
      modes: ["light"],
      targets: ["markdown"],
      entrypoints: { markdown: "markdown.css" },
    });
    await symlink(outsideManifest, path.join(packagePath, "theme.json"));

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.themes).toEqual([]);
    expect(snapshot.diagnostics[0].message).toContain("escapes its package");
  });

  it("rejects themes whose aggregate imported CSS exceeds the compilation budget", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    const packagePath = path.join(themeRoot, "oversized");
    await createPackage(themeRoot, "oversized", "com.example.oversized", "Oversized");
    const largeComment = `/*${"x".repeat(1_500_000)}*/`;
    await writeFile(
      path.join(packagePath, "markdown.css"),
      '@import "a.css"; @import "b.css"; @import "c.css";',
      "utf8",
    );
    await Promise.all(["a.css", "b.css", "c.css"].map((filename) => (
      writeFile(path.join(packagePath, filename), largeComment, "utf8")
    )));

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.themes).toEqual([]);
    expect(snapshot.diagnostics[0].message).toContain("aggregate CSS size limit");
  });

  it("rejects repeated asset expansion before compiled CSS exceeds its output budget", async () => {
    const userDataPath = await createTemporaryDirectory();
    const themeRoot = path.join(userDataPath, "themes");
    const packagePath = path.join(themeRoot, "expanded-asset");
    await createPackage(themeRoot, "expanded-asset", "com.example.expanded-asset", "Expanded Asset");
    await writeFile(path.join(packagePath, "background.png"), Buffer.alloc(5 * 1024 * 1024));
    await writeFile(
      path.join(packagePath, "markdown.css"),
      [
        ':root { --po-md-content-font: url("./background.png") }',
        ':root { --po-md-heading-color: url("./background.png") }',
        ':root { --po-md-link-color: url("./background.png") }',
      ].join("\n"),
      "utf8",
    );

    const snapshot = await createThemeService({ userDataPath, shell: createShell() }).listThemes();

    expect(snapshot.themes).toEqual([]);
    expect(snapshot.diagnostics[0].message).toContain("embedded asset expansion limit");
  });
});

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "puppyone-theme-service-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createShell() {
  return {
    openPath: vi.fn(async () => ""),
    showItemInFolder: vi.fn(),
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value), "utf8");
}

async function createPackage(themeRoot, directoryName, id, name) {
  const packagePath = path.join(themeRoot, directoryName);
  await mkdir(packagePath, { recursive: true });
  await writeJson(path.join(packagePath, "theme.json"), {
    schemaVersion: 1,
    id,
    name,
    version: "1.0.0",
    modes: ["light"],
    targets: ["markdown"],
    entrypoints: { markdown: "markdown.css" },
  });
  await writeFile(path.join(packagePath, "markdown.css"), ":root { --po-md-content-color: #222 }", "utf8");
}

async function createSingleFilePack(themeRoot, filename, id, name) {
  await writeFile(path.join(themeRoot, filename), `
    @puppyone-theme {
      id: ${id};
      name: ${name};
      version: 1.0.0;
      modes: light dark;
    }
    @puppyone application {
      .theme-root { --po-accent: #2563eb }
      .dark .theme-root { --po-accent: #60a5fa }
    }
    @puppyone markdown {
      :root { --po-md-content-color: #222 }
      .dark .theme-root { --po-md-content-color: #eee }
    }
    @puppyone csv {
      .theme-root { --po-csv-surface-color: #222 }
      .dark .theme-root { --po-csv-surface-color: #eee }
    }
  `, "utf8");
}
