import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  getWorkspaceGitStatus,
  listFolderChildren,
  readWorkspaceTextFile,
  readWorkspaceFile,
  writeWorkspaceTextFile,
  workspaceFromPath,
} from "../local-api/workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.cjs");
const rendererDistPath = path.join(projectRoot, "dist", "index.html");
const devServerUrl = process.env.PUPPYONE_DESKTOP_DEV_URL;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "puppyone-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

let mainWindow = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 920,
    minHeight: 640,
    title: "PuppyOne Desktop",
    backgroundColor: "#f1eadf",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(rendererDistPath);
  }
}

app.whenReady().then(async () => {
  registerLocalFileProtocol();
  registerIpcHandlers();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpcHandlers() {
  ipcMain.handle("workspace:select-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open local PuppyOne workspace",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return workspaceFromPath(result.filePaths[0]);
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

  ipcMain.handle("workspace:git-status", async (_event, request) => {
    const rootPath = request?.rootPath;
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      throw new Error("Workspace root path is required.");
    }
    return getWorkspaceGitStatus(rootPath);
  });
}

function registerLocalFileProtocol() {
  protocol.handle("puppyone-local", async (request) => {
    const url = new URL(request.url);
    const rootPath = decodeURIComponent(url.hostname);
    const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return new Response(await readWorkspaceFile(rootPath, relativePath));
  });
}
