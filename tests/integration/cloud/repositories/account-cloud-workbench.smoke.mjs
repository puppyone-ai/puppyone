#!/usr/bin/env electron
import { app, BrowserWindow } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const artifacts = path.join(repo, "artifacts/tests/cloud/account-workbench");
await mkdir(artifacts, { recursive: true });
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-account-cloud-")));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("force-color-profile", "srgb");
let window;
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const evaluate = async (code) => {
  try { return await window.webContents.executeJavaScript(code, true); }
  catch (error) { throw new Error(`Renderer step failed: ${code}: ${error.message}; ${errors.join("; ")}`); }
};
const waitFor = async (expression) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`Timed out: ${expression}; ${errors.join("; ")}`);
};
async function openProject(id) {
  await evaluate("window.__accountCloudSmoke.home()");
  await waitFor(`Boolean(document.querySelector('[data-cloud-project-id="${id}"] .onboarding-project-row'))`);
  // A Cloud project's own entry opens it directly (puppy-issues ADR-001).
  await evaluate(`document.querySelector('[data-cloud-project-id="${id}"] .onboarding-project-row').click()`);
  await waitFor(`window.__accountCloudSmoke.state().active && window.__accountCloudSmoke.state().project === '${id}' && !document.querySelector('[role=dialog]')`);
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .tree-row'))");
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(el => el.textContent.includes('readme')).click()");
  await waitFor("Boolean(document.querySelector('.desktop-account-cloud-workspace .cm-content'))");
}
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1100, height: 760, frame: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => { if (event.level === "error" || event.level === 3) errors.push(event.message); });
  await window.loadURL(`${pathToFileURL(path.join(repo, "dist/index.html")).href}#account-cloud-workbench-smoke`);
  await waitFor("Boolean(window.__accountCloudSmoke)");
  await waitFor("document.querySelectorAll('[data-cloud-project-id]').length === 2");
  assert(await evaluate("!document.querySelector('[role=dialog]') && !document.querySelector('.desktop-cloud-home-entry')"), "Homepage must list Cloud projects without a browse button or picker");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert(await evaluate("document.querySelector('.onboarding-project-list').getBoundingClientRect().height > 50"), "Homepage project list must be visible");
  await writeFile(path.join(artifacts, "catalog.png"), (await window.webContents.capturePage()).toPNG());
  await openProject("alpha");
  await waitFor("document.querySelector('.cm-content').textContent.includes('ALPHA_CLOUD_BODY')");
  assert(await evaluate("document.querySelector('.desktop-titlebar-workspace-name').textContent === 'Hosted alpha'"), "Header must identify the selected Cloud project");
  const geometry = await evaluate(`(() => {
    const shell = document.querySelector('.desktop-account-cloud-workspace');
    const rect = (selector) => { const r = shell.querySelector(selector).getBoundingClientRect(); return { x:r.x, width:r.width, height:r.height }; };
    return { explorer:rect('.explorer-column'), editor:rect('.browser-column'),
      header:rect('.desktop-titlebar'), project:rect('.desktop-titlebar-centered-context') };
  })()`);
  assert(Math.abs((geometry.project.x + geometry.project.width / 2) - (geometry.header.x + geometry.header.width / 2)) < 0.01,
    "Hosted project context must remain centered in the Header");
  assert(await evaluate(`(() => {
    const header = document.querySelector('.desktop-titlebar');
    const probe = document.createElement('span');
    probe.style.color = 'var(--po-cloud-header-bg)'; header.append(probe);
    const expected = getComputedStyle(probe).color;
    const ink = getComputedStyle(header.querySelector('.desktop-titlebar-workspace-name')).color; probe.remove();
    const shell = header.closest('.desktop-shell'), frame = getComputedStyle(shell, '::after');
    return header.dataset.workspaceKind === 'cloud' && shell.dataset.workspaceKind === 'cloud'
      && getComputedStyle(header).backgroundColor === expected
      && getComputedStyle(header).backgroundImage === 'none'
      && frame.content === 'none'
      && getComputedStyle(header.querySelector('.desktop-titlebar-workspace-button .desktop-titlebar-workspace-mark')).color === ink
      && !header.querySelector('.desktop-titlebar-location-button, .desktop-project-location-controls')
      && shell.getBoundingClientRect().height === innerHeight
      && header.getBoundingClientRect().width === innerWidth;
  })()`), "Hosted-only projects use the theme-blue Header, matching icon/text and no outer frame");
  assert(await evaluate("document.querySelectorAll('.desktop-account-cloud-workspace [data-cloud-workspace-tool]').length === 2 && [...document.querySelectorAll('[data-cloud-workspace-tool]')].every(button => !button.disabled)"),
    'Hosted-only Cloud must expose Share and Agent');
  assert(await evaluate("Boolean(document.querySelector('.desktop-account-cloud-workspace .desktop-sidebar-footer-bar .desktop-feedback'))"), 'Hosted Cloud must retain the Feedback footer');
  await evaluate("document.querySelector('.desktop-account-cloud-workspace .desktop-sidebar-footer-button[aria-label=Settings]').click()");
  await waitFor("window.__accountCloudSmoke.state().settingsOpened === 1");
  await evaluate("document.querySelector('.desktop-account-cloud-workspace .desktop-feedback button').click()");
  await waitFor("Boolean(document.querySelector('.desktop-feedback-dialog'))");
  await evaluate("document.querySelector('.desktop-feedback-close').click()");
  await waitFor("!document.querySelector('.desktop-feedback-dialog')");
  assert(await evaluate("['share','agent'].every(tool => document.querySelector('[data-cloud-workspace-tool='+tool+']')) && !document.querySelector('[data-cloud-workspace-tool=connect]')"),
    'Cloud entry retains the current Share and Agent actions');
  assert(await evaluate("!document.querySelector('.desktop-account-cloud-workspace [data-project-location-controls], .desktop-account-cloud-workspace .desktop-titlebar-location-button')"),
    "A Cloud project's Header never switches it to a local folder");
  assert(geometry.explorer.width > 100 && geometry.editor.width > 300 && geometry.editor.height > 400, "No-local hosted shell must have a usable native layout");
  await evaluate("window.__accountCloudSmoke.edit('ALPHA_EDIT_ONLY')");
  await waitFor("window.__accountCloudSmoke.state().writes.some(write => write.project === 'alpha' && write.content === 'ALPHA_EDIT_ONLY')");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "hosted-editor.png"), (await window.webContents.capturePage()).toPNG());
  await openProject("beta");
  await waitFor("document.querySelector('.cm-content').textContent.includes('BETA_CLOUD_BODY')");
  assert(await evaluate("!document.querySelector('.cm-content').textContent.includes('ALPHA_EDIT_ONLY')"), "Different project must not display the previous draft");
  await evaluate("window.__accountCloudSmoke.signOut()");
  await waitFor("!window.__accountCloudSmoke.state().active && !document.querySelector('.desktop-account-cloud-workspace')");
  await evaluate("window.__accountCloudSmoke.home(); window.__accountCloudSmoke.showLocalFixtures()");
  await waitFor("Boolean(document.querySelector('.onboarding-homepage .onboarding-project-list'))");
  const signedOutHome = await evaluate(`(() => {
    const signIn = document.querySelector('.homepage-cloud-sign-in');
    const button = signIn?.getBoundingClientRect();
    const titlebar = document.querySelector('.onboarding-shell > .desktop-titlebar')?.getBoundingClientRect();
    const projectRows = [...document.querySelectorAll('.onboarding-project-row-wrap')];
    return { exists:Boolean(signIn), inProjectList:Boolean(signIn?.closest('.onboarding-project-list')),
      inHeader:Boolean(signIn?.closest('.desktop-titlebar-actions')), headerHeight:titlebar?.height,
      top:button?.top, right:button ? innerWidth - button.right : null,
      topGap:button && titlebar ? button.top - titlebar.top : null,
      bottomGap:button && titlebar ? titlebar.bottom - button.bottom : null,
      projectRows:projectRows.length, projectLabels:projectRows.map(row => row.querySelector('.desktop-menu-item-label')?.textContent) };
  })()`);
  assert(signedOutHome.exists && signedOutHome.inHeader && !signedOutHome.inProjectList, "Sign-in belongs to the Homepage Header, never a synthetic Project row");
  assert(signedOutHome.headerHeight === geometry.header.height, "Homepage and project Headers must have the same height");
  assert(signedOutHome.topGap >= 0 && signedOutHome.bottomGap >= 0 && signedOutHome.right <= 20, "Sign-in stays within the Header at its trailing edge");
  assert(Math.abs(signedOutHome.topGap - signedOutHome.bottomGap) <= 0.01,
    `Sign-in must be vertically centered in the Header (${signedOutHome.topGap}px / ${signedOutHome.bottomGap}px)`);
  assert(!signedOutHome.projectLabels.some(label => /sign in/i.test(label ?? "")), "Every Project-list row is a Project");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "signed-out-home.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("window.__accountCloudSmoke.signIn()");
  await openProject("alpha");
  await waitFor("document.querySelector('.cm-content').textContent.includes('ALPHA_EDIT_ONLY')");
  await evaluate("window.__accountCloudSmoke.edit('ALPHA_AFTER_RELOGIN')");
  await waitFor("window.__accountCloudSmoke.state().writes.some(write => write.content === 'ALPHA_AFTER_RELOGIN')");
  await openProject("beta");
  await evaluate("window.__accountCloudSmoke.home()");
  await waitFor("!window.__accountCloudSmoke.state().active && Boolean(document.querySelector('.onboarding-project-list'))");
  await evaluate("window.__accountCloudSmoke.showLocalFixtures()");
  await openProject("alpha");
  // The folder linked to this Cloud project is another project: a row of its own in the project menu.
  await evaluate("document.querySelector('.desktop-account-cloud-workspace .desktop-titlebar-workspace-button').click()");
  await waitFor("Boolean(document.querySelector('.desktop-project-menu .desktop-project-switcher-row[data-linked-cloud-project-id=alpha]'))");
  assert(await evaluate("document.querySelector('.desktop-project-menu [aria-current=page]')?.closest('.desktop-project-switcher-row')?.dataset.projectLocation === 'cloud'"),
    "The open Cloud project, not its folder, is the current project");
  await evaluate("document.querySelector('.desktop-project-menu .desktop-project-switcher-row[data-linked-cloud-project-id=alpha]').querySelector('button').click()");
  await waitFor("!window.__accountCloudSmoke.state().active");
  assert(await evaluate("window.__accountCloudSmoke.state().selectedLocalPath === '/fixture/alpha'"), "Opening the linked folder must target that folder");
  if (process.argv.includes('--files-only')) {
    assert(errors.length === 0, `Unexpected renderer errors: ${errors.join('; ')}`);
    await writeFile(path.join(artifacts, 'file-operations-report.json'), JSON.stringify({passed:true,
      scope:'Homepage Cloud opening, live file save, project isolation and relogin',
      ...(await evaluate('window.__accountCloudSmoke.state()')), errors}, null, 2));
    console.log('Account Cloud file operations Electron acceptance passed.');
    window.destroy(); app.exit(0); return;
  }
  // Six folders and two Cloud projects: the folder linked to alpha is its own entry (ADR-001).
  await waitFor("document.querySelectorAll('.onboarding-project-row-wrap').length === 8");
  assert(await evaluate("!document.querySelector('.onboarding-project-group') && document.querySelectorAll('[data-cloud-project-id=alpha]').length === 1 && Boolean(document.querySelector('[data-linked-cloud-project-id=alpha] [data-project-location=linked] .onboarding-project-cloud-badge'))"), "One flat list must express linked folders through their folder/cloud icon, not section headings");
  const homepageOrder = await evaluate("[...document.querySelectorAll('.onboarding-project-row-wrap')].map(row => (row.dataset.projectLocation ?? '') + ':' + row.querySelector('.desktop-menu-item-label').textContent).join('|')");
  // One order for every entry: beta (June) before the notes folder (May) before
  // the alpha folder (April); the alpha Cloud project is dated by its own activity.
  const order = homepageOrder.split('|');
  assert(order.indexOf('cloud:Hosted beta') < order.indexOf('local:Local notes')
    && order.indexOf('local:Local notes') < order.indexOf('local:Hosted alpha')
    && order.includes('cloud:Hosted alpha') && order.filter(entry => entry.endsWith(':Hosted alpha')).length === 2,
    `All locations must share one last-modified order: ${homepageOrder}`);
  const homepageMarks = [];
  for (const theme of ['light', 'dark']) {
    await evaluate(`window.__accountCloudSmoke.setTheme('${theme}')`);
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const marks = await evaluate(`(() => {
      const home = document.querySelector('.onboarding-shell');
      const selectors = ['.onboarding-project-icon.is-cloud', '.onboarding-project-cloud-badge'];
      return { marks:selectors.map(selector => {
        const node = home.querySelector(selector), svg = node.matches('svg') ? node : node.querySelector('svg');
        return { selector, name:svg.dataset.cloudIcon, color:getComputedStyle(node).color,
          paint:getComputedStyle(svg.querySelector('[data-cloud-outline]')).stroke,
          backplate:svg.querySelector('[data-cloud-backplate]')?.getAttribute('fill') ?? null };
      }), localColor:getComputedStyle(home.querySelector('.onboarding-project-icon.is-local')).color,
        folderIsNotCloud:!home.querySelector('.onboarding-project-icon.is-local [data-cloud-icon]') };
    })()`);
    assert(marks.marks.every(mark => mark.name === 'puppyone' && mark.color === 'rgb(69, 153, 223)' && mark.paint === mark.color), 'Cloud-only and linked badge must use the approved mark and exact product blue in both themes');
    assert(marks.marks[1].backplate === 'var(--po-surface)' && marks.folderIsNotCloud && marks.localColor !== 'rgb(69, 153, 223)', 'Linked badge keeps its surface backplate; Local folder keeps ordinary styling');
    homepageMarks.push({ theme, ...marks });
    await writeFile(path.join(artifacts, `cloud-marks-${theme}.png`), (await window.webContents.capturePage()).toPNG());
  }
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "flat-homepage.png"), (await window.webContents.capturePage()).toPNG());
  window.setSize(640, 520);
  await waitFor("innerWidth === 640 && innerHeight === 520");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert(await evaluate(`(() => {
    const list = document.querySelector('.onboarding-project-list');
    const action = document.querySelector('[data-linked-cloud-project-id=alpha] .onboarding-project-cloud-link').getBoundingClientRect();
    const row = document.querySelector('[data-linked-cloud-project-id=alpha]').getBoundingClientRect();
    return list.scrollHeight > list.clientHeight && action.left >= row.left && action.right <= row.right;
  })()`), "The flat project list must scroll and retain a folder's Cloud project link at the minimum window size");
  await writeFile(path.join(artifacts, "flat-homepage-minimum.png"), (await window.webContents.capturePage()).toPNG());
  assert(errors.length === 0, `Unexpected renderer errors: ${errors.join("; ")}`);
  const result = { passed: true, geometry, homepageMarks, ...(await evaluate("window.__accountCloudSmoke.state()")), errors };
  await writeFile(path.join(artifacts, "result.json"), JSON.stringify(result, null, 2));
  console.log("Account Cloud workspace Electron smoke passed.");
  window.destroy(); app.exit(0);
}).catch(async (error) => {
  console.error(error);
  await writeFile(path.join(artifacts, "failure.json"), JSON.stringify({ error: String(error), errors }, null, 2));
  if (window) { await writeFile(path.join(artifacts, "failure.png"), (await window.webContents.capturePage()).toPNG()); window.destroy(); }
  app.exit(1);
});
