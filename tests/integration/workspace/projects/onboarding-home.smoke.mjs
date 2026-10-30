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
app.commandLine.appendSwitch("force-prefers-reduced-motion");
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
      show: true, width: 900, height: 680, frame: false, enableLargerThanScreen: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    window.webContents.on("console-message", (details) => {
      if (details.level === "error") console.error(details.message);
    });
    const labels = { en: "New empty project" };
    const projectPrompts = { en: "Which project do you want to start with?" };
    const importLabels = { en: "Import" };
    const importIntros = { en: "Bring content from these apps into a local project." };
    for (const locale of Object.keys(labels)) {
      for (const theme of ["dark", "light"]) {
        for (const [state, width, height] of [
          ["empty", 900, 680], ["empty", 563, 469], ["empty", 360, 520],
          ["projects", 900, 680], ["projects", 640, 535],
        ]) {
          window.setContentSize(width, height);
          const url = new URL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/workspace/projects/onboarding-home.html`);
          url.searchParams.set("theme", theme);
          url.searchParams.set("state", state);
          await window.loadURL(url.href);
          // Attach only after navigation creates the renderer target. The app-level
          // reduced-motion switch is already visible during the initial React mount.
          if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
          await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
          await until("!!document.querySelector('[data-onboarding-action=create]') && !document.querySelector('[data-onboarding-empty-state-intro]')");
          await until("[...document.querySelectorAll('.onboarding-brand-lockup img, .onboarding-entry-import img')].every(image => image.complete && image.naturalWidth > 0)");
          const snapshot = await evaluate(`(() => {
            const rect = (element) => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
            const create = document.querySelector('[data-onboarding-action=create]');
            const open = document.querySelector('[data-onboarding-action=open]');
            const importButton = document.querySelector('.onboarding-entry-import');
            const importLabel = importButton.querySelector('.onboarding-entry-import-label');
            const importMarks = [...importButton.querySelectorAll('.onboarding-import-mark')];
            const importBadges = [...importButton.querySelectorAll('.onboarding-entry-import-brand-badge')];
            const label = create.querySelector('.po-button__label');
            const brand = document.querySelector('.onboarding-brand-lockup');
            const launcher = document.querySelector('.onboarding-launcher');
            const primarySection = document.querySelector('.onboarding-home-primary');
            const actions = document.querySelector('.onboarding-entry-actions');
            const projectPanel = primarySection.dataset.onboardingPrimary === 'projects' ? primarySection : null;
            const projectRow = document.querySelector('.onboarding-project-row');
            const projectPanelStyle = projectPanel && getComputedStyle(projectPanel);
            const primaryStyle = getComputedStyle(primarySection);
            const firstSection = primarySection;
            const firstClickable = projectRow || create;
            const buttons = [...document.querySelectorAll('.onboarding-entry-action')];
            const images = [...document.querySelectorAll('.onboarding-brand-lockup img, .onboarding-entry-import img')];
            return {
              create: rect(create), brand: rect(brand), launcher: rect(launcher), actions: rect(actions), label: create.textContent,
              homepage: rect(document.querySelector('.onboarding-homepage')),
              brandText: brand.querySelector('.onboarding-brand-name, .onboarding-brand-prompt').textContent,
              primaryKind: primarySection.dataset.onboardingPrimary,
              primaryBorderTop: primaryStyle.borderTopWidth,
              primaryPaddingTop: primaryStyle.paddingTop,
              primaryPaddingBottom: primaryStyle.paddingBottom,
              primaryMarginBottom: primaryStyle.marginBottom,
              primaryBorderBottom: primaryStyle.borderBottomWidth,
              firstSection: rect(firstSection),
              firstClickable: rect(firstClickable),
              createFont: parseFloat(getComputedStyle(label).fontSize),
              createMinWidth: getComputedStyle(create).minWidth,
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
              importButton: rect(importButton), open: rect(open),
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
                paddingTop: projectPanelStyle.paddingTop,
              },
              importFont: parseFloat(getComputedStyle(importLabel).fontSize),
              importWeight: getComputedStyle(importLabel).fontWeight,
              importLineHeight: getComputedStyle(importLabel).lineHeight,
              importFamily: getComputedStyle(importLabel).fontFamily,
              importBackground: getComputedStyle(importButton).backgroundColor,
              importColor: getComputedStyle(importButton).color,
              importIcon: rect(importButton.querySelector('.po-button__icon svg')),
              importArtworkCount: importButton.querySelectorAll('img, svg').length,
              importMarks: importMarks.map(rect),
              importMarkOpacities: importMarks.map(mark => getComputedStyle(mark).opacity),
              importMarkFilters: importMarks.map(mark => getComputedStyle(mark).filter),
              importBadges: importBadges.map(rect),
              importBadgeBackgrounds: importBadges.map(badge => getComputedStyle(badge).backgroundColor),
              importBadgeRadii: importBadges.map(badge => getComputedStyle(badge).borderRadius),
              importBadgeStackOrder: importBadges.map(badge => getComputedStyle(badge).zIndex),
              importBrandIds: importMarks.map(image => image.dataset.importBrand),
              importBrandLabels: importMarks.map(image => image.alt),
              importLabel: rect(importLabel),
              importBrands: rect(importButton.querySelector('.onboarding-entry-import-brands')),
              importText: importButton.textContent,
              actionCount: buttons.length,
              reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
              clipped: buttons.some(button => button.scrollWidth > button.clientWidth + 1)
                || buttons.some(button => {
                  const text = button.querySelector('.po-button__label');
                  return text && text.scrollWidth > text.clientWidth + 1;
                }),
              outside: buttons.some(button => { const r = button.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 38 || r.bottom > innerHeight; }),
              tagline: !!document.querySelector('.onboarding-brand-tagline'),
              imagesLoaded: images.length === 1 + importMarks.length
                && images.every(image => image.complete && image.naturalWidth > 0),
            };
          })()`);
          const context = `${state}/${locale}/${theme}/${width}x${height}`;
          assert.equal(snapshot.label, labels[locale], context);
          assert.equal(snapshot.reducedMotion, true, `${context}: visual smoke skips the full intro animation`);
          assert.equal(snapshot.brandText, state === 'empty' ? 'Start with your files. Agent-ready.' : projectPrompts[locale], `${context}: state-specific title`);
          assert.equal(snapshot.tagline, false, context);
          assert.ok(snapshot.imagesLoaded, `${context}: all brand assets must load`);
          assert.ok(!snapshot.clipped && !snapshot.outside, `${context}: clipped or offscreen controls`);
          // Preserve the compact pre-redesign scale, not a large marketing CTA.
          assert.equal(snapshot.create.height, snapshot.openHeight, `${context}: shared row height`);
          assert.ok(snapshot.create.height <= 34, `${context}: compact button height`);
          if (state === 'empty') {
            assert.equal(snapshot.createMinWidth, '0px', `${context}: primary action hugs its content`);
            assert.ok(snapshot.create.width < 220, `${context}: compact content-hugging button`);
          }
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
          assert.equal(snapshot.importArtworkCount, 3, `${context}: action icon and production source logos`);
          assert.equal(snapshot.importIcon.width, snapshot.actionIconWidth, `${context}: shared action icon size`);
          assert.deepEqual(snapshot.importBrandIds, ['github', 'gitlab'], `${context}: experimental import sources stay hidden by default`);
          assert.deepEqual(snapshot.importBrandLabels, ['GitHub', 'GitLab'], `${context}: named logos for assistive technology`);
          assert.equal(snapshot.importBrands.x - snapshot.importLabel.x - snapshot.importLabel.width, 6, `${context}: source badges sit close to the import label`);
          assert.ok(Math.abs(snapshot.importBrands.y + snapshot.importBrands.height / 2 - snapshot.importLabel.y - snapshot.importLabel.height / 2) < 1, `${context}: vertically aligned label and logos`);
          if (width >= 563) assert.equal(snapshot.importLabel.height, 18, `${context}: single-line text at desktop widths`);
          assert.ok(snapshot.importBadges.every(badge => badge.width === 20 && badge.height === 20), `${context}: readable circular source badges`);
          assert.deepEqual([...new Set(snapshot.importBadgeRadii)], ['50%'], `${context}: every source uses the same circular badge`);
          assert.equal(new Set(snapshot.importBadgeBackgrounds).size, 1, `${context}: source badges share one background tone`);
          assert.ok(snapshot.importMarks.every(mark => mark.width === 14 && mark.height === 14), `${context}: readable logo size inside each badge`);
          assert.deepEqual(snapshot.importMarkOpacities, ['1', '1'], `${context}: source logos render at full clarity`);
          assert.deepEqual(
            snapshot.importMarkFilters,
            theme === 'dark' ? ['invert(1)', 'none'] : ['none', 'none'],
            `${context}: the solid GitHub mark adapts to the theme while GitLab keeps its brand colors`,
          );
          assert.deepEqual(snapshot.importBadgeStackOrder, ['3', '2'], `${context}: leftmost source badge sits above the badge to its right`);
          for (let i = 1; i < snapshot.importBadges.length; i++) {
            const previous = snapshot.importBadges[i - 1];
            assert.equal(snapshot.importBadges[i].x - previous.x - previous.width, -6, `${context}: circular source badges overlap`);
          }
          assert.equal(snapshot.importText, importLabels[locale], `${context}: complete localized text`);
          assert.equal(snapshot.brand.width, Math.min(state === 'empty' ? 440 : 520, width - 56), `${context}: column width fits within stable page insets`);
          assert.equal(snapshot.brand.x, snapshot.actions.x, `${context}: brand and actions share a left edge`);
          assert.equal(snapshot.brand.width, snapshot.actions.width, `${context}: shared content-column width`);
          assert.equal(snapshot.create.x, snapshot.actions.x, `${context}: no extra action-area left padding`);
          assert.equal(snapshot.open.x, snapshot.create.x, `${context}: open aligns with create`);
          assert.equal(snapshot.importButton.x, snapshot.create.x, `${context}: import aligns with create`);
          assert.equal(snapshot.actionIcon.x, snapshot.openIcon.x, `${context}: create content is left aligned with the other actions`);
          assert.ok(Math.abs(snapshot.brand.x + snapshot.brand.width / 2 - width / 2) < 1, `${context}: shared column is centered`);
          assert.equal(snapshot.launcher.x, snapshot.brand.x, `${context}: launcher uses the shared left edge`);
          assert.equal(snapshot.launcher.width, snapshot.brand.width, `${context}: launcher uses the shared width`);
          assert.equal(snapshot.firstSection.x, snapshot.brand.x, `${context}: first content section uses the shared left edge`);
          assert.equal(snapshot.firstSection.width, snapshot.brand.width, `${context}: first content section spans the shared column`);
          const titleToSectionGap = state === 'empty' ? 24 : 34;
          assert.ok(Math.abs(snapshot.firstSection.y - snapshot.brand.y - snapshot.brand.height - titleToSectionGap) < 1, `${context}: shared title-to-section gap`);
          assert.ok(Math.abs(snapshot.firstClickable.y - snapshot.brand.y - snapshot.brand.height - titleToSectionGap - 25) < 1, `${context}: shared title-to-first-clickable gap`);
          const verticalCenter = state === 'empty' ? height / 2 : snapshot.homepage.y + snapshot.homepage.height / 2;
          assert.ok(Math.abs(snapshot.launcher.y + snapshot.launcher.height / 2 - verticalCenter) < 1, `${context}: short content is centered in its available region`);
          assert.equal(snapshot.primaryKind, state === 'empty' ? 'create' : 'projects', `${context}: one primary-section contract swaps content by state`);
          assert.equal(snapshot.primaryBorderTop, '1px', `${context}: shared primary frame has a top rule`);
          assert.equal(snapshot.primaryPaddingTop, '24px', `${context}: shared primary frame owns the content inset`);
          if (state === 'empty') {
            assert.equal(snapshot.primaryBorderBottom, '1px', `${context}: shared primary frame separates create from secondary actions`);
            assert.equal(snapshot.primaryPaddingBottom, '18px', `${context}: create keeps a balanced inset above the divider`);
            assert.equal(snapshot.primaryMarginBottom, '18px', `${context}: divider keeps the same inset above the open action`);
            assert.equal(snapshot.open.y - snapshot.firstSection.y - snapshot.firstSection.height, 18, `${context}: open action sits below the shared divider`);
            const openToImportGap = snapshot.importButton.y - snapshot.open.y - snapshot.open.height;
            assert.ok(openToImportGap >= 1 && openToImportGap <= 4, `${context}: secondary actions form one compact group`);
            assert.equal(await evaluate("document.querySelector('.onboarding-entry-action-divider')"), null, `${context}: no decorative import divider`);
          } else {
            assert.equal(snapshot.primaryBorderBottom, '1px', `${context}: project list keeps its bottom rule`);
            assert.equal(snapshot.projectPanel.x, snapshot.brand.x, `${context}: project frame shares the content left edge`);
            assert.equal(snapshot.projectPanel.width, snapshot.brand.width, `${context}: project frame uses the shared width`);
            assert.equal(snapshot.projectRow.x, snapshot.brand.x, `${context}: project row has no container-side inset`);
            assert.equal(snapshot.projectIcon.x, snapshot.actionIcon.x, `${context}: project and action icons align`);
            assert.deepEqual(snapshot.projectPanelFrame, {
              borderTop: '1px', borderRight: '0px', borderBottom: '1px', borderLeft: '0px',
              paddingRight: '0px', paddingLeft: '0px', paddingTop: '24px',
            }, `${context}: horizontal-rule project frame without side padding`);
          }
          assert.equal(snapshot.importButton.height, snapshot.openHeight, `${context}: import uses the shared CTA height`);
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
          const importHover = await evaluate(`(() => {
            const style = getComputedStyle(document.querySelector('.onboarding-entry-import'));
            return { background: style.backgroundColor, color: style.color, boxShadow: style.boxShadow };
          })()`);
          await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: Math.round(snapshot.open.x + snapshot.open.width / 2),
            y: Math.round(snapshot.open.y + snapshot.open.height / 2),
          });
          await until("document.querySelector('[data-onboarding-action=open]').matches(':hover')");
          await evaluate("Promise.all(document.querySelector('[data-onboarding-action=open]').getAnimations().map(animation => animation.finished))");
          const openHover = await evaluate(`(() => {
            const style = getComputedStyle(document.querySelector('[data-onboarding-action=open]'));
            return { background: style.backgroundColor, color: style.color, boxShadow: style.boxShadow };
          })()`);
          assert.notEqual(importHover.background, 'rgba(0, 0, 0, 0)', `${context}: import has the shared CTA hover background`);
          assert.deepEqual(importHover, openHover, `${context}: import and open share hover treatment`);
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
          await until("!document.querySelector('.onboarding-entry-dialog button[type=submit]').disabled");
          const createDialog = await evaluate(`(() => {
            const dialog = document.querySelector('.onboarding-entry-dialog');
            return {
              name: dialog.querySelector('input').value,
              selects: dialog.querySelectorAll('select').length,
              localNotes: dialog.querySelectorAll('.onboarding-entry-local-note').length,
              starterCopy: /Getting Started|Blank folder/.test(dialog.textContent),
            };
          })()`);
          assert.match(createDialog.name, /^My project [A-F0-9]{4}$/, `${context}: collision-resistant default project name`);
          assert.deepEqual({ ...createDialog, name: undefined }, {
            name: undefined, selects: 0, localNotes: 0, starterCopy: false,
          }, `${context}: one-action create dialog`);
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
          await until("!document.querySelector('.onboarding-entry-dialog')");
          await evaluate("document.querySelector('[data-onboarding-action=open]').focus()");
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
          await until("document.activeElement?.dataset.onboardingAction === 'import'");
          await until("document.activeElement?.matches(':focus-visible')");
          await evaluate("Promise.all(document.activeElement.getAnimations().map(animation => animation.finished))");
          assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid", `${context}: import focus ring`);
          const importFocus = await evaluate(`(() => {
            const style = getComputedStyle(document.activeElement);
            return { background: style.backgroundColor, color: style.color, outline: style.outline };
          })()`);
          await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: 1, y: 39,
          });
          await until("!document.querySelector('[data-onboarding-action=open]').matches(':hover')");
          await evaluate("Promise.all(document.querySelector('[data-onboarding-action=open]').getAnimations().map(animation => animation.finished))");
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab", modifiers: ["shift"] });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab", modifiers: ["shift"] });
          await until("document.activeElement?.dataset.onboardingAction === 'open'");
          await until("document.activeElement?.matches(':focus-visible')");
          await evaluate("Promise.all(document.activeElement.getAnimations().map(animation => animation.finished))");
          const openFocus = await evaluate(`(() => {
            const style = getComputedStyle(document.activeElement);
            return { background: style.backgroundColor, color: style.color, outline: style.outline };
          })()`);
          assert.deepEqual(importFocus, openFocus, `${context}: import and open share keyboard focus treatment`);
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
          await until("document.activeElement?.dataset.onboardingAction === 'import'");
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
          window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
          await until("!!document.querySelector('.is-import-sources')");
          await evaluate("Promise.all(document.querySelector('.is-import-sources').getAnimations().map(animation => animation.finished))");
          await until("document.activeElement?.dataset.importSource === 'github'");
          assert.equal(await evaluate("document.querySelectorAll('.onboarding-import-source').length"), 2, `${context}: only production sources in dialog`);
          await until("[...document.querySelectorAll('.onboarding-import-source img')].length === 2 && [...document.querySelectorAll('.onboarding-import-source img')].every(image => image.complete && image.naturalWidth > 0)");
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
                  source: row.dataset.importSource,
                  mode: row.dataset.importMode,
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
          assert.equal(picker.listItems, 2, `${context}: native list and button semantics`);
          assert.deepEqual(picker.rows.map(row => row.source), ['github', 'gitlab'], `${context}: experimental sources are hidden and providers remain separate`);
          assert.deepEqual(picker.rows.map(row => row.mode), ['repository', 'repository'], `${context}: source capability is explicit in the DOM contract`);
          for (const row of picker.rows) {
            assert.equal(row.height, 36, `${context}: compact single-line source row`);
            assert.equal(row.border, '0px', `${context}: no card border`);
            assert.equal(row.iconBackground, 'rgba(0, 0, 0, 0)', `${context}: no icon tile`);
            if (!row.hover) assert.equal(row.background, 'rgba(0, 0, 0, 0)', `${context}: no card fill`);
            assert.equal(row.weight, '400', `${context}: regular source names`);
            assert.ok(row.labelOnly && !row.clipped, `${context}: source name only, without clipping`);
          }
          assert.equal(picker.focus, 'github', `${context}: first source keeps initial keyboard focus`);
          assert.equal(picker.focusWidth, '1px', `${context}: restrained visible focus ring`);
          await writeFile(path.join(screenshots, `${prefix}import-${locale}-${theme}-${width}.png`), (await window.capturePage()).toPNG());
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
          await until("document.activeElement?.dataset.importSource === 'gitlab'");
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
          await until("!document.querySelector('[role=dialog]') && document.activeElement?.dataset.onboardingAction === 'import'");
          console.log(`Passed ${context}`);
        }
      }
    }
    await validateProjectScrollports();
    await validateProjectGrid();
    console.log(`Onboarding visual smoke passed: 10 entry cases plus short/long list geometry, persistent scrolling and the Grid; screenshots: ${screenshots}`);
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

// The Grid keeps the list's column, four cells across, with three equal action keys under it.
async function validateProjectGrid() {
  const settle = "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() => Promise.all(document.getAnimations().map(animation => animation.finished)))";
  const column = `(() => { const edges = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.left, r.right]; };
    return { brand:edges('.onboarding-brand-lockup'), rule:edges('.onboarding-home-primary'), layoutSwitch:edges('.onboarding-project-layout-switch') }; })()`;
  for (const theme of ["dark", "light"]) {
    for (const [width, height, count] of [[1180, 760, 40], [640, 535, 40], [1200, 900, 3]]) {
      window.setContentSize(width, height);
      const url = new URL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/workspace/projects/onboarding-home.html`);
      url.searchParams.set("state", "projects"); url.searchParams.set("count", String(count)); url.searchParams.set("theme", theme);
      await window.loadURL(url.href);
      await until(`document.querySelectorAll('.onboarding-project-row-wrap').length === ${count}`);
      await evaluate("document.querySelector('[data-project-layout-option=list]').click()");
      await until("!!document.querySelector('.onboarding-project-row')");
      await evaluate(settle);
      const list = await evaluate(column);
      await evaluate("document.querySelector('[data-project-layout-option=grid]').click()");
      await until("!!document.querySelector('.onboarding-project-tile')");
      await evaluate(settle);
      const context = `grid/${theme}/${width}x${height}/${count}`;
      assert.deepEqual(await evaluate(column), list, `${context}: switching layouts never moves the column`);
      const snapshot = await evaluate(`(() => {
        const element = document.querySelector('.onboarding-project-list');
        const actions = [...document.querySelectorAll('.onboarding-entry-action')];
        const folders = [...document.querySelectorAll('.onboarding-project-folder')].map(folder => folder.getBoundingClientRect());
        return { sideways:element.scrollWidth - element.clientWidth, overflows:element.scrollHeight > element.clientHeight,
          columns:new Set(folders.map(folder => folder.left)).size, actionTops:new Set(actions.map(action => action.getBoundingClientRect().top)).size,
          actionIcons:actions.filter(action => action.querySelector('.po-button__icon') && getComputedStyle(action.querySelector('.po-button__icon')).display !== 'none').length,
          actionFont:getComputedStyle(actions[0].querySelector('.po-button__label')).fontSize,
          actionWidths:new Set(actions.map(action => Math.round(action.getBoundingClientRect().width))).size,
          actionEdges:[Math.round(actions[0].getBoundingClientRect().left), Math.round(actions[2].getBoundingClientRect().right)],
          ruleEdges:(rule => [Math.round(rule.left), Math.round(rule.right)])(document.querySelector('.onboarding-home-primary').getBoundingClientRect()),
          clippedLabels:actions.filter(action => { const label = action.querySelector('.po-button__label'); return label.scrollWidth > label.clientWidth; }).length,
          thumb:getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor };
      })()`);
      assert.equal(snapshot.sideways, 0, `${context}: the Grid never scrolls sideways`);
      assert.equal(snapshot.columns, Math.min(count, 4), `${context}: four cells across`);
      assert.equal(snapshot.actionTops, 1, `${context}: the actions share one line`);
      assert.equal(snapshot.actionIcons, 3, `${context}: the actions keep the list's icons`);
      assert.equal(snapshot.actionWidths, 1, `${context}: the actions are equal keys`);
      assert.deepEqual(snapshot.actionEdges, snapshot.ruleEdges, `${context}: the actions span the column`);
      assert.equal(snapshot.clippedLabels, 0, `${context}: no action label is cut`);
      assert.equal(snapshot.actionFont, '12px', `${context}: the actions use the folders' type`);
      if (snapshot.overflows) assert.notEqual(snapshot.thumb, 'rgba(0, 0, 0, 0)', `${context}: more projects below are always signalled`);
      await writeFile(path.join(screenshots, `grid-${theme}-${width}x${height}-${count}.png`), (await window.capturePage()).toPNG());
      console.log(`Passed ${context}`);
    }
  }
}

async function validateProjectScrollports() {
  const samples = [];
  for (const theme of ["dark", "light"]) {
    // Keep the same title/list clearance at every window size; grow the list below it.
    for (const [width, height, minimumListHeight, titleTop, listTop] of [
      [640, 520, 200, 91, 178], [591, 594, 275, 91, 178], [992, 596, 275, 91, 178],
      [900, 680, 350, 91, 178], [1200, 900, 475, 91, 178], [1200, 1200, 625, 91, 178],
    ]) {
      window.setContentSize(width, height);
      const url = new URL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/workspace/projects/onboarding-home.html`);
      url.searchParams.set("state", "projects"); url.searchParams.set("count", "40"); url.searchParams.set("theme", theme);
      await window.loadURL(url.href);
      await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      await until("document.querySelectorAll('.onboarding-project-row-wrap').length === 40");
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 39 });
      await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      const snapshot = await evaluate(`(() => {
        const list = document.querySelector('.onboarding-project-list');
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top:r.top, bottom:r.bottom, height:r.height, left:r.left, right:r.right, width:r.width }; };
        return { viewport:{ width:innerWidth, height:innerHeight }, list:rect('.onboarding-project-list'), launcher:rect('.onboarding-launcher'), page:rect('.onboarding-homepage'),
          brand:rect('.onboarding-brand-lockup'), actions:rect('.onboarding-entry-actions'), row:rect('.onboarding-project-row'),
          lowerInset:getComputedStyle(document.querySelector('.onboarding-home-primary')).paddingBottom,
          actionGap:getComputedStyle(document.querySelector('.onboarding-home-primary')).marginBottom,
          actionPadding:getComputedStyle(document.querySelector('.onboarding-entry-actions')).paddingBottom,
          lastAction:rect('[data-onboarding-action=import]'),
          scrollHeight:list.scrollHeight, clientHeight:list.clientHeight, gutter:list.offsetWidth-list.clientWidth,
          thumb:getComputedStyle(list, '::-webkit-scrollbar-thumb').backgroundColor,
          thumbInset:getComputedStyle(list, '::-webkit-scrollbar-thumb').borderTopWidth, hover:list.matches(':hover'),
          outerOverflow:document.querySelector('.onboarding-shell').scrollHeight > innerHeight,
          region:list.getAttribute('role'), tabIndex:list.tabIndex };
      })()`);
      const context = `long-projects/${theme}/${width}x${height}`;
      assert.deepEqual(snapshot.viewport, { width, height }, `${context}: test the requested viewport, not an OS-clamped window`);
      assert.ok(snapshot.list.height >= minimumListHeight, `${context}: use available height, not the old 112–284px cap (${snapshot.list.height}px)`);
      assert.ok(Math.abs(snapshot.launcher.height - snapshot.page.height) < 1, `${context}: no wasted available vertical space`);
      assert.equal(snapshot.brand.top, titleTop, `${context}: preserve the original top margin, not the regressed 48px anchor`);
      assert.equal(snapshot.list.top, listTop, `${context}: title-to-list spacing stays untouched`);
      assert.equal(snapshot.lowerInset, '10px', `${context}: reduce only the inset below the list`);
      assert.equal(snapshot.actionGap, '12px', `${context}: compact spacing below the divider`);
      assert.equal(snapshot.actionPadding, '0px', `${context}: remove trailing action-area padding`);
      assert.equal(height - snapshot.lastAction.bottom, 16, `${context}: do not leave the old large bottom blank`);
      assert.ok(snapshot.brand.top >= 38 && snapshot.actions.bottom <= height, `${context}: title and all actions remain onscreen`);
      assert.ok(snapshot.list.top >= snapshot.brand.bottom && snapshot.list.bottom <= snapshot.actions.top, `${context}: no overlapping chrome`);
      assert.ok(snapshot.scrollHeight > snapshot.clientHeight && !snapshot.outerOverflow, `${context}: only the Project list scrolls`);
      assert.equal(snapshot.gutter, 12, `${context}: deterministic reserved scrollbar lane`);
      assert.equal(snapshot.hover, false, `${context}: visibility must not depend on hovering the list`);
      assert.notEqual(snapshot.thumb, 'rgba(0, 0, 0, 0)', `${context}: persistent thumb before any interaction`);
      assert.equal(snapshot.thumbInset, '2px', `${context}: use the shared visible presentation, not the faint idle thumb`);
      assert.equal(snapshot.region, 'region'); assert.equal(snapshot.tabIndex, 0);
      await writeFile(path.join(screenshots, `long-projects-${theme}-${width}x${height}.png`), (await window.capturePage()).toPNG());
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseWheel",
        x: Math.round(snapshot.list.left + 30), y: Math.round(snapshot.list.top + 20), deltaX: 0, deltaY: 250 });
      await until("document.querySelector('.onboarding-project-list').scrollTop > 0");
      await evaluate("document.querySelector('.onboarding-project-list').focus()");
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "End" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "End" });
      await until("(() => { const el = document.querySelector('.onboarding-project-list'); return el.scrollTop >= el.scrollHeight - el.clientHeight - 2; })()");
      const after = await evaluate(`({ brandTop:document.querySelector('.onboarding-brand-lockup').getBoundingClientRect().top,
        actionsTop:document.querySelector('.onboarding-entry-actions').getBoundingClientRect().top })`);
      assert.equal(after.brandTop, snapshot.brand.top, `${context}: scrolling does not move the title`);
      assert.equal(after.actionsTop, snapshot.actions.top, `${context}: scrolling does not move the actions`);
      samples.push({ context, ...snapshot });
      console.log(`Passed ${context}: ${snapshot.list.height}px list, visible thumb, wheel/End scrolling`);
    }
  }
  // The opt-in must not change ordinary scroll owners or override system mode.
  const policy = await evaluate(`(() => {
    const ordinary = document.createElement('div'); ordinary.dataset.poScrollbar = 'content';
    ordinary.style.cssText = 'position:fixed;top:0;left:0;width:20px;height:20px;overflow:auto';
    ordinary.innerHTML = '<div style="height:80px"></div>'; document.body.appendChild(ordinary);
    const transient = getComputedStyle(ordinary, '::-webkit-scrollbar-thumb').backgroundColor;
    ordinary.remove();
    document.documentElement.dataset.poScrollbarMode = 'system';
    const systemWidth = getComputedStyle(document.querySelector('.onboarding-project-list'), '::-webkit-scrollbar').width;
    document.documentElement.dataset.poScrollbarMode = 'product';
    return { transient, systemWidth };
  })()`);
  assert.equal(policy.transient, 'rgba(0, 0, 0, 0)', 'Other default scroll owners remain transient');
  assert.notEqual(policy.systemWidth, '12px', 'System scrollbar mode retains OS-owned geometry');
  window.setContentSize(1200, 900);
  const shortUrl = new URL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/workspace/projects/onboarding-home.html?state=projects&count=1`);
  await window.loadURL(shortUrl.href); await until("document.querySelectorAll('.onboarding-project-row-wrap').length === 1");
  const short = await evaluate(`(() => { const list=document.querySelector('.onboarding-project-list'); return {
    height:list.clientHeight, content:list.scrollHeight, width:document.querySelector('.onboarding-project-row').getBoundingClientRect().width,
    launcher:document.querySelector('.onboarding-launcher').getBoundingClientRect().height }; })()`);
  assert.equal(short.height, short.content, 'A short list does not manufacture overflow');
  assert.ok(short.height < 50 && short.launcher < 400, 'A few projects still hug content, without an empty stretched panel');
  assert.equal(short.width, samples.find(sample => sample.context === 'long-projects/dark/1200x900').row.width, 'Stable gutter keeps short/long row geometry identical');
  await writeFile(path.join(screenshots, 'scrollport-results.json'), JSON.stringify({ samples, short, policy }, null, 2));
}
