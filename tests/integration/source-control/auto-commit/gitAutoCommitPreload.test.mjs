import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { GIT_AUTO_COMMIT_RENDERER_ARGUMENT } from "../../../../electron/main/git-auto-commit/feature-profile.mjs";

describe("Git Auto Commit release capability", () => {
  it("omits the preload bridge unless Main issues the capability argument", async () => {
    const source = await readFile(new URL("../../../../electron/preload.cjs", import.meta.url), "utf8");
    expect(runPreload(source, []).getGitAutoCommitSettings).toBeUndefined();
    expect(runPreload(source, [GIT_AUTO_COMMIT_RENDERER_ARGUMENT])).toMatchObject({
      getGitAutoCommitSettings: expect.any(Function),
      setGitAutoCommitExperimentalOptIn: expect.any(Function),
      setGitAutoCommitWorkspacePolicy: expect.any(Function),
      onGitAutoCommitStateChanged: expect.any(Function),
    });
  });
});

function runPreload(source, additionalArguments) {
  let exposed = null;
  const context = {
    process: { argv: ["electron", "app", ...additionalArguments] },
    require: (specifier) => {
      if (specifier !== "electron") throw new Error(`Unexpected preload import: ${specifier}`);
      return {
        contextBridge: {
          exposeInMainWorld: (_name, value) => { exposed = value; },
        },
        ipcRenderer: {
          invoke: () => Promise.resolve(),
          on: () => undefined,
          removeListener: () => undefined,
          send: () => undefined,
        },
        webUtils: { getPathForFile: () => "" },
      };
    },
    console,
    Promise,
    Error,
  };
  vm.runInNewContext(source, context, { filename: "preload.cjs" });
  return exposed;
}
