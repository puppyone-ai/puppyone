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
          // A renderer must exist before attaching; keep keyboard assertions
          // stable if another desktop app takes OS focus during the matrix.
          if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
          await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
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
              createWeight: getComputedStyle(label).fontWeight,
              createLineHeight: getComputedStyle(label).lineHeight,
              createFamily: getComputedStyle(label).fontFamily,
              openFont: parseFloat(getComputedStyle(open.querySelector('.po-button__label')).fontSize),
              openFamily: getComputedStyle(open.querySelector('.po-button__label')).fontFamily,
              openHeight: rect(open).height,
              brandFont: getComputedStyle(brand.querySelector('.onboarding-brand-name')).fontSize,
              brandMarkWidth: rect(brand.querySelector('img')).width,
              actionIconWidth: rect(create.querySelector('svg')).width,
              importMarkWidths: images.slice(1).map(image => rect(image).width),
              importStack: [...document.querySelectorAll('.onboarding-entry-import-brand')].map(rect),
              importBrandIds: images.slice(1).map(image => image.dataset.importBrand),
              importText: document.querySelector('.onboarding-entry-import-label').textContent,
              importEllipsis: document.querySelector('.onboarding-entry-import-more').textContent,
              actionCount: buttons.length,
              clipped: buttons.some(button => button.scrollWidth > button.clientWidth + 1)
                || label.scrollWidth > label.clientWidth + 1,
              outside: buttons.some(button => { const r = button.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 38 || r.bottom > innerHeight; }),
              tagline: !!document.querySelector('.onboarding-brand-tagline'),
              imagesLoaded: images.length === 4 && images.every(image => image.complete && image.naturalWidth > 0),
            };
          })()`);
          const context = `${locale}/${theme}/${width}x${height}`;
          assert.equal(snapshot.label, labels[locale], context);
          assert.equal(snapshot.tagline, false, context);
          assert.ok(snapshot.imagesLoaded, `${context}: all brand assets must load`);
          assert.ok(!snapshot.clipped && !snapshot.outside, `${context}: clipped or offscreen controls`);
          // Preserve the compact pre-redesign scale, not a large marketing CTA.
          assert.equal(snapshot.create.height, snapshot.openHeight, `${context}: shared row height`);
          assert.ok(snapshot.create.height <= 34 && snapshot.create.width >= 160 && snapshot.create.width < 220, `${context}: slightly wider compact button`);
          assert.equal(snapshot.createFont, 14, `${context}: original body size`);
          assert.equal(snapshot.createFont, snapshot.openFont, `${context}: no CTA size override`);
          assert.equal(snapshot.createFamily, snapshot.openFamily, `${context}: shared font family`);
          assert.equal(snapshot.createWeight, '500', `${context}: original medium weight`);
          assert.equal(snapshot.createLineHeight, '18px', `${context}: original line height`);
          assert.equal(snapshot.brandFont, '19px', `${context}: original brand size`);
          assert.equal(snapshot.brandMarkWidth, 28, `${context}: original brand mark`);
          assert.equal(snapshot.actionIconWidth, 14, `${context}: original action icon`);
          assert.ok(snapshot.importMarkWidths.every(width => width === 14), `${context}: original import marks`);
          assert.deepEqual(snapshot.importBrandIds, ['github', 'notion', 'google-drive'], `${context}: source preview`);
          assert.equal(snapshot.actionCount, 3, `${context}: no extra logo buttons`);
          assert.equal(snapshot.importEllipsis, '…', `${context}: more sources`);
          if (locale === 'en') assert.equal(snapshot.importText, 'Import from', context);
          for (let i = 1; i < snapshot.importStack.length; i++) {
            const previous = snapshot.importStack[i - 1];
            assert.ok(snapshot.importStack[i].x < previous.x + previous.width, `${context}: overlapping marks`);
          }
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
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
          await until("!document.querySelector('.onboarding-entry-dialog')");
          await evaluate("document.querySelector('[data-onboarding-action=open]').focus()");
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
          await until("document.activeElement?.dataset.onboardingAction === 'clone'");
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
          window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
          await until("!!document.querySelector('.is-import-sources')");
          assert.equal(await evaluate("document.querySelectorAll('.onboarding-import-source').length"), 6, `${context}: all sources in dialog`);
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
