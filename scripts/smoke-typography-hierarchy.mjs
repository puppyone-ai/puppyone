#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererPath = path.join(repoRoot, "dist", "index.html");
app.setPath("userData", path.join(os.tmpdir(), `puppyone-typography-smoke-${process.pid}`));
if (process.env.ELECTRON_DISABLE_SANDBOX === "1") app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(run).catch((error) => { console.error(error); app.exit(1); });

async function run() {
  await access(rendererPath);
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 750,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    for (const style of ["default", "windows-xp"]) {
      for (const [scale, expectedName, expectedPath] of [["small", 13, 12], ["medium", 14, 13], ["large", 16, 14]]) {
        const url = pathToFileURL(rendererPath);
        url.searchParams.set("style", style);
        url.searchParams.set("scale", scale);
        url.hash = "appearance-visual-smoke";
        await window.loadURL(url.href);
        for (const colorMode of ["light", "dark"]) {
          const snapshot = await window.webContents.executeJavaScript(`(async () => {
            for (let attempt = 0; attempt < 200 && !document.querySelector('[data-typography-hierarchy-fixture]'); attempt++) {
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            const fixture = document.querySelector('[data-typography-hierarchy-fixture]');
            if (!fixture) throw new Error('Typography hierarchy fixture did not mount');
            const root = fixture.closest('[data-po-appearance-root]');
            root.classList.toggle('dark', ${JSON.stringify(colorMode)} === 'dark');
            document.documentElement.classList.toggle('dark', ${JSON.stringify(colorMode)} === 'dark');
            // Hostile inherited metrics expose unresolved token consumers.
            root.style.fontSize = '24px';
            const size = selector => {
              const element = fixture.querySelector(selector);
              if (!element) throw new Error('Missing typography sample: ' + selector);
              return getComputedStyle(element).fontSize;
            };
            const snapshot = {
              header: size('.desktop-titlebar-context-name'),
              name: size('.onboarding-project-row .desktop-menu-item-label'),
              path: size('.onboarding-project-row .desktop-menu-item-detail'),
              standaloneName: size('.typography-standalone-row .desktop-menu-item-label'),
              standalonePath: size('.typography-standalone-row .desktop-menu-item-detail'),
              headerMenu: size('[data-menu-typography-surface="header"] .desktop-menu-item-label'),
              rightSidebar: size('[data-menu-typography-surface="right-sidebar"] .desktop-menu-item-label'),
            };
            const menu = fixture.querySelector('[data-menu-typography-surface="header"]');
            menu.style.setProperty('--po-menu-item-font-size', '22px');
            menu.style.setProperty('--po-menu-meta-font-size', '20px');
            const scopedName = size('[data-menu-typography-surface="header"] .desktop-menu-item-label');
            const scopedDetail = size('[data-menu-typography-surface="header"] .desktop-menu-item-detail');
            menu.style.removeProperty('--po-menu-item-font-size');
            menu.style.removeProperty('--po-menu-meta-font-size');
            return { ...snapshot, scopedName, scopedDetail };
          })()`);
          for (const key of ["header", "name", "standaloneName", "headerMenu", "rightSidebar"]) {
            assert(snapshot[key] === `${expectedName}px`, `${style}/${colorMode}/${scale}: ${key} is ${snapshot[key]}, expected ${expectedName}px`);
          }
          for (const key of ["path", "standalonePath"]) {
            assert(snapshot[key] === `${expectedPath}px`, `${style}/${colorMode}/${scale}: ${key} is ${snapshot[key]}, expected ${expectedPath}px`);
          }
          assert(snapshot.scopedName === "22px" && snapshot.scopedDetail === "20px", `${style}/${colorMode}/${scale}: standalone defaults overrode the menu profile`);
          console.log(JSON.stringify({ style, colorMode, scale, ...snapshot }));
        }
      }
    }
    console.log("Typography hierarchy passed: 2 styles × 2 color modes × 3 sizes; standalone and scoped production menu rows.");
  } finally {
    window.destroy();
    app.quit();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
