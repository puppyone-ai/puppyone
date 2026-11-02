import { describe, expect, it } from "vitest";
import {
  createFileTarget,
  isFileModeFile,
  isIpcAllowedInFileMode,
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
    "workspace:create-preview-document",
    "terminal:create",
    "agent:session-create",
    "cloud-workspace:watch",
    "markdown-web-embed:create",
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
    ]) expect(allowed(channel)).toBe(true);
  });
});

describe("File Mode formats", () => {
  it.each(["a.md", "a.markdown", "A.MD", "/x/y/a.mdx"])("opens %s", (name) => {
    expect(isFileModeFile(name)).toBe(true);
  });

  it.each(["a.csv", "a.html", "a.htm", "a.pdf", "a.yaml", "a.png", "a"])("does not open %s yet", (name) => {
    expect(isFileModeFile(name)).toBe(false);
  });
});
