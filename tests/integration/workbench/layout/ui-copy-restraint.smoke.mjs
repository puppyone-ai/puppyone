// Run against the repo's Vite server. Product components/styles, real Electron
// layout/focus; authentication, billing and provider results are isolated fixtures.
import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSourceIdentity } from '../../../../scripts/release-checks/execution.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const origin = process.env.PUPPYONE_UI_COPY_ORIGIN || 'http://127.0.0.1:5184';
assert.equal(new URL(origin).hostname, '127.0.0.1');
console.log('UI copy smoke: starting');
const watchdog = setTimeout(() => { console.error('UI copy smoke timed out'); app.exit(1); }, 180_000);
const source = await readSourceIdentity(repo);
const artifacts = path.join(repo, 'artifacts/tests/ui-copy-restraint');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', await mkdtemp(path.join(os.tmpdir(), 'puppyone-ui-copy-')));
app.commandLine.appendSwitch('force-color-profile', 'srgb');
async function run() {
console.log('UI copy smoke: Electron ready');
const window = new BrowserWindow({ width: 1100, height: 760, minWidth: 640, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
const report = { ok: false, source, startedAt: new Date().toISOString(), runtime: { electron: process.versions.electron, chromium: process.versions.chrome, os: os.release() }, scope: 'Production components and styles in a real Electron BrowserWindow; disposable bridge/service fixtures, no live-account acceptance', samples: [], screenshots: [], errors: [] };
window.webContents.on('console-message', (event) => { if (event.level === 'error') report.errors.push(event.message); });
window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
  const url = new URL(details.url);
  callback({ cancel: ['http:', 'https:'].includes(url.protocol) && url.origin !== origin });
});
const evaluate = async (code) => {
  try { return await window.webContents.executeJavaScript(code, true); }
  catch (error) { throw new Error(`Renderer step failed: ${code}: ${error.message}; ${report.errors.join('; ')}`); }
};
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) {
  for (let n = 0; n < 200; n++) { if (await evaluate(code)) return; await pause(50); }
  throw new Error(`Timed out: ${code}`);
}
async function show(scene, variant = '') {
  await evaluate(`window.__uiCopy.show(${JSON.stringify(scene)}, ${JSON.stringify(variant)})`);
  await until(`document.body.dataset.scene === ${JSON.stringify(scene)}`);
  await pause(80);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}
const text = () => evaluate('document.body.innerText');
const present = selector => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
async function click(selector) {
  assert.ok(await present(selector), `Missing ${selector}`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await pause(50);
}
async function clickText(label) {
  const code = `[...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(label)})`;
  assert.ok(await evaluate(`!!(${code})`), `Missing button ${label}`);
  await evaluate(`(${code}).click()`); await pause(50);
}
async function input(selector, value) {
  await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select(); })()`);
  await window.webContents.insertText(value); await pause(50);
}
const height = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().height`);
async function capture(name) {
  await writeFile(path.join(artifacts, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  report.screenshots.push(`${name}.png`);
}
try {
  await window.loadURL(`${origin}/tests/fixtures/platform/ui-copy/index.html`);
  await until('!!window.__uiCopy');
  for (const theme of ['light', 'dark']) {
    await evaluate(`document.documentElement.dataset.initialTheme = ${JSON.stringify(theme)}`);
    for (const width of [1100, 640]) {
      window.setContentSize(width, 760);
      const suffix = `${theme}-${width}`;
      const sample = { theme, width, checks: [] };
      report.samples.push(sample);
      await show('sign-in');
      const signInHeight = await height('.desktop-cloud-project-activation');
      await show('sign-in', 'pending');
      assert.equal(await height('.desktop-cloud-project-activation'), signInHeight, 'Sign-in pending must not change height');
      assert.equal(await present('.desktop-cloud-project-activation-hint'), false);
      assert.ok(await evaluate("document.querySelector('[data-cloud-sign-in-action]').disabled"));
      assert.ok(await present('[data-cloud-sign-in-action] [role="status"]'));
      await capture(`sign-in-${suffix}`);
      await show('sign-in', 'error'); assert.match(await text(), /Sign-in failed/);
      sample.checks.push('Sign-in: idle/pending/error; CTA status; unchanged pending height');

      await show('authentication'); await clickText('Open Cloud');
      await click('[data-cloud-sign-in-action]');
      await until("document.querySelector('[data-cloud-sign-in-action]').disabled");
      await evaluate("window.__uiCopy.finish('auth', true)");
      await until("!!document.querySelector('[role=alert]')");
      assert.equal(await evaluate("document.querySelector('output').dataset.currentProvider"), 'local');
      await click('[data-cloud-sign-in-action]');
      await evaluate("window.__uiCopy.finish('auth')");
      await until("window.__uiCopy.hasPending('preflight')");
      assert.equal(await evaluate("document.querySelector('output').dataset.currentProvider"), 'local');
      await evaluate("window.__uiCopy.finish('preflight')");
      await until("document.querySelector('output').dataset.currentProvider === 'cloud'");
      assert.equal(await present('.desktop-cloud-workspace-switch-dialog'), false);
      assert.equal(await evaluate("document.querySelector('input[aria-label=\"Local draft\"]').value"), 'Unsaved fixture draft');
      sample.checks.push('Authentication: failed handoff can retry; authorized project preflight returns to Cloud and retains local draft');

      await show('feedback'); await click('.desktop-help-launcher');
      await input('textarea', 'Fixture feedback'); await input('.desktop-feedback-contact-input', 'fixture@example.test');
      const feedbackHeight = await height('.desktop-feedback-dialog');
      await click('.desktop-feedback-submit');
      assert.match(await text(), /Sending/);
      assert.equal(await evaluate("document.querySelector('.desktop-feedback-status').innerText"), '');
      assert.ok(Math.abs(await height('.desktop-feedback-dialog') - feedbackHeight) < 1, 'Feedback pending must not add a row');
      await capture(`feedback-${suffix}`);
      await evaluate("window.__uiCopy.finish('feedback')"); await until("document.querySelector('.desktop-feedback-submit').dataset.state === 'sent'");
      assert.match(await evaluate("document.querySelector('.desktop-feedback-submit').innerText"), /^Sent/);
      await show('feedback'); await click('.desktop-help-launcher');
      await input('textarea', 'Fixture feedback'); await input('.desktop-feedback-contact-input', 'fixture@example.test');
      await click('.desktop-feedback-submit'); await evaluate("window.__uiCopy.finish('feedback', true)");
      await until("document.querySelector('.desktop-feedback-submit').dataset.state === 'error'");
      assert.match(await evaluate("document.querySelector('.desktop-feedback-submit').innerText"), /try again/i);
      await show('feedback'); await click('.desktop-help-launcher');
      await evaluate("(() => {const transfer=new DataTransfer();transfer.items.add(new File(['fixture'],'fixture.txt',{type:'text/plain'})); const e=document.querySelector('input[type=file]');e.files=transfer.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await until("document.body.innerText.includes('Use a PNG, JPEG, or WebP image.')");
      sample.checks.push('Feedback: sending/sent/error; single visible CTA state; unchanged pending height');

      await show('language');
      await evaluate("(() => { const e=document.querySelector('select');e.value='de';e.dispatchEvent(new Event('change',{bubbles:true})); })()");
      await until("document.querySelector('select').disabled");
      assert.match(await evaluate("document.querySelector('select').selectedOptions[0].textContent"), /Changing/);
      assert.equal(await present('.desktop-language-setting-status'), false);
      await evaluate("window.__uiCopy.finish('language', true)");
      await until("!!document.querySelector('[role=alert]')");
      assert.equal(await evaluate("document.querySelector('select').value"), 'en');
      assert.equal(await evaluate("document.querySelector('select').disabled"), false);
      await capture(`language-error-${suffix}`);
      await show('language');
      await evaluate("(() => { const e=document.querySelector('select');e.value='de';e.dispatchEvent(new Event('change',{bubbles:true})); })()");
      await until("document.querySelector('select').disabled");
      await evaluate("window.__uiCopy.finish('language')");
      await until("document.querySelector('select').value === 'de' && !document.querySelector('select').disabled");
      sample.checks.push('Language: disabled in-control progress; failure retains original language and permits retry');

      await show('automation', 'lookup');
      assert.equal(await evaluate("document.querySelectorAll('.desktop-cloud-automation-connect-state h3').length"), 1);
      assert.equal(await evaluate("document.querySelector('.desktop-cloud-automation-connect-state').querySelectorAll('p').length"), 0);
      await evaluate("window.__uiCopy.finish('lookup')");
      await until("document.querySelector('.desktop-cloud-automation-connect-state')?.innerText.includes('Waiting')");
      assert.equal(await evaluate("document.querySelector('.desktop-cloud-automation-connect-state').querySelectorAll('p').length"), 0);
      await capture(`oauth-${suffix}`);
      await show('automation', 'denied');
      await until("document.body.innerText.includes('Authorization was denied')");
      await show('automation', 'configure');
      await until("!!document.querySelector('.desktop-cloud-automation-builder')");
      await evaluate("[...document.querySelectorAll('.desktop-cloud-automation-field')].find(e=>e.innerText.startsWith('Repository URL')).querySelector('input').setAttribute('data-fixture-url','true')");
      await input('[data-fixture-url]', 'https://github.com/fixture/project');
      await clickText('Create Automation');
      await until("document.body.innerText.includes('Creating…')");
      await evaluate("window.__uiCopy.finish('create', true)");
      await until("!!document.querySelector('.desktop-cloud-automation-action-error')");
      assert.doesNotMatch(await text(), /Ready to create|queue the first sync/);
      sample.checks.push('Automation: resolving/waiting/refused/configure; errors retained and valid form has no ready prose');

      await show('fields');
      assert.doesNotMatch(await text(), /Full URL of the GitHub repository|Final path/);
      assert.match(await text(), /Leave empty to use the default branch/);
      await input('.desktop-cloud-automation-destination-editor input', '../outside');
      assert.ok(await present('.desktop-cloud-automation-destination-editor [role="alert"]'));
      await capture(`fields-${suffix}`);
      sample.checks.push('Provider fields: audited redundant hint suppressed; meaningful hint and invalid path retained');

      await show('agent');
      await until("!!document.querySelector('.desktop-agent-access-primary')");
      assert.equal(await evaluate("document.querySelector('.desktop-agent-access-primary').disabled"), true);
      assert.match(await evaluate("document.querySelector('.desktop-agent-access-primary').innerText"), /Connecting/);
      assert.doesNotMatch(await text(), /Your draft is saved/);
      await capture(`agent-${suffix}`);
      await show('agent', 'error'); await until("document.body.innerText.includes('Compute service is temporarily unavailable')");
      await clickText('Retry');
      await until("document.querySelector('.desktop-agent-access-primary').innerText.includes('Connecting')");
      await evaluate("window.__uiCopy.finish('managed', true)");
      await until("document.querySelector('.desktop-agent-access-primary').innerText === 'Retry' && !document.querySelector('.desktop-agent-access-primary').disabled");
      await show('diagnostics'); await click('button[aria-haspopup="menu"]');
      assert.doesNotMatch(await text(), /Diagnostics|No diagnostics/);
      await show('diagnostics', 'diagnostic'); await click('button[aria-haspopup="menu"]');
      assert.doesNotMatch(await text(), /Fixture transport detail/);
      await clickText('Diagnostics'); assert.match(await text(), /Fixture transport detail/);
      await show('diagnostics', 'readiness');
      assert.doesNotMatch(await text(), /Status code|Fixture transport detail/);
      await click('summary'); assert.match(await text(), /Status code|Fixture transport detail/);
      sample.checks.push('Agent: CTA pending; no saved-draft claim; diagnostics absent when empty and disclosed on demand');

      await show('installation');
      assert.match(await text(), /continue in the background/);
      assert.doesNotMatch(await text(), /view progress or stop at any step/);
      await show('model');
      assert.doesNotMatch(await text(), /Stored using|re-enter/i);
      await input('input[type="url"]', 'https://new.fixture.example/v1');
      assert.match(await text(), /Re-enter the API key/);
      sample.checks.push('API key: storage folded; endpoint change triggers re-entry explanation');
      await show('billing');
      await until("!!document.querySelector('.desktop-cloud-billing-current')");
      assert.doesNotMatch(await text(), /Catalog 2026|Entitlement revision|requires_action|versioned PuppyPay/);
      assert.match(await text(), /Action required/);
      assert.match(await text(), /\$36|36/);
      await capture(`billing-${suffix}`);
      await click('details summary'); assert.match(await text(), /Entitlement revision/);
      sample.checks.push('Billing: price/seat facts and understandable pending action; revisions and raw states folded');
      await show('settings'); assert.doesNotMatch(await text(), /Optional context shown|Unique identifier used/);
      await clickText('Access'); assert.match(await text(), /Only organization owners/);
      await show('team'); await until("!!document.querySelector('.desktop-cloud-org-card')");
      await show('connect'); assert.equal(await evaluate("document.querySelector('.desktop-cloud-access-landing-copy').querySelector('p')"), null);
      await show('recovery'); assert.doesNotMatch(await text(), /local files|Git remote.*unchanged/i);
      await show('git'); assert.doesNotMatch(await text(), /history and collaboration/i);
      await show('git', 'error'); assert.match(await text(), /fixture: permission denied/);
      await show('import'); assert.doesNotMatch(await text(), /Bring content from these apps/);
      sample.checks.push('Settings/Team/Connect/recovery/Git/Import: quiet headers; visibility and raw Git error preserved');
      await show('share'); assert.equal(await present('.desktop-share-preview'), false);
      await show('share-status'); assert.doesNotMatch(await text(), /Everything you save|synced copy|Synced/);
      await show('share-navigation', 'off');
      assert.equal(await evaluate("[...document.querySelectorAll('.po-sidebar-row')].some(e => e.textContent.trim() === 'Share')"), false);
      await show('share-navigation');
      assert.equal(await evaluate("[...document.querySelectorAll('.po-sidebar-row')].some(e => e.textContent.trim() === 'Share')"), true);
      await show('progress'); assert.match(await text(), /Keep PuppyOne open/); assert.doesNotMatch(await text(), /resumable|duplicate/);
      sample.checks.push('Share: experiment-off navigation omits Share, experiment-on includes it; Cloud access status without sync promise; upload retains keep-open constraint');

      for (const state of ['detecting', 'project', '', 'error']) {
        await show('preview', state);
        if (state === 'detecting') assert.equal(await evaluate("document.querySelectorAll('.app-setup-hero [role=status]').length"), 1);
        if (state === 'project') assert.match(await text(), /npm run dev/);
        if (state === 'error') assert.match(await text(), /could not check this workspace/);
      }
      await show('preview'); await until("!!document.querySelector('.app-setup-methods')");
      await clickText('Connect to a running webpageConnect to localhost or another URL');
      assert.match(await text(), /credential-free HTTP or HTTPS/);
      await capture(`preview-url-${suffix}`);
      await show('preview'); await clickText('Choose HTML filePreview directly; no start command');
      assert.match(await text(), /path relative to this App file/);
      await show('preview'); await clickText('Advanced settingsConfigure a folder and command for a special project');
      assert.ok(await present('input[placeholder="pnpm run dev"]'));
      sample.checks.push('App preview: one detecting status; command, unavailable reason, relative path and URL constraints retained');
      await show('sign-in');
      await evaluate("document.querySelector('[data-cloud-sign-in-action]').focus()");
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await show('recovery'); window.focus(); window.webContents.focus(); await evaluate("document.querySelector('summary').focus()");
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); await pause(50);
      assert.ok(await evaluate("document.querySelector('details').open"), 'Keyboard must open details');
      sample.checks.push('Keyboard: focusable CTA and Enter expands native details');
    }
  }
  assert.deepEqual(report.errors.filter(message => !message.includes('net::ERR_BLOCKED_BY_CLIENT')), []);
  report.sourceAfter = await readSourceIdentity(repo);
  assert.equal(report.sourceAfter.fingerprint, source.fingerprint, 'Source must remain unchanged during native verification');
  report.ok = true;
} catch (error) {
  report.failure = error.stack;
  report.failureText = await text().catch(() => 'Renderer unavailable');
  report.bridgeCalls = await evaluate('window.__uiCopy?.calls').catch(() => []);
}
report.completedAt = new Date().toISOString();
await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, states: report.samples.length, screenshots: report.screenshots.length, failure: report.failure, artifacts }));
clearTimeout(watchdog);
app.exit(report.ok ? 0 : 1);

}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
