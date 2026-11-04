import { describe, expect, it, vi } from "vitest";
import {
  createSystemOpenRoute,
  findProjectWindowForFolder,
  OpenPathRejection,
} from "../../../../electron/main/system-open-route.mjs";

const entries = {
  "/docs/plan.md": { isDirectory: () => false, isFile: () => true, size: 10 },
  "/docs/big.md": { isDirectory: () => false, isFile: () => true, size: 2_000 },
  "/docs/main.py": { isDirectory: () => false, isFile: () => true, size: 10 },
  "/docs/pipe": { isDirectory: () => false, isFile: () => false, size: 0 },
  "/repo": { isDirectory: () => true, isFile: () => false, size: 0 },
};
const fileSystem = {
  realpath: async (target) => {
    if (target === "/link/plan.md") return "/docs/plan.md";
    if (target === "/locked/plan.md") throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    if (!entries[target]) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return target;
  },
  stat: async (target) => entries[target],
};

function route({ fileWindow = null, projectWindow = null } = {}) {
  const calls = { shown: [], files: [], projects: [] };
  const openPath = createSystemOpenRoute({
    isFileModeFile: (target) => target.endsWith(".md"),
    maxFileBytes: 1_000,
    findFileWindow: (target) => (fileWindow && target === "/docs/plan.md" ? fileWindow : null),
    findProjectWindow: (target) => (projectWindow && target === "/repo" ? projectWindow : null),
    showExistingWindow: (window, options) => calls.shown.push([window, options]),
    openFileWindow: async (target, options) => calls.files.push([target, options]),
    openProjectWindow: async (target, options) => calls.projects.push([target, options]),
    fileSystem,
  });
  return { openPath, calls };
}

async function rejection(promise) {
  const error = await promise.catch((caught) => caught);
  expect(error).toBeInstanceOf(OpenPathRejection);
  return error.code;
}

describe("system open route", () => {
  it("opens a file in its own window, through its real path", async () => {
    const { openPath, calls } = route();
    await expect(openPath("/link/plan.md", { activate: false })).resolves.toEqual({
      path: "/docs/plan.md", status: "opened", kind: "file", window: "file",
    });
    expect(calls.files).toEqual([["/docs/plan.md", { activate: false }]]);
  });

  it("opens a folder as a project", async () => {
    const { openPath, calls } = route();
    await expect(openPath("/repo")).resolves.toMatchObject({ status: "opened", kind: "folder", window: "project" });
    expect(calls.projects).toEqual([["/repo", { activate: true }]]);
  });

  it("focuses a file or folder that is already open instead of opening it again", async () => {
    const { openPath, calls } = route({ fileWindow: "file-window", projectWindow: "project-window" });
    await expect(openPath("/docs/plan.md")).resolves.toMatchObject({ status: "focused", window: "file" });
    await expect(openPath("/repo", { activate: false })).resolves.toMatchObject({ status: "focused", window: "project" });
    expect(calls.shown).toEqual([["file-window", { activate: true }], ["project-window", { activate: false }]]);
    expect(calls.files).toEqual([]);
    expect(calls.projects).toEqual([]);
  });

  it("names why a path cannot open", async () => {
    const { openPath, calls } = route();
    expect(await rejection(openPath("/docs/missing.md"))).toBe("PATH_NOT_FOUND");
    expect(await rejection(openPath("/docs/main.py"))).toBe("UNSUPPORTED_TYPE");
    expect(await rejection(openPath("/docs/pipe"))).toBe("NOT_A_FILE_OR_FOLDER");
    expect(await rejection(openPath("/locked/plan.md"))).toBe("OPEN_FAILED");
    expect(calls.files).toEqual([]);
  });

  it("refuses a file that is too large only when the caller asks", async () => {
    const { openPath, calls } = route();
    expect(await rejection(openPath("/docs/big.md", { enforceSizeLimit: true }))).toBe("FILE_TOO_LARGE");
    await expect(openPath("/docs/big.md")).resolves.toMatchObject({ status: "opened" });
    expect(calls.files).toHaveLength(1);
  });
});

describe("project window for a folder", () => {
  const window = (destroyed = false) => ({ isDestroyed: vi.fn(() => destroyed) });
  const state = (folderPaths, lastFocusedAt, extra = {}) => ({ folderPaths, initialRestorePaths: [], lastFocusedAt, fileTarget: null, ...extra });

  it("prefers the window showing only that folder, then the latest focus", () => {
    const only = window();
    const recent = window();
    const older = window();
    const entries = [
      { window: older, state: state(["/repo", "/other"], 1) },
      { window: recent, state: state(["/repo", "/third"], 5) },
      { window: only, state: state(["/repo"], 2) },
    ];
    expect(findProjectWindowForFolder(entries, "/repo")).toBe(only);
    expect(findProjectWindowForFolder(entries.slice(0, 2), "/repo")).toBe(recent);
  });

  it("ignores file windows, closed windows and other folders", () => {
    expect(findProjectWindowForFolder([
      { window: window(), state: state([], 9, { fileTarget: { path: "/repo/a.md" }, initialRestorePaths: ["/repo"] }) },
      { window: window(true), state: state(["/repo"], 9) },
      { window: window(), state: state(["/repository"], 9) },
    ], "/repo")).toBeNull();
  });

  it("matches a window that is still restoring its folder", () => {
    const restoring = window();
    expect(findProjectWindowForFolder([
      { window: restoring, state: state([], 1, { initialRestorePaths: ["/repo"] }) },
    ], "/repo")).toBe(restoring);
  });
});
