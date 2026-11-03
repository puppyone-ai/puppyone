import { describe, expect, it, vi } from "vitest";
import {
  askToSaveFile,
  createFileTarget,
  FILE_MODE_EXTENSIONS,
  isFileModeFile,
  isIpcAllowedInFileMode,
  watchBoundFile,
} from "../../../../electron/main/file-mode.mjs";

const target = createFileTarget("/Users/me/notes/plan.md");
const allowed = (channel, request) => isIpcAllowedInFileMode(target, channel, request);

describe("File Mode IPC gate", () => {
  it("leaves project windows untouched", () => {
    expect(isIpcAllowedInFileMode(null, "terminal:create", {})).toBe(true);
    expect(isIpcAllowedInFileMode(undefined, "workspace:delete-entry", { path: "a" })).toBe(true);
  });

  it("derives the root from the canonical file path", () => {
    expect(target).toEqual({
      path: "/Users/me/notes/plan.md",
      rootPath: "/Users/me/notes",
      name: "plan.md",
    });
  });

  it.each([
    "workspace:create-preview-document",
    "workspace:read-file",
    "workspace:resolve-node",
    "workspace:write-file",
  ])("limits %s to the bound file", (channel) => {
    expect(allowed(channel, { path: "plan.md" })).toBe(true);
    expect(allowed(channel, { path: "secret.md" })).toBe(false);
    expect(allowed(channel, { path: "sub/plan.md" })).toBe(false);
    expect(allowed(channel, { path: "../plan.md" })).toBe(false);
    expect(allowed(channel, {})).toBe(false);
    expect(allowed(channel, undefined)).toBe(false);
  });

  it("gives resource URLs to the bound file and to Markdown media only", () => {
    expect(allowed("workspace:get-file-url", { path: "plan.md", purpose: "file-preview" })).toBe(true);
    expect(allowed("workspace:get-file-url", { path: "images/a.png", purpose: "markdown-asset" })).toBe(true);
    expect(allowed("workspace:get-file-url", { path: "clip.mp4", purpose: "markdown-asset" })).toBe(true);
    expect(allowed("workspace:get-file-url", { path: "clip.mp3", purpose: "markdown-asset" })).toBe(true);
  });

  it("refuses resource URLs for anything else next to the file", () => {
    expect(allowed("workspace:get-file-url", { path: "secret.txt", purpose: "markdown-asset" })).toBe(false);
    expect(allowed("workspace:get-file-url", { path: ".env", purpose: "markdown-asset" })).toBe(false);
    expect(allowed("workspace:get-file-url", { path: "other.md", purpose: "markdown-asset" })).toBe(false);
    expect(allowed("workspace:get-file-url", { path: "image.png", purpose: "file-preview" })).toBe(false);
    expect(allowed("workspace:get-file-url", { path: 7, purpose: "markdown-asset" })).toBe(false);
    expect(allowed("workspace:get-file-url", undefined)).toBe(false);
  });

  it.each([
    "workspace:list-folder-children",
    "workspace:create-entry",
    "workspace:rename-entry",
    "workspace:move-entry",
    "workspace:copy-entry",
    "workspace:delete-entry",
    "workspace:import-entries",
    "workspace:watch-start",
    "workspace:git-status",
    "workspace:reveal-entry-in-finder",
    "workspace:open-entry-external",
    "terminal:create",
    "agent:session-create",
    "cloud-workspace:watch",
    "markdown-web-embed:create",
    "file-mode:open-folder",
    "made-up:channel",
  ])("refuses %s", (channel) => {
    expect(allowed(channel, { path: "plan.md" })).toBe(false);
  });

  it("keeps the channels the window itself needs", () => {
    for (const channel of [
      "window:get-initial-workspace",
      "localization:get-bootstrap",
      "platform:get-capabilities",
      "theme:list",
      "window-layout:set-chrome-profile",
      "appearance:set-window-background",
      "document-session:flush-result",
      "mermaid:render",
      "workspace:revoke-file-url",
      "system:open-external-url",
      "editor:markdown-format-active",
      "file-mode:set-edited",
      "native-surfaces:set-overlay-occluded",
    ]) expect(allowed(channel)).toBe(true);
  });
});

describe("File Mode formats", () => {
  it.each(["a.md", "a.markdown", "A.MD", "/x/y/a.mdx", "a.csv", "A.CSV", "a.html", "a.htm", "/x/y/A.HTML"])(
    "opens %s",
    (name) => expect(isFileModeFile(name)).toBe(true),
  );

  it.each(["a.pdf", "a.yaml", "a.png", "a", "a.xlsx", "a.tsv", "a.ejs", "a.jsp", "a.php", ".md", "/x/.csv"])(
    "does not open %s",
    (name) => expect(isFileModeFile(name)).toBe(false),
  );

  it("publishes one lowercase list without names a shorter extension already covers", () => {
    expect(FILE_MODE_EXTENSIONS).toEqual(expect.arrayContaining([".md", ".markdown", ".mdx", ".csv", ".html", ".htm"]));
    expect(FILE_MODE_EXTENSIONS).not.toContain(".agent.md");
    expect(FILE_MODE_EXTENSIONS).not.toContain(".ejs");
    for (const extension of FILE_MODE_EXTENSIONS) expect(extension).toBe(extension.toLowerCase());
    expect(isFileModeFile("/x/review.agent.md")).toBe(true);
  });
});

describe("watching the bound file", () => {
  const stats = (mtimeMs, size = 1, ino = 1) => ({ mtimeMs, size, ino });

  it("reports a change in content, size or identity, and stops on request", () => {
    let listener;
    const watchFile = vi.fn((_path, _options, callback) => { listener = callback; });
    const unwatchFile = vi.fn();
    const onChange = vi.fn();
    const stop = watchBoundFile("/x/plan.md", onChange, { watchFile, unwatchFile });

    expect(watchFile).toHaveBeenCalledWith("/x/plan.md", { interval: 500, persistent: false }, listener);
    listener(stats(1), stats(1));
    expect(onChange).not.toHaveBeenCalled();
    listener(stats(2), stats(1));
    listener(stats(2, 5), stats(2));
    // Saving through a temporary file and a rename replaces the inode.
    listener(stats(2, 5, 9), stats(2, 5, 1));
    expect(onChange).toHaveBeenCalledTimes(3);

    stop();
    expect(unwatchFile).toHaveBeenCalledWith("/x/plan.md", listener);
  });
});

describe("closing with unsaved edits", () => {
  const t = (id, values) => (values ? `${id}:${values.name}` : id);
  const ask = (response) => {
    const dialog = { showMessageBox: vi.fn(async () => ({ response })) };
    return { dialog, choice: askToSaveFile({ dialog, window: {}, name: "plan.md", t }) };
  };

  it.each([[0, "save"], [1, "discard"], [2, "cancel"], [9, "cancel"]])("maps button %i to %s", async (response, expected) => {
    await expect(ask(response).choice).resolves.toBe(expected);
  });

  it("names the file and treats dismissing the dialog as cancel", async () => {
    const { dialog, choice } = ask(0);
    await choice;
    expect(dialog.showMessageBox).toHaveBeenCalledWith({}, expect.objectContaining({
      message: "native.fileClose.message:plan.md",
      defaultId: 0,
      cancelId: 2,
      buttons: ["native.fileClose.save", "native.fileClose.discard", "native.fileClose.cancel"],
    }));
  });
});
