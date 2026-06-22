import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pty from "node-pty";
import {
  checkoutWorkspaceGitBranch,
  commitAndCheckoutWorkspaceGitBranch,
  commitWorkspaceGit,
  createWorkspaceEntry,
  createWorkspaceGitBranch,
  deleteWorkspaceEntry,
  discardWorkspaceGitPaths,
  fetchWorkspaceGit,
  getWorkspaceGitFileDiff,
  getWorkspaceGitCommitDetail,
  getWorkspaceGitStatus,
  getMimeType,
  initializeWorkspaceGitRepository,
  listFolderChildren,
  pullWorkspaceGit,
  pushWorkspaceGit,
  readWorkspaceTextFile,
  readWorkspaceFile,
  renameWorkspaceEntry,
  stageWorkspaceGitPaths,
  stashAndCheckoutWorkspaceGitBranch,
  unstageWorkspaceGitPaths,
  writeWorkspaceTextFile,
  workspaceFromPath,
} from "../local-api/workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.cjs");
const rendererDistPath = path.join(projectRoot, "dist", "index.html");
const appName = "puppyone";
const appIconPath = resolveAppIconPath();
const devServerUrl = process.env.PUPPYONE_DESKTOP_DEV_URL;
const workspaceStateFilename = "desktop-workspace-state.json";
const macTitlebarOptions = process.platform === "darwin"
  ? {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 13, y: 13 },
    }
  : {
      titleBarStyle: "default",
    };

protocol.registerSchemesAsPrivileged([
  {
    scheme: "puppyone-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow = null;
const terminalSessions = new Map();
const workspaceWatchers = new Map();

app.setName(appName);
if (process.platform === "win32") {
  app.setAppUserModelId("ai.puppyone.desktop");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0);
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    revealMainWindow();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 920,
    minHeight: 640,
    center: true,
    show: false,
    title: appName,
    ...(appIconPath ? { icon: appIconPath } : {}),
    backgroundColor: "#f1eadf",
    ...macTitlebarOptions,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  mainWindow.once("ready-to-show", () => {
    revealMainWindow();
  });

  mainWindow.webContents.once("did-finish-load", () => {
    revealMainWindow();
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("puppyone renderer failed to load:", {
      errorCode,
      errorDescription,
      validatedURL,
    });
    revealMainWindow();
  });

  try {
    if (devServerUrl) {
      await mainWindow.loadURL(devServerUrl);
      mainWindow.webContents.openDevTools({ mode: "detach" });
    } else {
      await mainWindow.loadFile(rendererDistPath);
    }
  } catch (error) {
    console.error("puppyone failed to open renderer:", error);
    revealMainWindow();
  }

  revealMainWindow();

  mainWindow.on("closed", () => {
    closeAllTerminalSessions();
    closeAllWorkspaceWatchers();
    mainWindow = null;
  });

  return mainWindow;
}

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wasVisible = mainWindow.isVisible();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!wasVisible) {
    mainWindow.show();
    mainWindow.center();
  }
  mainWindow.focus();
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
}

function createOrRevealWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    revealMainWindow();
    return;
  }
  void createWindow();
}

function resolveAppIconPath() {
  const candidates = [
    path.join(projectRoot, "dist", "logo-square.png"),
    path.join(projectRoot, "public", "logo-square.png"),
    path.join(process.resourcesPath ?? projectRoot, "icon.icns"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function setDockIcon() {
  if (!appIconPath) return;
  try {
    app.dock.setIcon(appIconPath);
  } catch (error) {
    console.warn("Unable to set puppyone dock icon:", error);
  }
}

app.on("second-instance", () => {
  createOrRevealWindow();
});

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) {
    setDockIcon();
  }

  registerLocalFileProtocol();
  registerIpcHandlers();
  await createWindow();

  app.on("activate", () => {
    createOrRevealWindow();
  });
}).catch((error) => {
  console.error("puppyone failed to start:", error);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpcHandlers() {
  ipcMain.handle("workspace:get-last", async () => {
    return getLastWorkspaceResult();
  });

  ipcMain.handle("workspace:remember-last", async (_event, folderPath) => {
    if (typeof folderPath !== "string" || folderPath.trim().length === 0) {
      throw new Error("Folder path is required.");
    }
    await rememberLastWorkspacePath(folderPath);
    return { ok: true };
  });

  ipcMain.handle("workspace:forget-last", async () => {
    await forgetLastWorkspacePath();
    return { ok: true };
  });

  ipcMain.handle("workspace:select-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open local puppyone workspace",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    const workspace = await workspaceFromPath(result.filePaths[0]);
    await rememberLastWorkspacePath(workspace.path);
    return workspace;
  });

  ipcMain.handle("workspace:from-path", async (_event, folderPath) => {
    if (typeof folderPath !== "string" || folderPath.trim().length === 0) {
      throw new Error("Folder path is required.");
    }
    return workspaceFromPath(folderPath);
  });

  ipcMain.handle("workspace:list-folder-children", async (_event, request) => {
    const rootPath = request?.rootPath;
    const folderPath = request?.folderPath ?? null;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    return listFolderChildren(rootPath, folderPath);
  });

  ipcMain.handle("workspace:read-file", async (_event, request) => {
    const rootPath = request?.rootPath;
    const filePath = request?.path;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("File path is required.");
    }
    return readWorkspaceTextFile(rootPath, filePath);
  });

  ipcMain.handle("workspace:write-file", async (_event, request) => {
    const rootPath = request?.rootPath;
    const filePath = request?.path;
    const content = request?.content;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("File path is required.");
    }
    await writeWorkspaceTextFile(rootPath, filePath, content);
  });

  ipcMain.handle("workspace:create-entry", async (_event, request) => {
    const rootPath = request?.rootPath;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    return createWorkspaceEntry(rootPath, request);
  });

  ipcMain.handle("workspace:rename-entry", async (_event, request) => {
    const rootPath = request?.rootPath;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    return renameWorkspaceEntry(rootPath, request);
  });

  ipcMain.handle("workspace:delete-entry", async (_event, request) => {
    const rootPath = request?.rootPath;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    return deleteWorkspaceEntry(rootPath, request);
  });

  ipcMain.handle("workspace:watch-start", async (event, request) => {
    const rootPath = request?.rootPath;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    startWorkspaceWatch(event.sender, rootPath);
    return { ok: true };
  });

  ipcMain.handle("workspace:watch-stop", async (event, request) => {
    const rootPath = request?.rootPath;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    stopWorkspaceWatch(event.sender.id, rootPath);
    return { ok: true };
  });

  ipcMain.handle("workspace:git-status", async (_event, request) => {
    const rootPath = request?.rootPath;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    return getWorkspaceGitStatus(rootPath);
  });

  ipcMain.handle("workspace:git-init", async (_event, request) => {
    return initializeWorkspaceGitRepository(requireWorkspaceRoot(request));
  });

  ipcMain.handle("workspace:git-commit-detail", async (_event, request) => {
    const rootPath = request?.rootPath;
    const commitId = request?.commitId;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    if (typeof commitId !== "string" || commitId.trim().length === 0) {
      throw new Error("Commit id is required.");
    }
    return getWorkspaceGitCommitDetail(rootPath, commitId);
  });

  ipcMain.handle("workspace:git-file-diff", async (_event, request) => {
    const rootPath = requireWorkspaceRoot(request);
    const filePath = request?.path;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("File path is required.");
    }
    return getWorkspaceGitFileDiff(rootPath, filePath, request?.scope);
  });

  ipcMain.handle("workspace:git-stage", async (_event, request) => {
    return stageWorkspaceGitPaths(requireWorkspaceRoot(request), request?.paths);
  });

  ipcMain.handle("workspace:git-unstage", async (_event, request) => {
    return unstageWorkspaceGitPaths(requireWorkspaceRoot(request), request?.paths);
  });

  ipcMain.handle("workspace:git-discard", async (_event, request) => {
    return discardWorkspaceGitPaths(requireWorkspaceRoot(request), request?.paths);
  });

  ipcMain.handle("workspace:git-commit", async (_event, request) => {
    return commitWorkspaceGit(requireWorkspaceRoot(request), request?.message);
  });

  ipcMain.handle("workspace:git-checkout-branch", async (_event, request) => {
    return checkoutWorkspaceGitBranch(requireWorkspaceRoot(request), request?.branchName, {
      remote: Boolean(request?.remote),
    });
  });

  ipcMain.handle("workspace:git-stash-checkout-branch", async (_event, request) => {
    return stashAndCheckoutWorkspaceGitBranch(requireWorkspaceRoot(request), request?.branchName, {
      remote: Boolean(request?.remote),
    });
  });

  ipcMain.handle("workspace:git-commit-checkout-branch", async (_event, request) => {
    return commitAndCheckoutWorkspaceGitBranch(requireWorkspaceRoot(request), request?.branchName, {
      remote: Boolean(request?.remote),
    });
  });

  ipcMain.handle("workspace:git-create-branch", async (_event, request) => {
    return createWorkspaceGitBranch(requireWorkspaceRoot(request), request?.branchName);
  });

  ipcMain.handle("workspace:git-fetch", async (_event, request) => {
    return fetchWorkspaceGit(requireWorkspaceRoot(request));
  });

  ipcMain.handle("workspace:git-pull", async (_event, request) => {
    return pullWorkspaceGit(requireWorkspaceRoot(request));
  });

  ipcMain.handle("workspace:git-push", async (_event, request) => {
    return pushWorkspaceGit(requireWorkspaceRoot(request));
  });

  ipcMain.handle("terminal:create", async (event, request) => {
    const cwd = normalizeTerminalCwd(request?.cwd);
    const id = normalizeTerminalId(request?.id);
    const cols = normalizeTerminalSize(request?.cols, 80, 20, 400);
    const rows = normalizeTerminalSize(request?.rows, 24, 8, 120);
    const spawnConfig = buildTerminalSpawnConfig();

    closeTerminalSession(id);

    let terminal;
    try {
      terminal = pty.spawn(spawnConfig.file, spawnConfig.args, {
        name: "xterm-256color",
        cwd,
        cols,
        rows,
        env: buildTerminalEnv(),
      });
    } catch (error) {
      throw new Error(`Failed to start terminal: ${error instanceof Error ? error.message : String(error)}`);
    }

    const session = {
      id,
      terminal,
      sender: event.sender,
      cols,
      rows,
    };

    terminalSessions.set(id, session);

    terminal.onData((data) => sendTerminalData(session, data));
    terminal.onExit(({ exitCode, signal }) => {
      sendTerminalExit(session, exitCode, signal ? String(signal) : null);
      terminalSessions.delete(id);
    });

    return {
      id,
      pid: terminal.pid ?? null,
      shell: spawnConfig.displayShell,
      cwd,
    };
  });

  ipcMain.on("terminal:input", (_event, request) => {
    const session = getTerminalSession(request?.id);
    const data = request?.data;
    if (!session || typeof data !== "string" || data.length === 0) return;
    session.terminal.write(data);
  });

  ipcMain.on("terminal:resize", (_event, request) => {
    const session = getTerminalSession(request?.id);
    if (!session) return;
    const cols = normalizeTerminalSize(request?.cols, 80, 20, 400);
    const rows = normalizeTerminalSize(request?.rows, 24, 8, 120);
    session.cols = cols;
    session.rows = rows;
    session.terminal.resize(cols, rows);
  });

  ipcMain.handle("terminal:close", async (_event, id) => {
    closeTerminalSession(id);
  });
}

function requireWorkspaceRoot(request) {
  const rootPath = request?.rootPath;
  if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
    throw new Error("Workspace root path is required.");
  }
  return rootPath;
}

async function getLastWorkspaceResult() {
  const folderPath = await readLastWorkspacePath();
  if (!folderPath) {
    return {
      path: null,
      workspace: null,
      error: null,
    };
  }

  try {
    return {
      path: folderPath,
      workspace: await workspaceFromPath(folderPath),
      error: null,
    };
  } catch (error) {
    return {
      path: folderPath,
      workspace: null,
      error: `Unable to reopen last workspace (${folderPath}): ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function readLastWorkspacePath() {
  const state = await readWorkspaceState();
  if (typeof state.lastWorkspacePath !== "string" || state.lastWorkspacePath.trim().length === 0) {
    return null;
  }
  return path.resolve(state.lastWorkspacePath);
}

async function readWorkspaceState() {
  try {
    const raw = await fs.promises.readFile(getWorkspaceStatePath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("Unable to read puppyone workspace state:", error);
    }
    return {};
  }
}

async function rememberLastWorkspacePath(folderPath) {
  const resolvedPath = path.resolve(folderPath);
  await fs.promises.mkdir(path.dirname(getWorkspaceStatePath()), { recursive: true });
  await fs.promises.writeFile(
    getWorkspaceStatePath(),
    JSON.stringify({ lastWorkspacePath: resolvedPath }, null, 2),
    "utf8",
  );
}

async function forgetLastWorkspacePath() {
  await fs.promises.rm(getWorkspaceStatePath(), { force: true });
}

function getWorkspaceStatePath() {
  return path.join(app.getPath("userData"), workspaceStateFilename);
}

function normalizeTerminalCwd(cwd) {
  if (typeof cwd === "string" && cwd.trim().length > 0) {
    return path.resolve(cwd);
  }
  return os.homedir();
}

function normalizeTerminalId(id) {
  if (typeof id === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
    return id;
  }
  return randomUUID();
}

function normalizeTerminalSize(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(Math.round(next), min), max);
}

function buildTerminalSpawnConfig() {
  if (process.platform === "win32") {
    const file = process.env.ComSpec || "cmd.exe";
    return {
      file,
      args: [],
      displayShell: path.basename(file),
    };
  }

  const file = process.env.SHELL || "/bin/zsh";
  const shellName = path.basename(file);
  const args = shellName === "bash" || shellName === "zsh" ? ["-l"] : [];

  return {
    file,
    args,
    displayShell: shellName,
  };
}

function buildTerminalEnv() {
  const env = { ...process.env };
  delete env.NO_COLOR;

  return {
    ...env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    CLICOLOR: env.CLICOLOR || "1",
    TERM_PROGRAM: "PuppyOne",
    TERM_PROGRAM_VERSION: app.getVersion(),
    PUPPYONE_TERMINAL: "1",
  };
}

function getTerminalSession(id) {
  if (typeof id !== "string") return null;
  return terminalSessions.get(id) ?? null;
}

function sendTerminalData(session, data) {
  if (session.sender.isDestroyed()) return;
  session.sender.send("terminal:data", {
    id: session.id,
    data: String(data),
  });
}

function sendTerminalExit(session, code, signal) {
  if (session.sender.isDestroyed()) return;
  session.sender.send("terminal:exit", {
    id: session.id,
    code,
    signal,
  });
}

function closeTerminalSession(id) {
  const session = getTerminalSession(id);
  if (!session) return;
  terminalSessions.delete(session.id);
  try {
    session.terminal.kill();
  } catch {
    // The PTY may already be gone.
  }
}

function closeAllTerminalSessions() {
  for (const id of terminalSessions.keys()) {
    closeTerminalSession(id);
  }
}

function startWorkspaceWatch(sender, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  let entry = workspaceWatchers.get(resolvedRoot);

  if (!entry) {
    entry = createWorkspaceWatcher(resolvedRoot);
    workspaceWatchers.set(resolvedRoot, entry);
  }

  entry.clients.set(sender.id, sender);
  sender.once("destroyed", () => {
    stopWorkspaceWatch(sender.id, resolvedRoot);
  });
}

function stopWorkspaceWatch(webContentsId, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const entry = workspaceWatchers.get(resolvedRoot);
  if (!entry) return;

  entry.clients.delete(webContentsId);
  if (entry.clients.size === 0) {
    clearTimeout(entry.debounceTimer);
    entry.watcher.close();
    workspaceWatchers.delete(resolvedRoot);
  }
}

function createWorkspaceWatcher(rootPath) {
  const clients = new Map();
  const entry = {
    clients,
    debounceTimer: null,
    lastEvent: null,
    watcher: null,
  };

  entry.watcher = fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
    if (shouldIgnoreWorkspaceChange(filename)) return;

    entry.lastEvent = {
      rootPath,
      eventType: eventType ?? "change",
      path: typeof filename === "string" ? filename : null,
    };
    clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      broadcastWorkspaceChange(entry);
    }, 200);
  });

  entry.watcher.on("error", (error) => {
    entry.lastEvent = {
      rootPath,
      eventType: "error",
      path: null,
      error: error instanceof Error ? error.message : String(error),
    };
    broadcastWorkspaceChange(entry);
  });

  return entry;
}

function broadcastWorkspaceChange(entry) {
  if (!entry.lastEvent) return;

  for (const [id, sender] of entry.clients.entries()) {
    if (sender.isDestroyed()) {
      entry.clients.delete(id);
      continue;
    }
    sender.send("workspace:changed", entry.lastEvent);
  }
}

function shouldIgnoreWorkspaceChange(filename) {
  if (!filename) return false;
  const normalized = String(filename).replaceAll("\\", "/");
  return normalized === ".git" || normalized.startsWith(".git/");
}

function closeAllWorkspaceWatchers() {
  for (const entry of workspaceWatchers.values()) {
    clearTimeout(entry.debounceTimer);
    entry.watcher.close();
  }
  workspaceWatchers.clear();
}

function registerLocalFileProtocol() {
  protocol.handle("puppyone-local", async (request) => {
    const { rootPath, relativePath } = parseLocalFileUrl(request.url);
    const contentType = getMimeType(relativePath) ?? "application/octet-stream";
    return new Response(await readWorkspaceFile(rootPath, relativePath), {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": "bytes",
      },
    });
  });
}

function parseLocalFileUrl(rawUrl) {
  const url = new URL(rawUrl);

  if (url.hostname === "file") {
    const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    const encodedRootPath = segments.shift();
    if (!encodedRootPath) {
      throw new Error("Missing local file root path.");
    }
    return {
      rootPath: decodeURIComponent(encodedRootPath),
      relativePath: segments.map((segment) => decodeURIComponent(segment)).join("/"),
    };
  }

  return {
    rootPath: decodeURIComponent(url.hostname),
    relativePath: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
  };
}
