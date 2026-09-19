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
    const importLabels = { "zh-Hans": "导入", en: "Import", fr: "Importer" };
    const importIntros = { "zh-Hans": "把 SaaS 里的数据变成文件，保存到本地。", en: "Turn SaaS data into files on your computer.", fr: "Transformez vos données SaaS en fichiers locaux." };
    for (const locale of Object.keys(labels)) {
      for (const theme of ["dark", "light"]) {
        for (const [state, width, height] of [
          ["empty", 900, 680], ["empty", 563, 469], ["empty", 360, 520],
          ["projects", 900, 680], ["projects", 640, 535],
        ]) {
          window.setContentSize(width, height);
          const url = new URL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/workspace/projects/onboarding-home.html`);
          url.searchParams.set("locale", locale);
          url.searchParams.set("theme", theme);
          url.searchParams.set("state", state);
          await window.loadURL(url.href);
          // A renderer must exist before attaching; keep keyboard assertions
          // stable if another desktop app takes OS focus during the matrix.
          if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
          await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
          await until("!!document.querySelector('[data-onboarding-action=create]') && !document.querySelector('[data-onboarding-empty-state-intro]')");
          const snapshot = await evaluate(`(() => {
            const rect = (element) => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
            const create = document.querySelector('[data-onboarding-action=create]');
            const open = document.querySelector('[data-onboarding-action=open]');
            const importButton = document.querySelector('.onboarding-entry-import');
            const importLabel = importButton.querySelector('.onboarding-entry-import-label');
            const importMarks = [...importButton.querySelectorAll('.onboarding-import-mark')];
            const divider = document.querySelector('.onboarding-entry-action-divider');
            const label = create.querySelector('.po-button__label');
            const brand = document.querySelector('.onboarding-brand-lockup');
            const launcher = document.querySelector('.onboarding-launcher');
            const actions = document.querySelector('.onboarding-entry-actions');
            const projectPanel = document.querySelector('.onboarding-recent-projects');
            const projectRow = document.querySelector('.onboarding-project-row');
            const projectPanelStyle = projectPanel && getComputedStyle(projectPanel);
            const buttons = [...document.querySelectorAll('.onboarding-entry-actions button')];
            const images = [...document.querySelectorAll('.onboarding-brand-lockup img, .onboarding-entry-import img')];
            return {
              create: rect(create), brand: rect(brand), launcher: rect(launcher), actions: rect(actions), label: create.textContent,
              createFont: parseFloat(getComputedStyle(label).fontSize),
              createWeight: getComputedStyle(label).fontWeight,
              createLineHeight: getComputedStyle(label).lineHeight,
              createFamily: getComputedStyle(label).fontFamily,
              openFont: parseFloat(getComputedStyle(open.querySelector('.po-button__label')).fontSize),
              openFamily: getComputedStyle(open.querySelector('.po-button__label')).fontFamily,
              openHeight: rect(open).height,
              brandFont: getComputedStyle(brand.querySelector('.onboarding-brand-name, .onboarding-brand-prompt')).fontSize,
              brandMarkWidth: rect(brand.querySelector('img')).width,
              actionIconWidth: rect(create.querySelector('svg')).width,
              actionIcon: rect(create.querySelector('.po-button__icon')),
              openIcon: rect(open.querySelector('.po-button__icon')),
              importButton: rect(importButton), divider: rect(divider), open: rect(open),
              projectPanel: rect(projectPanel),
              projectRow: rect(projectRow),
              projectIcon: rect(projectRow?.querySelector('.desktop-menu-item-icon')),
              projectPanelFrame: projectPanelStyle && {
                borderTop: projectPanelStyle.borderTopWidth,
                borderRight: projectPanelStyle.borderRightWidth,
                borderBottom: projectPanelStyle.borderBottomWidth,
                borderLeft: projectPanelStyle.borderLeftWidth,
                paddingRight: projectPanelStyle.paddingRight,
                paddingLeft: projectPanelStyle.paddingLeft,
              },
              importFont: parseFloat(getComputedStyle(importLabel).fontSize),
              importWeight: getComputedStyle(importLabel).fontWeight,
              importLineHeight: getComputedStyle(importLabel).lineHeight,
              importFamily: getComputedStyle(importLabel).fontFamily,
              importBackground: getComputedStyle(importButton).backgroundColor,
              importIcon: rect(importButton.querySelector('.po-button__icon svg')),
              importArtworkCount: importButton.querySelectorAll('img, svg').length,
              importMarks: importMarks.map(rect),
              importBrandIds: importMarks.map(image => image.dataset.importBrand),
              importBrandLabels: importMarks.map(image => image.alt),
              importLabel: rect(importLabel),
              importBrands: rect(importButton.querySelector('.onboarding-entry-import-brands')),
              importText: importButton.textContent,
              dividerBackground: divider && getComputedStyle(divider).backgroundColor,
              actionCount: buttons.length,
              clipped: buttons.some(button => button.scrollWidth > button.clientWidth + 1)
                || buttons.some(button => {
                  const text = button.querySelector('.po-button__label');
                  return text && text.scrollWidth > text.clientWidth + 1;
                }),
              outside: buttons.some(button => { const r = button.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 38 || r.bottom > innerHeight; }),
              tagline: !!document.querySelector('.onboarding-brand-tagline'),
              imagesLoaded: images.length === 4 && images.every(image => image.complete && image.naturalWidth > 0),
            };
          })()`);
          const context = `${state}/${locale}/${theme}/${width}x${height}`;
          assert.equal(snapshot.label, labels[locale], context);
          assert.equal(snapshot.tagline, false, context);
          assert.ok(snapshot.imagesLoaded, `${context}: all brand assets must load`);
          assert.ok(!snapshot.clipped && !snapshot.outside, `${context}: clipped or offscreen controls`);
          // Preserve the compact pre-redesign scale, not a large marketing CTA.
          assert.equal(snapshot.create.height, snapshot.openHeight, `${context}: shared row height`);
          assert.ok(snapshot.create.height <= 34, `${context}: compact button height`);
          if (state === 'empty') assert.ok(snapshot.create.width >= 180 && snapshot.create.width < 220, `${context}: slightly wider compact button`);
          assert.equal(snapshot.createFont, 14, `${context}: original body size`);
          assert.equal(snapshot.createFont, snapshot.openFont, `${context}: no CTA size override`);
          assert.equal(snapshot.createFamily, snapshot.openFamily, `${context}: shared font family`);
          assert.equal(snapshot.createWeight, '500', `${context}: original medium weight`);
          assert.equal(snapshot.createLineHeight, '18px', `${context}: original line height`);
          assert.equal(snapshot.brandFont, '19px', `${context}: original brand size`);
          assert.equal(snapshot.brandMarkWidth, 28, `${context}: original brand mark`);
          assert.equal(snapshot.actionIconWidth, 14, `${context}: original action icon`);
          assert.equal(snapshot.importFont, snapshot.createFont, `${context}: import uses the same CTA text size`);
          assert.equal(snapshot.importWeight, snapshot.createWeight, `${context}: shared CTA weight`);
          assert.equal(snapshot.importLineHeight, snapshot.createLineHeight, `${context}: shared CTA line height`);
          assert.equal(snapshot.importFamily, snapshot.createFamily, `${context}: shared CTA font`);
          assert.equal(snapshot.importBackground, 'rgba(0, 0, 0, 0)', `${context}: transparent text action`);
          assert.equal(snapshot.importArtworkCount, 4, `${context}: action icon plus three source logos`);
          assert.equal(snapshot.importIcon.width, snapshot.actionIconWidth, `${context}: shared action icon size`);
          assert.deepEqual(snapshot.importBrandIds, ['github', 'notion', 'google-drive'], `${context}: familiar import sources`);
          assert.deepEqual(snapshot.importBrandLabels, ['GitHub', 'Notion', 'Google Drive'], `${context}: named logos for assistive technology`);
          assert.equal(snapshot.importBrands.x - snapshot.importLabel.x - snapshot.importLabel.width, 12, `${context}: source logos follow text inline`);
          assert.ok(Math.abs(snapshot.importBrands.y + snapshot.importBrands.height / 2 - snapshot.importLabel.y - snapshot.importLabel.height / 2) < 1, `${context}: vertically aligned label and logos`);
          if (width >= 563) assert.equal(snapshot.importLabel.height, 18, `${context}: single-line text at desktop widths`);
          assert.ok(snapshot.importMarks.every(mark => mark.width === 18 && mark.height === 18), `${context}: legible logo size`);
          for (let i = 1; i < snapshot.importMarks.length; i++) {
            const previous = snapshot.importMarks[i - 1];
            assert.equal(snapshot.importMarks[i].x - previous.x - previous.width, 4, `${context}: compact logo spacing`);
          }
          assert.equal(snapshot.importText, importLabels[locale], `${context}: complete localized text`);
          assert.equal(snapshot.brand.width, width >= 563 ? 440 : 324, `${context}: shared responsive column width`);
          assert.equal(snapshot.brand.x, snapshot.actions.x, `${context}: brand and actions share a left edge`);
          assert.equal(snapshot.brand.width, snapshot.actions.width, `${context}: shared content-column width`);
          assert.equal(snapshot.create.x, snapshot.actions.x, `${context}: no extra action-area left padding`);
          assert.equal(snapshot.open.x, snapshot.create.x, `${context}: open aligns with create`);
          assert.equal(snapshot.importButton.x, snapshot.create.x, `${context}: import aligns with create`);
          assert.equal(snapshot.actionIcon.x, snapshot.openIcon.x, `${context}: create content is left aligned with the other actions`);
          assert.ok(Math.abs(snapshot.brand.x + snapshot.brand.width / 2 - width / 2) < 1, `${context}: shared column is centered`);
          if (state === 'empty') {
            assert.equal(snapshot.divider.height, 1, `${context}: subtle one-pixel divider`);
            assert.equal(snapshot.divider.width, snapshot.create.width, `${context}: divider matches CTA width`);
            assert.notEqual(snapshot.dividerBackground, 'rgba(0, 0, 0, 0)', `${context}: visible divider`);
            assert.ok(snapshot.divider.y - snapshot.open.y - snapshot.open.height >= 12, `${context}: separation from direct-start actions`);
            assert.ok(snapshot.importButton.y - snapshot.divider.y - snapshot.divider.height >= 8, `${context}: space below divider`);
            assert.equal(snapshot.divider.x, snapshot.brand.x, `${context}: divider shares the content left edge`);
            assert.equal(snapshot.launcher.x, snapshot.brand.x, `${context}: launcher uses the shared left edge`);
            assert.equal(snapshot.launcher.width, snapshot.brand.width, `${context}: launcher uses the shared width`);
            assert.ok(Math.abs(snapshot.launcher.y + snapshot.launcher.height / 2 - height / 2) < 1, `${context}: vertical centering`);
          } else {
            assert.equal(snapshot.divider, null, `${context}: project list layout stays unchanged`);
            assert.equal(snapshot.projectPanel.x, snapshot.brand.x, `${context}: project frame shares the content left edge`);
            assert.equal(snapshot.projectPanel.width, snapshot.brand.width, `${context}: project frame uses the shared width`);
            assert.equal(snapshot.projectRow.x, snapshot.brand.x, `${context}: project row has no container-side inset`);
            assert.equal(snapshot.projectIcon.x, snapshot.actionIcon.x, `${context}: project and action icons align`);
            assert.deepEqual(snapshot.projectPanelFrame, {
              borderTop: '1px', borderRight: '0px', borderBottom: '1px', borderLeft: '0px',
              paddingRight: '0px', paddingLeft: '0px',
            }, `${context}: horizontal-rule project frame without side padding`);
          }
          assert.ok(snapshot.importButton.height >= 28, `${context}: text entry retains a usable hit target`);
          assert.equal(snapshot.actionCount, 3, `${context}: no extra logo buttons`);
          const prefix = state === 'empty' ? '' : 'projects-';
          await writeFile(path.join(screenshots, `${prefix}${locale}-${theme}-${width}.png`), (await window.capturePage()).toPNG());
          await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: 1, y: 39,
          });
          await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: Math.round(snapshot.importButton.x + snapshot.importButton.width / 2),
            y: Math.round(snapshot.importButton.y + snapshot.importButton.height / 2),
          });
          await until("document.querySelector('.onboarding-entry-import').matches(':hover')");
          await evaluate("Promise.all(document.querySelector('.onboarding-entry-import').getAnimations().map(animation => animation.finished))");
          assert.equal(await evaluate("getComputedStyle(document.querySelector('.onboarding-entry-import')).backgroundColor"), 'rgba(0, 0, 0, 0)', `${context}: no hover background`);
          assert.equal(await evaluate("getComputedStyle(document.querySelector('.onboarding-entry-import')).boxShadow"), 'none', `${context}: no hover button shadow`);
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
          await until("document.activeElement?.matches(':focus-visible')");
          assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid", `${context}: import focus ring`);
          assert.equal(await evaluate("getComputedStyle(document.activeElement).backgroundColor"), 'rgba(0, 0, 0, 0)', `${context}: keyboard focus keeps transparent background`);
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
          window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
          await until("!!document.querySelector('.is-import-sources')");
          await evaluate("Promise.all(document.querySelector('.is-import-sources').getAnimations().map(animation => animation.finished))");
          await until("document.activeElement?.dataset.importSource === 'git'");
          assert.equal(await evaluate("document.querySelectorAll('.onboarding-import-source').length"), 6, `${context}: all sources in dialog`);
          await until("[...document.querySelectorAll('.onboarding-import-source img')].length === 6 && [...document.querySelectorAll('.onboarding-import-source img')].every(image => image.complete && image.naturalWidth > 0)");
          const picker = await evaluate(`(() => {
            const dialog = document.querySelector('.is-import-sources');
            const rows = [...dialog.querySelectorAll('.onboarding-import-source')];
            const bounds = dialog.getBoundingClientRect();
            return {
              width: bounds.width, height: bounds.height,
              intro: dialog.querySelector('.onboarding-import-intro').textContent,
              paragraphs: dialog.querySelectorAll('p').length,
              decoration: dialog.querySelectorAll('.desktop-dialog-leading, .onboarding-import-source-chevron, .onboarding-import-source-copy').length,
              listItems: dialog.querySelectorAll('ul > li > button').length,
              rows: rows.map(row => {
                const css = getComputedStyle(row);
                const label = row.querySelector('.onboarding-import-source-label');
                const icon = row.querySelector('.onboarding-import-source-icon');
                return {
                  height: row.getBoundingClientRect().height,
                  border: css.borderTopWidth,
                  background: css.backgroundColor,
                  hover: row.matches(':hover'),
                  iconBackground: getComputedStyle(icon).backgroundColor,
                  weight: getComputedStyle(label).fontWeight,
                  labelOnly: row.textContent === label.textContent,
                  clipped: row.scrollWidth > row.clientWidth || label.scrollWidth > label.clientWidth,
                };
              }),
              focus: document.activeElement?.dataset.importSource,
              focusWidth: getComputedStyle(document.activeElement).outlineWidth,
            };
          })()`);
          assert.ok(picker.width <= 360 && picker.height <= 360, `${context}: compact source dialog`);
          assert.equal(picker.intro, importIntros[locale], `${context}: one short description`);
          assert.equal(picker.paragraphs, 1, `${context}: no per-source descriptions`);
          assert.equal(picker.decoration, 0, `${context}: no header badge or row arrows`);
          assert.equal(picker.listItems, 6, `${context}: native list and button semantics`);
          for (const row of picker.rows) {
            assert.equal(row.height, 36, `${context}: compact single-line source row`);
            assert.equal(row.border, '0px', `${context}: no card border`);
            assert.equal(row.iconBackground, 'rgba(0, 0, 0, 0)', `${context}: no icon tile`);
            if (!row.hover) assert.equal(row.background, 'rgba(0, 0, 0, 0)', `${context}: no card fill`);
            assert.equal(row.weight, '400', `${context}: regular source names`);
            assert.ok(row.labelOnly && !row.clipped, `${context}: source name only, without clipping`);
          }
          assert.equal(picker.focus, 'git', `${context}: first source keeps initial keyboard focus`);
          assert.equal(picker.focusWidth, '1px', `${context}: restrained visible focus ring`);
          await writeFile(path.join(screenshots, `${prefix}import-${locale}-${theme}-${width}.png`), (await window.capturePage()).toPNG());
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
          await until("document.activeElement?.dataset.importSource === 'notion'");
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
          await until("!document.querySelector('[role=dialog]') && document.activeElement?.dataset.onboardingAction === 'clone'");
          console.log(`Passed ${context}`);
        }
      }
    }
    console.log(`Onboarding visual smoke passed: 30 cases; screenshots: ${screenshots}`);
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
