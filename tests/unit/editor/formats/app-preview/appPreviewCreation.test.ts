import { describe, expect, it } from "vitest";
import type { DataNode, DataPort, FileContent } from "@puppyone/shared-ui";
import { parseAppPreviewManifest } from "../../../../../shared/appPreviewManifest.js";
import {
  AppPreviewCreationError,
  createAppPreviewManifestContent,
  detectAppPreviewProjects,
  normalizeAppPreviewWorkingDirectory,
  parseAppPreviewCommandLine,
} from "../../../../../src/features/data-workspace/appPreviewCreation";

describe("App Preview creation", () => {
  it("detects runnable projects and ranks the current project first", async () => {
    const dataPort = createDataPort({
      root: [
        file("package.json"),
        file("pnpm-lock.yaml"),
        folder("slides"),
      ],
      slides: [
        file("slides/package.json"),
        file("slides/yarn.lock"),
      ],
    }, {
      "package.json": JSON.stringify({
        scripts: { dev: "vite", build: "vite build" },
        devDependencies: { vite: "latest" },
      }),
      "slides/package.json": JSON.stringify({
        scripts: { dev: "slidev --open false" },
        devDependencies: { "@slidev/cli": "latest" },
      }),
    });

    const candidates = await detectAppPreviewProjects(dataPort, null);

    expect(candidates[0]).toMatchObject({
      cwd: ".",
      directoryLabel: ".",
      script: "dev",
      packageManager: "pnpm",
      framework: "Vite",
      command: ["pnpm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "${port}"],
    });
    expect(candidates.find((candidate) => candidate.cwd === "slides")).toMatchObject({
      packageManager: "yarn",
      framework: "Slidev",
      command: ["yarn", "run", "dev", "--host", "127.0.0.1", "--port", "${port}"],
    });
  });

  it("uses framework-specific host flags for Next.js", async () => {
    const candidates = await detectAppPreviewProjects(createDataPort({
      root: [file("package.json")],
    }, {
      "package.json": JSON.stringify({
        scripts: { dev: "next dev" },
        dependencies: { next: "latest" },
      }),
    }), null);

    expect(candidates[0]?.command).toEqual([
      "npm", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", "${port}",
    ]);
  });

  it("parses a command into argv without invoking a shell", () => {
    expect(parseAppPreviewCommandLine("npm run dev -- --title 'Quarterly deck'")).toEqual([
      "npm", "run", "dev", "--", "--title", "Quarterly deck",
    ]);
    expect(parseAppPreviewCommandLine("node scripts/server\\ preview.mjs")).toEqual([
      "node", "scripts/server preview.mjs",
    ]);
    expect(() => parseAppPreviewCommandLine("npm run 'dev"))
      .toThrow(AppPreviewCreationError);
    expect(() => parseAppPreviewCommandLine("npm run dev\nopen bad"))
      .toThrow(/unsupported/i);
  });

  it("creates a strict, workspace-scoped manifest", () => {
    const content = createAppPreviewManifestContent({
      name: "Quarterly deck",
      cwd: normalizeAppPreviewWorkingDirectory("./slides"),
      command: ["npm", "run", "dev", "--", "--port", "${port}"],
    });
    const manifest = parseAppPreviewManifest(content, { appPath: "Quarterly deck.puppyoneapp" });

    expect(manifest.name).toBe("Quarterly deck");
    expect(manifest.launch.cwd).toBe("slides");
    expect(manifest.launch.command.at(-1)).toBe("${port}");
    expect(manifest.permissions.workspace).toEqual(["read"]);
    expect(() => normalizeAppPreviewWorkingDirectory("../outside"))
      .toThrow(/inside this folder/i);
  });
});

function createDataPort(
  children: Record<string, DataNode[]>,
  contents: Record<string, string>,
): Pick<DataPort, "listChildren" | "readFile"> {
  return {
    listChildren: async (path) => children[path ?? "root"] ?? [],
    readFile: async (path) => ({
      path,
      name: path.split("/").at(-1) ?? path,
      type: "json",
      content: contents[path] ?? "",
    } satisfies FileContent),
  };
}

function folder(path: string): DataNode {
  return {
    id: path,
    name: path.split("/").at(-1) ?? path,
    path,
    type: "folder",
  };
}

function file(path: string): DataNode {
  return {
    id: path,
    name: path.split("/").at(-1) ?? path,
    path,
    type: path.endsWith(".json") ? "json" : "text",
  };
}
