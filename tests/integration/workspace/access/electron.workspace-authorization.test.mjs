import * as fs from "node:fs";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAppPreviewIpcHandlers } from "../../../../electron/main/ipc/app-preview-ipc.mjs";
import { registerTerminalIpcHandlers } from "../../../../electron/main/ipc/terminal-ipc.mjs";
import { registerLocalAgentInstallationIpcHandlers } from "../../../../electron/main/ipc/local-agent-installation-ipc.mjs";
import { registerWorkspaceGitIpcHandlers } from "../../../../electron/main/ipc/workspace-git-ipc.mjs";
import { registerWorkspaceNavigationIpcHandlers } from "../../../../electron/main/ipc/workspace-navigation-ipc.mjs";
import { registerWorkspaceWatchIpcHandlers } from "../../../../electron/main/ipc/workspace-watch-ipc.mjs";
import { registerGitMetadataWatchIpcHandlers } from "../../../../electron/main/ipc/git-metadata-watch-ipc.mjs";
import { createTerminalService } from "../../../../electron/main/terminal-service.mjs";
import {
  createSenderWorkspaceAuthorization,
  resolveCanonicalWorkspaceDirectory,
} from "../../../../electron/main/workspace-authorization.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";

let root;
let otherRoot;
let thirdRoot;
let unassignedRoot;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "puppyone-auth-root-"));
  otherRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-auth-other-"));
  thirdRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-auth-third-"));
  unassignedRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-auth-unassigned-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(otherRoot, { recursive: true, force: true });
  await rm(thirdRoot, { recursive: true, force: true });
  await rm(unassignedRoot, { recursive: true, force: true });
});

describe("sender-bound workspace authorization", () => {
  it("authorizes any explicitly requested Root in a sender capability set", async () => {
    let assignedRoots = [root, otherRoot];
    const authorize = createSenderWorkspaceAuthorization({
      fsModule: fs,
      getWorkspaceRootsForSender: () => assignedRoots,
    });

    await expect(authorize({ sender: { id: 1 } }, root))
      .resolves.toBe(await fs.promises.realpath(root));
    await expect(authorize({ sender: { id: 1 } }, otherRoot))
      .resolves.toBe(await fs.promises.realpath(otherRoot));
    await expect(authorize({ sender: { id: 1 } }))
      .rejects.toThrow(/explicit|multiple/i);

    assignedRoots = [root];
    await expect(authorize({ sender: { id: 1 } }, otherRoot))
      .rejects.toThrow(/does not match/i);
  });

  it.each([2, 3])(
    "starts %i Terminals against their explicit Folders when several Roots are attached",
    async (terminalCount) => {
      const { ipcMain, handlers } = createIpcHarness();
      const attachedRoots = [root, otherRoot, thirdRoot].slice(0, terminalCount);
      const authorizeWorkspaceRoot = createSenderWorkspaceAuthorization({
        fsModule: fs,
        getWorkspaceRootsForSender: () => attachedRoots,
      });
      const terminalService = {
        create: vi.fn(async (_sender, request) => ({ id: request.id, shell: "/bin/zsh" })),
        input: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
      };
      registerTerminalIpcHandlers({
        ipcMain,
        terminalService,
        authorizeWorkspaceRoot,
      });
      const event = { sender: { id: 3 } };
      const requests = attachedRoots.map((workspaceRoot, index) => ({
        id: `terminal-multi-root-${index + 1}`,
        rootPath: workspaceRoot,
        cwd: workspaceRoot,
        cols: 80 + index,
        rows: 24 + index,
        launcherId: index % 2 === 0 ? "codex" : "shell",
      }));

      await expect(Promise.all(requests.map((request) => (
        handlers.get("terminal:create")(event, request)
      )))).resolves.toEqual(requests.map(({ id }) => ({ id, shell: "/bin/zsh" })));
      expect(terminalService.create).toHaveBeenCalledTimes(terminalCount);
      for (const [index, request] of requests.entries()) {
        expect(terminalService.create).toHaveBeenCalledWith(
          event.sender,
          request,
          await fs.promises.realpath(attachedRoots[index]),
        );
      }
    },
  );

  it.each([2, 3])(
    "rejects an ambiguous Terminal request before process creation with %i attached Roots",
    async (rootCount) => {
      const { ipcMain, handlers } = createIpcHarness();
      const terminalService = {
        create: vi.fn(),
        input: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
      };
      registerTerminalIpcHandlers({
        ipcMain,
        terminalService,
        authorizeWorkspaceRoot: createSenderWorkspaceAuthorization({
          fsModule: fs,
          getWorkspaceRootsForSender: () => [root, otherRoot, thirdRoot].slice(0, rootCount),
        }),
      });

      await expect(handlers.get("terminal:create")(
        { sender: { id: 4 } },
        { id: "terminal-ambiguous", cwd: root, cols: 80, rows: 24 },
      )).rejects.toThrow(/explicit|multiple/i);
      expect(terminalService.create).not.toHaveBeenCalled();
    },
  );

  it.each([2, 3])(
    "rejects an unassigned explicit Folder before process creation with %i attached Roots",
    async (rootCount) => {
      const { ipcMain, handlers } = createIpcHarness();
      const terminalService = {
        create: vi.fn(),
        input: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
      };
      registerTerminalIpcHandlers({
        ipcMain,
        terminalService,
        authorizeWorkspaceRoot: createSenderWorkspaceAuthorization({
          fsModule: fs,
          getWorkspaceRootsForSender: () => [root, otherRoot, thirdRoot].slice(0, rootCount),
        }),
      });

      await expect(handlers.get("terminal:create")(
        { sender: { id: 5 } },
        {
          id: "terminal-unassigned",
          rootPath: unassignedRoot,
          cwd: unassignedRoot,
          cols: 80,
          rows: 24,
        },
      )).rejects.toThrow(/does not match/i);
      expect(terminalService.create).not.toHaveBeenCalled();
    },
  );

  it("canonicalizes the assigned root, accepts only an alias of that root, and rejects no-workspace senders", async () => {
    const aliasParent = await mkdtemp(path.join(os.tmpdir(), "puppyone-auth-alias-"));
    const aliasPath = path.join(aliasParent, "workspace");
    await symlink(root, aliasPath, "dir");
    try {
      const authorize = createSenderWorkspaceAuthorization({
        fsModule: fs,
        getWorkspaceRootForSender: () => root,
      });
      await expect(authorize({ sender: { id: 1 } }, aliasPath)).resolves.toBe(await fs.promises.realpath(root));
      await expect(authorize({ sender: { id: 1 } }, otherRoot)).rejects.toThrow(/does not match/i);

      const authorizeWithoutWorkspace = createSenderWorkspaceAuthorization({
        fsModule: fs,
        getWorkspaceRootForSender: () => null,
      });
      await expect(authorizeWithoutWorkspace({ sender: { id: 2 } }, root)).rejects.toThrow(/no local workspace/i);
    } finally {
      await rm(aliasParent, { recursive: true, force: true });
    }
  });

  it("realpaths working directories and rejects a symlink escaping the workspace", async () => {
    const inside = path.join(root, "app");
    const escape = path.join(root, "escape");
    await mkdir(inside);
    await symlink(otherRoot, escape, "dir");

    await expect(resolveCanonicalWorkspaceDirectory(root, inside, {
      fsModule: fs,
      label: "App preview cwd",
    })).resolves.toBe(await fs.promises.realpath(inside));
    await expect(resolveCanonicalWorkspaceDirectory(root, escape, {
      fsModule: fs,
      label: "App preview cwd",
    })).rejects.toThrow(/inside the assigned workspace/i);
  });

  it("blocks an arbitrary root across Git, watch, AI review, App Preview, and terminal create", async () => {
    const { ipcMain, handlers } = createIpcHarness();
    const authorizeWorkspaceRoot = createSenderWorkspaceAuthorization({
      fsModule: fs,
      getWorkspaceRootForSender: () => root,
    });
    const appPreviewRuntime = {
      start: vi.fn(),
      restart: vi.fn(),
      stop: vi.fn(),
      getLogs: vi.fn(),
      openExternal: vi.fn(),
    };
    const workspaceWatchService = { start: vi.fn(), stop: vi.fn() };
    const gitMetadataWatchService = { start: vi.fn(), stop: vi.fn(), stopForWindow: vi.fn(), closeAll: vi.fn() };
    const terminalService = {
      create: vi.fn(),
      input: vi.fn(),
      resize: vi.fn(),
      appearance: vi.fn(),
      close: vi.fn(),
    };

    registerWorkspaceGitIpcHandlers({
      ipcMain,
      BrowserWindow: { fromWebContents: () => null },
      dialog: { showMessageBox: vi.fn() },
      authorizeWorkspaceRoot,
    });
    registerWorkspaceWatchIpcHandlers({ ipcMain, workspaceWatchService, authorizeWorkspaceRoot });
    registerGitMetadataWatchIpcHandlers({ ipcMain, gitMetadataWatchService, authorizeWorkspaceRoot });
    registerAppPreviewIpcHandlers({ ipcMain, appPreviewRuntime, authorizeWorkspaceRoot });
    registerTerminalIpcHandlers({
      ipcMain,
      terminalService,
      authorizeWorkspaceRoot,
    });

    const event = { sender: { id: 7 } };
    for (const [channel, request] of [
      ["workspace:git-status", { rootPath: otherRoot }],
      ["workspace:git-push-commit-to-remote", {
        rootPath: otherRoot,
        remoteName: "puppyone",
        destinationBranch: "main",
        expectedHeadCommitId: "0123456789abcdef0123456789abcdef01234567",
        expectedBranch: "main",
      }],
      ["workspace:git-file-diff", { rootPath: otherRoot, path: "report.docx", scope: "unstaged" }],
      ["workspace:watch-start", { rootPath: otherRoot }],
      ["git-repository:watch-start", { rootPath: otherRoot }],
      ["ai-edit-review:get-latest", { rootPath: otherRoot }],
      ["app-preview:start", { rootPath: otherRoot, path: "app.puppyoneapp" }],
      ["terminal:create", { rootPath: otherRoot, cwd: otherRoot }],
    ]) {
      await expect(handlers.get(channel)(event, request)).rejects.toThrow(/does not match/i);
    }

    expect(workspaceWatchService.start).not.toHaveBeenCalled();
    expect(appPreviewRuntime.start).not.toHaveBeenCalled();
    expect(terminalService.create).not.toHaveBeenCalled();
  });

  it("passes the canonical root to App Preview and the sender to terminal mutations", async () => {
    const { ipcMain, handlers, listeners } = createIpcHarness();
    const authorizeWorkspaceRoot = createSenderWorkspaceAuthorization({
      fsModule: fs,
      getWorkspaceRootForSender: () => root,
    });
    const appPreviewRuntime = {
      start: vi.fn(async () => ({ status: "running" })),
      restart: vi.fn(),
      stop: vi.fn(),
      getLogs: vi.fn(),
      openExternal: vi.fn(),
    };
    const terminalService = {
      create: vi.fn(),
      input: vi.fn(),
      resize: vi.fn(),
      appearance: vi.fn(),
      close: vi.fn(),
    };
    const installationService = {
      discover: vi.fn(async () => ({
        schemaVersion: 1,
        generation: 1,
        scanId: "local-agent-scan:1",
        availableAgentIds: ["codex"],
        requestedAt: "2026-08-15T00:00:00.000Z",
        completedAt: "2026-08-15T00:00:00.001Z",
        results: [{ agentId: "codex", displayName: "Codex", status: "found", source: "fixture" }],
        source: "scan",
      })),
    };
    registerAppPreviewIpcHandlers({ ipcMain, appPreviewRuntime, authorizeWorkspaceRoot });
    registerTerminalIpcHandlers({
      ipcMain,
      terminalService,
      authorizeWorkspaceRoot,
    });
    registerLocalAgentInstallationIpcHandlers({ ipcMain, installationService });

    const sender = { id: 8, send: vi.fn() };
    const event = { sender };
    await handlers.get("local-agent-installation:discover")(event, {
      refresh: true,
      requestId: "local-agent-installation:test",
    });
    expect(installationService.discover).toHaveBeenCalledWith({
      refresh: true,
      onProgress: expect.any(Function),
    });
    installationService.discover.mock.calls[0][0].onProgress({
      availableAgentIds: ["codex"],
      completedAgentCount: 1,
      generation: 1,
      results: [{ agentId: "codex", displayName: "Codex", status: "found", source: "fixture" }],
      scanId: "local-agent-scan:1",
      totalAgentCount: 6,
    });
    expect(sender.send).toHaveBeenCalledWith("local-agent-installation:progress", {
      availableAgentIds: ["codex"],
      completedAgentCount: 1,
      generation: 1,
      requestId: "local-agent-installation:test",
      results: [{ agentId: "codex", displayName: "Codex", status: "found", source: "fixture" }],
      scanId: "local-agent-scan:1",
      totalAgentCount: 6,
    });
    await handlers.get("app-preview:start")(event, { rootPath: root, path: "app.puppyoneapp" });
    expect(appPreviewRuntime.start).toHaveBeenCalledWith(sender, {
      rootPath: await fs.promises.realpath(root),
      path: "app.puppyoneapp",
    });

    listeners.get("terminal:input")(event, { id: "terminal-1", data: "pwd\n" });
    listeners.get("terminal:resize")(event, { id: "terminal-1", cols: 100, rows: 40 });
    listeners.get("terminal:appearance")(event, {
      id: "terminal-1",
      defaultColors: {
        foreground: [209, 206, 198],
        background: [22, 20, 19],
      },
    });
    await handlers.get("terminal:close")(event, "terminal-1");
    expect(terminalService.input).toHaveBeenCalledWith(sender, { id: "terminal-1", data: "pwd\n" });
    expect(terminalService.resize).toHaveBeenCalledWith(sender, { id: "terminal-1", cols: 100, rows: 40 });
    expect(terminalService.appearance).toHaveBeenCalledWith(sender, {
      id: "terminal-1",
      defaultColors: {
        foreground: [209, 206, 198],
        background: [22, 20, 19],
      },
    });
    expect(terminalService.close).toHaveBeenCalledWith(sender, "terminal-1");
  });
});

describe("recent workspace authorization", () => {
  it("allows open-current/open-new only for main-persisted recent paths", async () => {
    const stateStore = createWorkspaceStateStore({
      app: { getPath: () => root },
      filename: "workspace-state-test.json",
      canonicalizeWorkspacePath: (value) => fs.promises.realpath(path.resolve(value)),
      workspaceFromPath: async (value) => ({ path: value, name: path.basename(value) }),
      logger: { warn: vi.fn() },
    });
    await stateStore.rememberRecentWorkspacePath(root);

    const { ipcMain, handlers } = createIpcHarness();
    const openWorkspaceInCurrentWindow = vi.fn(async () => ({ status: "opened-current" }));
    const openWorkspaceInNewWindow = vi.fn(async () => ({ status: "opened-new" }));
    const createProjectForCurrentWindow = vi.fn(async () => ({ status: "created-current" }));
    const cloneRepositoryForCurrentWindow = vi.fn(async () => ({ status: "cloned-current" }));
    const selectProjectLocationForCurrentWindow = vi.fn(async () => ({
      grantId: "location-1",
      path: root,
    }));
    const getDefaultProjectLocationForCurrentWindow = vi.fn(async () => ({
      grantId: "default-1",
      path: path.join(root, "PuppyOne"),
    }));
    const selectWorkspaceForCurrentComposition = vi.fn(async () => ({
      status: "attached-current",
      workspaces: [],
    }));
    registerWorkspaceNavigationIpcHandlers({
      ipcMain,
      workspaceStateStore: stateStore,
      getInitialWorkspaceResultForWindow: vi.fn(),
      forgetCurrentWindowWorkspace: vi.fn(),
      showHomepageForCurrentWindow: vi.fn(),
      openWorkspaceInCurrentWindow,
      openWorkspaceInNewWindow,
      createProjectForCurrentWindow,
      cloneRepositoryForCurrentWindow,
      selectProjectLocationForCurrentWindow,
      getDefaultProjectLocationForCurrentWindow,
      createCloudWorkspaceFromRequest: vi.fn(),
      openVirtualWorkspaceInNewWindow: vi.fn(),
      selectWorkspaceForCurrentWindow: vi.fn(),
      selectWorkspaceForCurrentComposition,
      selectWorkspaceForNewWindow: vi.fn(),
    });

    const event = { sender: { id: 9 } };
    await expect(handlers.get("workspace:open-current")(event, otherRoot)).rejects.toThrow(/recent workspace list/i);
    await expect(handlers.get("workspace:open-new-window")(event, otherRoot)).rejects.toThrow(/recent workspace list/i);
    expect(openWorkspaceInCurrentWindow).not.toHaveBeenCalled();
    expect(openWorkspaceInNewWindow).not.toHaveBeenCalled();

    await expect(handlers.get("workspace:open-current")(event, root)).resolves.toEqual({ status: "opened-current" });
    expect(openWorkspaceInCurrentWindow).toHaveBeenCalledWith(event.sender, await fs.promises.realpath(root));

    await expect(handlers.get("workspace:rename-recent")(event, {
      folderPath: otherRoot,
      name: "Blocked",
    })).rejects.toThrow(/recent workspace list/i);
    await expect(handlers.get("workspace:rename-recent")(event, {
      folderPath: root,
      name: "Renamed project",
    })).resolves.toEqual({
      ok: true,
      renamed: true,
      path: await fs.promises.realpath(root),
      name: "Renamed project",
    });

    await expect(handlers.get("workspace:remove-recent")(event, otherRoot)).rejects.toThrow(/recent workspace list/i);
    await expect(handlers.get("workspace:remove-recent")(event, root)).resolves.toEqual({
      ok: true,
      removed: true,
      path: await fs.promises.realpath(root),
    });
    await expect(handlers.get("workspace:open-current")(event, root)).rejects.toThrow(/recent workspace list/i);

    await expect(handlers.get("workspace:open-dropped-current")(event, otherRoot)).resolves.toEqual({ status: "opened-current" });
    expect(openWorkspaceInCurrentWindow).toHaveBeenCalledWith(event.sender, otherRoot);
    await expect(handlers.get("workspace:open-dropped-current")(event, "  ")).rejects.toThrow(/path is required/i);

    await expect(handlers.get("workspace:select-project-location-current")(event))
      .resolves.toEqual({ grantId: "location-1", path: root });
    expect(selectProjectLocationForCurrentWindow).toHaveBeenCalledWith(event.sender);
    // The default location is issued by the main process without a picker, but it
    // still flows through the same grant model as a browsed folder.
    await expect(handlers.get("workspace:default-project-location-current")(event))
      .resolves.toEqual({ grantId: "default-1", path: path.join(root, "PuppyOne") });
    expect(getDefaultProjectLocationForCurrentWindow).toHaveBeenCalledWith(event.sender);
    await expect(handlers.get("workspace:select-folder-attach")(event))
      .resolves.toEqual({ status: "attached-current", workspaces: [] });
    expect(selectWorkspaceForCurrentComposition).toHaveBeenCalledWith(event.sender);
    await expect(handlers.get("workspace:create-project-current")(event, {
      name: "Notes",
      locationGrantId: "location-1",
    }))
      .resolves.toEqual({ status: "created-current" });
    expect(createProjectForCurrentWindow).toHaveBeenCalledWith(event.sender, {
      name: "Notes",
      locationGrantId: "location-1",
    });
    await expect(handlers.get("workspace:clone-repository-current")(event, {
      provider: "github",
      repositoryUrl: "https://github.com/owner/repository.git",
    })).resolves.toEqual({ status: "cloned-current" });
    expect(cloneRepositoryForCurrentWindow).toHaveBeenCalledWith(event.sender, {
      provider: "github",
      repositoryUrl: "https://github.com/owner/repository.git",
    });
    expect(handlers.has("workspace:remember-last")).toBe(false);
    expect(handlers.has("workspace:from-path")).toBe(false);
  });
});

describe("terminal session ownership", () => {
  it.each([2, 3])(
    "rejects a Terminal cwd from a sibling Folder with %i attached Roots before PTY spawn",
    async (rootCount) => {
      const ptyService = { spawn: vi.fn() };
      const terminalService = createTerminalService({
        appVersion: "test",
        initializeWorkspaceEditReview: vi.fn(async () => undefined),
        ptyService,
        logger: { warn: vi.fn() },
      });
      const { ipcMain, handlers } = createIpcHarness();
      registerTerminalIpcHandlers({
        ipcMain,
        terminalService,
        authorizeWorkspaceRoot: createSenderWorkspaceAuthorization({
          fsModule: fs,
          getWorkspaceRootsForSender: () => [root, otherRoot, thirdRoot].slice(0, rootCount),
        }),
      });

      await expect(handlers.get("terminal:create")(
        { sender: createSender(18) },
        {
          id: "terminal-cross-root-cwd",
          rootPath: root,
          cwd: otherRoot,
          cols: 80,
          rows: 24,
          launcherId: "shell",
        },
      )).rejects.toThrow(/inside the assigned workspace/i);
      expect(ptyService.spawn).not.toHaveBeenCalled();
      expect(terminalService.getSessionCount()).toBe(0);
    },
  );

  it.each([2, 3])(
    "keeps %i concurrent Terminal sessions independently addressable for one window",
    async (terminalCount) => {
      const terminals = [];
      const initializeWorkspaceEditReview = vi.fn(async () => undefined);
      const ptyService = {
        spawn: vi.fn(() => {
          const terminal = createFakeTerminal();
          terminals.push(terminal);
          return terminal;
        }),
      };
      const service = createTerminalService({
        appVersion: "test",
        initializeWorkspaceEditReview,
        ptyService,
        logger: { warn: vi.fn() },
      });
      const owner = createSender(19);
      const workspaceRoots = [root, otherRoot, root].slice(0, terminalCount);

      for (let index = 0; index < terminalCount; index += 1) {
        await expect(service.create(owner, {
          id: `terminal-concurrent-${index + 1}`,
          cwd: workspaceRoots[index],
          cols: 80 + index,
          rows: 24 + index,
          launcherId: "shell",
        }, workspaceRoots[index])).resolves.toMatchObject({
          id: `terminal-concurrent-${index + 1}`,
          cwd: await fs.promises.realpath(workspaceRoots[index]),
        });
      }

      expect(service.getSessionCount()).toBe(terminalCount);
      expect(ptyService.spawn).toHaveBeenCalledTimes(terminalCount);
      expect(initializeWorkspaceEditReview).toHaveBeenCalledTimes(terminalCount);
      for (let index = 0; index < terminalCount; index += 1) {
        const id = `terminal-concurrent-${index + 1}`;
        expect(ptyService.spawn.mock.calls[index][2]).toMatchObject({
          cwd: await fs.promises.realpath(workspaceRoots[index]),
          cols: 80 + index,
          rows: 24 + index,
        });
        expect(service.input(owner, { id, data: `echo ${index + 1}\n` })).toBe(true);
        expect(service.resize(owner, { id, cols: 100 + index, rows: 40 + index })).toBe(true);
        expect(terminals[index].write).toHaveBeenCalledWith(`echo ${index + 1}\n`);
        expect(terminals[index].resize).toHaveBeenCalledWith(100 + index, 40 + index);
      }

      await service.closeSessionsForWindow(owner.id);
      expect(service.getSessionCount()).toBe(0);
      expect(terminals.every(({ kill }) => kill.mock.calls.length === 1)).toBe(true);
    },
  );

  it("closes two sessions for one Workspace Folder without touching a third in a sibling Root", async () => {
    const terminals = [];
    const service = createTerminalService({
      appVersion: "test",
      initializeWorkspaceEditReview: vi.fn(async () => undefined),
      ptyService: {
        spawn: vi.fn(() => {
          const terminal = createFakeTerminal();
          terminals.push(terminal);
          return terminal;
        }),
      },
      logger: { warn: vi.fn() },
    });
    const owner = createSender(20);
    await service.create(owner, { id: "root-a-1", cwd: root }, root);
    await service.create(owner, { id: "root-a-2", cwd: root }, root);
    await service.create(owner, { id: "root-b", cwd: otherRoot }, otherRoot);

    expect(await service.closeSessionsForWorkspaceRoot(owner.id, root)).toBe(2);
    expect(terminals[0].kill).toHaveBeenCalledOnce();
    expect(terminals[1].kill).toHaveBeenCalledOnce();
    expect(terminals[2].kill).not.toHaveBeenCalled();
    expect(service.getSessionCount()).toBe(1);
    await service.closeAll();
  });

  it("requires a workspace and prevents another sender from input, resize, close, or id replacement", async () => {
    const terminals = [];
    const ptyService = {
      spawn: vi.fn(() => {
        const terminal = createFakeTerminal();
        terminals.push(terminal);
        return terminal;
      }),
    };
    const service = createTerminalService({
      appVersion: "test",
      initializeWorkspaceEditReview: vi.fn(async () => undefined),
      ptyService,
      logger: { warn: vi.fn() },
    });
    const owner = createSender(21);
    const attacker = createSender(22);
    const request = { id: "terminal_owner_1", cwd: root, cols: 80, rows: 24 };

    await expect(service.create(owner, request, null)).rejects.toThrow(/no local workspace/i);
    await expect(service.create(owner, request, root)).resolves.toMatchObject({ id: "terminal_owner_1" });
    expect(ptyService.spawn).toHaveBeenCalledOnce();

    expect(service.input(attacker, { id: request.id, data: "rm -rf ~\n" })).toBe(false);
    expect(service.resize(attacker, { id: request.id, cols: 120, rows: 60 })).toBe(false);
    await expect(service.close(attacker, request.id)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(terminals[0].write).not.toHaveBeenCalled();
    expect(terminals[0].resize).not.toHaveBeenCalled();
    expect(terminals[0].kill).not.toHaveBeenCalled();
    await expect(service.create(attacker, request, root)).rejects.toThrow(/owned by another window/i);

    expect(service.input(owner, { id: request.id, data: "pwd\n" })).toBe(true);
    expect(service.resize(owner, { id: request.id, cols: 100, rows: 40 })).toBe(true);
    expect(await service.close(owner, request.id)).toBe(true);
    expect(terminals[0].write).toHaveBeenCalledWith("pwd\n");
    expect(terminals[0].resize).toHaveBeenCalledWith(100, 40);
    expect(terminals[0].kill).toHaveBeenCalledOnce();
  });
});

function createIpcHarness() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    ipcMain: {
      handle: (channel, listener) => handlers.set(channel, listener),
      on: (channel, listener) => listeners.set(channel, listener),
    },
  };
}

function createFakeTerminal() {
  let exit;
  return {
    pid: 123,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => exit?.({ exitCode: 0, signal: 15 })),
    onData: vi.fn(),
    onExit: vi.fn((listener) => { exit = listener; }),
  };
}

function createSender(id) {
  return {
    id,
    isDestroyed: () => false,
    send: vi.fn(),
  };
}
