import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createDesktopLaunchIntent,
  findWorkspacePathArg,
  handleSecondInstanceLaunch,
  parseDesktopLaunchIntent,
} from "../../../../electron/main/desktop-launch-intent.mjs";

const workingDirectory = path.resolve("/tmp", "puppyone-launch-tests");
const workspacePath = path.join(workingDirectory, "workspace");

describe("Desktop launch intent", () => {

  it("does not mistake Electron's development app entry for a workspace", () => {
    const statSync = vi.fn(() => ({ isDirectory: () => true }));

    const intent = createDesktopLaunchIntent({
      argv: ["/Applications/Electron", ".", "--inspect=0"],
      workingDirectory,
      isPackaged: false,
      statSync,
    });

    expect(intent).toEqual({ version: 1, workspacePath: null });
    expect(statSync).not.toHaveBeenCalled();
  });

  it("resolves an explicit development CLI workspace before acquiring the instance lock", () => {
    const statSync = vi.fn((candidate) => ({
      isDirectory: () => candidate === workspacePath,
    }));

    const intent = createDesktopLaunchIntent({
      argv: ["/Applications/Electron", ".", "./workspace"],
      workingDirectory,
      isPackaged: false,
      statSync,
    });

    expect(intent).toEqual({ version: 1, workspacePath });
  });

  it("ignores malformed, flag, file, and missing arguments without throwing", () => {
    const statSync = vi.fn((candidate) => {
      if (candidate.endsWith("file.md")) return { isDirectory: () => false };
      throw new Error("missing");
    });

    expect(findWorkspacePathArg(
      [null, "", "--flag", "missing", "file.md"],
      { workingDirectory, statSync },
    )).toBeNull();
  });

  it("accepts only a versioned absolute-path payload", () => {
    expect(parseDesktopLaunchIntent({ version: 1, workspacePath })).toEqual({
      version: 1,
      workspacePath,
    });
    expect(parseDesktopLaunchIntent({ version: 1, workspacePath: null })).toEqual({
      version: 1,
      workspacePath: null,
    });
    expect(parseDesktopLaunchIntent({ version: 1, workspacePath: "./relative" })).toBeNull();
    expect(parseDesktopLaunchIntent({ version: 2, workspacePath })).toBeNull();
    expect(parseDesktopLaunchIntent(null)).toBeNull();
  });

  it("uses the structured lock payload instead of Chromium-mutated argv", async () => {
    const openWorkspaceInNewWindow = vi.fn(async () => undefined);
    const revealOrCreateWindow = vi.fn(async () => undefined);

    const result = await handleSecondInstanceLaunch({
      launchIntent: { version: 1, workspacePath },
      argv: ["/Applications/Electron", ".", "--original-process-start-time=123"],
      workingDirectory,
      isPackaged: false,
      openWorkspaceInNewWindow,
      revealOrCreateWindow,
    });

    expect(result).toEqual({ status: "opened-workspace", workspacePath });
    expect(openWorkspaceInNewWindow).toHaveBeenCalledWith(workspacePath);
    expect(revealOrCreateWindow).not.toHaveBeenCalled();
  });

  it("reveals the primary window when the second launch has no workspace", async () => {
    const revealOrCreateWindow = vi.fn(async () => undefined);

    const result = await handleSecondInstanceLaunch({
      launchIntent: { version: 1, workspacePath: null },
      openWorkspaceInNewWindow: vi.fn(),
      revealOrCreateWindow,
    });

    expect(result).toEqual({ status: "revealed-window", workspacePath: null });
    expect(revealOrCreateWindow).toHaveBeenCalledOnce();
  });

  it("falls back to the primary window when opening a requested workspace fails", async () => {
    const openError = new Error("workspace unavailable");
    const reportError = vi.fn();
    const revealOrCreateWindow = vi.fn(async () => undefined);

    const result = await handleSecondInstanceLaunch({
      launchIntent: { version: 1, workspacePath },
      openWorkspaceInNewWindow: vi.fn(async () => {
        throw openError;
      }),
      revealOrCreateWindow,
      reportError,
    });

    expect(result).toEqual({ status: "recovered-window", workspacePath });
    expect(revealOrCreateWindow).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      "Unable to open the workspace requested by a second puppyone instance:",
      openError,
    );
  });

  it("contains both fallback and logging failures instead of rejecting", async () => {
    const result = await handleSecondInstanceLaunch({
      launchIntent: { version: 1, workspacePath: null },
      openWorkspaceInNewWindow: vi.fn(),
      revealOrCreateWindow: () => {
        throw new Error("window failed");
      },
      reportError: () => {
        throw new Error("logging failed");
      },
    });

    expect(result).toEqual({ status: "ignored-error", workspacePath: null });
  });
});
