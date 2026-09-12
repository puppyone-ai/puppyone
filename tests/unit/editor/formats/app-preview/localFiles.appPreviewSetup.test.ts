import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalDataPort } from "../../../../../src/lib/localFiles";

const EMPTY_APP = '{"type":"puppyone.app","version":1}';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local App Preview setup port", () => {
  it("preflights a package script and conditionally persists the confirmed setup", async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const, version: "sha256:configured" }));
    const readFile = vi.fn(async ({ path }: { path: string }) => {
      if (path === "demo.puppyoneapp") {
        return { path, name: path, type: "app", content: EMPTY_APP, version: "sha256:empty" };
      }
      return {
        path,
        name: "package.json",
        type: "json",
        content: JSON.stringify({ scripts: { dev: "vite" } }),
        version: "sha256:package",
      };
    });
    const listFolderChildren = vi.fn(async () => [{
      id: "package.json",
      name: "package.json",
      path: "package.json",
      type: "json",
    }]);
    vi.stubGlobal("window", {
      puppyoneDesktop: { readFile, writeFile, listFolderChildren },
    });

    const result = await createLocalDataPort("/workspace").appPreview?.configure?.({
      path: "demo.puppyoneapp",
      name: "Demo",
      expectedContent: EMPTY_APP,
      setup: { kind: "local-server", cwd: ".", command: ["npm", "run", "dev"] },
    });

    expect(result?.content).toContain('"kind": "local-server"');
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: "/workspace",
      path: "demo.puppyoneapp",
      expectedVersion: "sha256:empty",
    }));
  });

  it("does not persist when preflight cannot find the selected package script", async () => {
    const writeFile = vi.fn();
    const readFile = vi.fn(async ({ path }: { path: string }) => path === "demo.puppyoneapp"
      ? { path, name: path, type: "app", content: EMPTY_APP, version: "sha256:empty" }
      : { path, name: "package.json", type: "json", content: JSON.stringify({ scripts: {} }) });
    vi.stubGlobal("window", {
      puppyoneDesktop: {
        readFile,
        writeFile,
        listFolderChildren: vi.fn(async () => [{
          id: "package.json",
          name: "package.json",
          path: "package.json",
          type: "json",
        }]),
      },
    });

    await expect(createLocalDataPort("/workspace").appPreview?.configure?.({
      path: "demo.puppyoneapp",
      name: "Demo",
      expectedContent: EMPTY_APP,
      setup: { kind: "local-server", cwd: ".", command: ["npm", "run", "dev"] },
    })).rejects.toThrow(/script not found/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("does not misclassify an advanced package-manager command as a package script", async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const, version: "sha256:configured" }));
    vi.stubGlobal("window", {
      puppyoneDesktop: {
        readFile: vi.fn(async ({ path }: { path: string }) => ({
          path,
          name: path,
          type: "app",
          content: EMPTY_APP,
          version: "sha256:empty",
        })),
        writeFile,
        listFolderChildren: vi.fn(async () => []),
      },
    });

    await expect(createLocalDataPort("/workspace").appPreview?.configure?.({
      path: "demo.puppyoneapp",
      name: "Demo",
      expectedContent: EMPTY_APP,
      setup: { kind: "local-server", cwd: ".", command: ["npm", "exec", "vite"] },
    })).resolves.toMatchObject({ version: "sha256:configured" });
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});
