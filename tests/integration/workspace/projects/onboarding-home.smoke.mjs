#!/usr/bin/env electron
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-onboarding-visual-"));
const screenshots = path.join(repoRoot, "artifacts/tests/onboarding-home");
app.setPath("userData", path.join(temporaryRoot, "profile"));
app.commandLine.appendSwitch("disable-gpu");
let window;
let server;
const evaluate = (source) => window.webContents.executeJavaScript(source);
async function until(expression) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

const timeout = setTimeout(() => { console.error("Onboarding visual smoke timed out"); app.exit(1); }, 90_000);
app.whenReady().then(runSmoke).catch((error) => { console.error(error); app.exit(1); });

async function runSmoke() {
  let exitCode = 0;
  try {
    const { createServer } = await import("vite");
    server = await createServer({
      root: repoRoot,
      cacheDir: path.join(temporaryRoot, "vite-cache"),
      logLevel: "error",
      optimizeDeps: { entries: ["tests/fixtures/workspace/projects/onboarding-home.html"] },
      server: { host: "127.0.0.1", port: 5299, strictPort: false, hmr: false, watch: null },
    });
    await server.listen();
    await mkdir(screenshots, { recursive: true });
    window = new BrowserWindow({
      show: true, width: 900, height: 680, frame: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    window.webContents.on("console-message", (details) => {
      if (details.level === "error") console.error(details.message);
    });
    const labels = { "zh-Hans": "新建空项目", en: "New empty project", fr: "Créer un projet vide" };
    for (const locale of Object.keys(labels)) {
      for (const theme of ["dark", "light"]) {
        for (const [width, height] of [[900, 680], [563, 469], [360, 520]]) {
          window.setContentSize(width, height);
          const url = new URL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/workspace/projects/onboarding-home.html`);
          url.searchParams.set("locale", locale);
          url.searchParams.set("theme", theme);
          await window.loadURL(url.href);
          await until("!!document.querySelector('[data-onboarding-action=create]') && !document.querySelector('[data-onboarding-empty-state-intro]')");
          const snapshot = await evaluate(`(() => {
            const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
            const create = document.querySelector('[data-onboarding-action=create]');
            const open = document.querySelector('[data-onboarding-action=open]');
            const label = create.querySelector('.po-button__label');
            const brand = document.querySelector('.onboarding-brand-lockup');
            const launcher = document.querySelector('.onboarding-launcher');
            const buttons = [...document.querySelectorAll('.onboarding-entry-actions button')];
            const images = [...document.querySelectorAll('.onboarding-brand-lockup img, .onboarding-entry-import img')];
            return {
              create: rect(create), brand: rect(brand), launcher: rect(launcher), label: create.textContent,
              createFont: parseFloat(getComputedStyle(label).fontSize),
              openFont: parseFloat(getComputedStyle(open.querySelector('.po-button__label')).fontSize),
              clipped: buttons.some(button => button.scrollWidth > button.clientWidth + 1)
                || label.scrollWidth > label.clientWidth + 1,
              outside: buttons.some(button => { const r = button.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 38 || r.bottom > innerHeight; }),
              tagline: !!document.querySelector('.onboarding-brand-tagline'),
              imagesLoaded: images.length === 6 && images.every(image => image.complete && image.naturalWidth > 0),
            };
          })()`);
          const context = `${locale}/${theme}/${width}x${height}`;
          assert.equal(snapshot.label, labels[locale], context);
          assert.equal(snapshot.tagline, false, context);
          assert.ok(snapshot.imagesLoaded, `${context}: all brand assets must load`);
          assert.ok(!snapshot.clipped && !snapshot.outside, `${context}: clipped or offscreen controls`);
          assert.ok(snapshot.create.height >= 48 && snapshot.create.width >= 260, `${context}: CTA must be prominent`);
          assert.ok(snapshot.createFont > snapshot.openFont, `${context}: CTA type hierarchy`);
          for (const item of [snapshot.create, snapshot.brand, snapshot.launcher]) {
            assert.ok(Math.abs(item.x + item.width / 2 - width / 2) < 1, `${context}: horizontal centering`);
          }
          assert.ok(Math.abs(snapshot.launcher.y + snapshot.launcher.height / 2 - height / 2) < 1, `${context}: vertical centering`);
          await writeFile(path.join(screenshots, `${locale}-${theme}-${width}.png`), (await window.capturePage()).toPNG());
          // Real keyboard focus must remain visible and Enter must open the creation dialog.
          window.focus();
          window.webContents.focus();
          await evaluate("document.querySelector('[data-onboarding-action=create]').focus()");
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
          await until("document.activeElement?.dataset.onboardingAction === 'open'");
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab", modifiers: ["shift"] });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab", modifiers: ["shift"] });
          await until("document.activeElement?.dataset.onboardingAction === 'create'");
          await until("document.activeElement?.matches(':focus-visible')");
          assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid", `${context}: focus ring`);
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
          window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
          await until("!!document.querySelector('.onboarding-entry-dialog')");
          console.log(`Passed ${context}`);
        }
      }
    }
    console.log(`Onboarding visual smoke passed: 18 cases; screenshots: ${screenshots}`);
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) console.error(await evaluate("({ active: document.activeElement?.outerHTML, dialogs: document.querySelectorAll('[role=dialog]').length, text: document.body.innerText })"));
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    window?.destroy();
    await server?.close();
    app.exit(exitCode);
  }
}
