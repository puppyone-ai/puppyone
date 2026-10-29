import assert from "node:assert/strict";

const cloud = '.desktop-terminal-contribution-host[aria-hidden="false"] .desktop-cloud-agent-sidebar';
const cloudEntry = "[data-cloud-workspace-tool=agent]";
// A local folder and its Cloud project are two projects (puppy-issues ADR-001):
// the folder's notice opens its Cloud project; the project menu returns to it.
const openCloudProject = "[...document.querySelectorAll('.desktop-local-folder-cloud-notice button')].find(button => button.textContent === 'Open Cloud project')";
// CodeMirror renders its placeholder inside the empty cm-line.
const draftText = `Array.from(document.querySelectorAll('${cloud} .cm-content .cm-line:not(:has(.cm-placeholder))')).map(x=>x.textContent).join('\\n')`;

/** Connect to an already signed-in production Main/preload/App, never a harness. */
export async function connectCloudAgentLiveDriver(options) {
  const targets = await (await fetch(`${options.cdp}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const pages = targets.filter(t => t.type === "page" && /^https?:/.test(t.url) && !t.url.includes("#"));
  assert.equal(pages.length, 1, "Use a debugging port with exactly one production App window");
  const socket = new WebSocket(pages[0].webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP connection timed out")), 5000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connection failed")); }, { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error("App disconnected")); }
    pending.clear();
  });
  const command = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const q = JSON.stringify;
  const request = async path => {
    const result = await evaluate(`(async()=>{
      const {session:s}=await window.puppyoneDesktop.readCloudAuthState();
      return window.puppyoneDesktop.requestCloudSessionApi({apiBaseUrl:${q(options.apiBase)},
        expectedSession:{userId:s.user_id,generation:s.session_generation},path:${q(path)},method:'GET'});
    })()`);
    assert.equal(result?.transport, "puppyone-cloud-ipc-v1", "Production authenticated IPC envelope required");
    if (!result.ok) throw Object.assign(new Error(result.error.message), { status: result.error.status });
    return result.data;
  };
  const wait = async (expression, label) => {
    const deadline = Date.now() + options.timeout;
    while (Date.now() < deadline) {
      const alerts = await evaluate(`Array.from(document.querySelectorAll('${cloud} [role=alert],.desktop-cloud-preparation [role=alert],.desktop-cloud-workspace-switch-recovery [role=alert]')).map(x=>x.innerText).join('; ')`);
      if (alerts) throw new Error(`${label}: ${alerts}`);
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const click = async selector => {
    await wait(`!!document.querySelector(${q(selector)}) && !document.querySelector(${q(selector)}).disabled`, `enabled ${selector}`);
    await evaluate(`document.querySelector(${q(selector)}).click()`);
  };
  const savedSession = async () => evaluate(`(async()=>{
    const {session}=await window.puppyoneDesktop.readCloudAuthState();
    const base=JSON.stringify(['cloud-agent-v1',${q(options.apiBase)},session.user_id,${q(options.projectId)},${q(`project:${options.projectId}`)}]);
    const id=document.querySelector('.desktop-right-sidebar .desktop-terminal-tab.is-active')?.dataset.terminalTabSessionId;
    const saved=id ? JSON.parse(localStorage.getItem(id==='primary' ? base : base+':tab:'+id)||'null') : null;
    return saved?.sessionId ? {sessionId:saved.sessionId} : null;
  })()`);
  const driver = {
    projectId: options.projectId,
    close: () => socket.close(),
    async verifyEnvironment() {
      const info = await evaluate(`(async()=>{const a=await window.puppyoneDesktop?.readCloudAuthState();return {
        status:a?.status,api:a?.session?.api_base_url,
        production:!!document.querySelector('.app-shell,.desktop-shell'),
        fixture:!!(window.__accountCloudSmoke||window.__nativeCloudWorkbenchSmoke||location.hash.includes('smoke'))};})()`);
      assert.ok(info.production && !info.fixture, "A complete production App is required; fixtures cannot pass live acceptance");
      assert.equal(info.status, "authenticated", "Sign in before running this acceptance test");
      assert.equal(info.api, options.apiBase, "Signed-in API endpoint must equal the explicit test endpoint");
    },
    async probeReceipt(id) {
      try { await request(`/agents/requests/${encodeURIComponent(options.projectId)}/${id}`); }
      catch (error) { if (error.status === 404 && /Request not found/i.test(error.message)) return; throw error; }
      throw new Error("Fresh receipt unexpectedly exists");
    },
    async selectWorkspace() {
      if (await evaluate(`document.querySelector('.desktop-titlebar-workspace-name')?.textContent===${q(options.workspace)}`)) return;
      await click(".desktop-titlebar-workspace-button");
      const item = `[...document.querySelectorAll('.desktop-project-switcher-list [role=menuitem]')].find(x=>x.textContent.trim()===${q(options.workspace)})`;
      assert.ok(await evaluate(`!!(${item})`), "Selected local project must already exist in the workspace menu");
      await evaluate(`(${item}).click()`);
      await wait(`document.querySelector('.desktop-titlebar-workspace-name')?.textContent===${q(options.workspace)}`, "selected project");
    },
    async selectLocation(name) {
      if (name === "cloud") {
        assert.ok(await evaluate(`!!(${openCloudProject})`), "Use an already hosted folder; this test never publishes a project");
        await evaluate(`(${openCloudProject}).click()`);
      } else {
        await click(".desktop-titlebar-workspace-button");
        const folder = `[...document.querySelectorAll('.desktop-project-menu .desktop-project-switcher-row[data-project-location=local]')].find(row => row.textContent.trim().startsWith(${q(options.workspace)}))`;
        assert.ok(await evaluate(`!!(${folder})`), "The selected folder must be in the project menu");
        await evaluate(`(${folder}).querySelector('button').click()`);
      }
      await wait(name === "cloud" ? `!!document.querySelector('${cloudEntry}') && !document.querySelector('${cloudEntry}').disabled`
        : `!document.querySelector('${cloudEntry}')`, `${name} project shown`);
    },
    async assertClosed() {
      assert.equal(await evaluate("document.querySelector('.desktop-right-sidebar')?.dataset.paneCollapsed"), "true", "Location switch must close the right sidebar");
    },
    async openLocalAgent() { await click(".desktop-titlebar-terminal"); await wait("document.querySelector('.desktop-right-sidebar')?.dataset.paneCollapsed==='false'", "Local Agent open"); },
    async openCloudAgent() {
      await click(cloudEntry);
      await wait(`document.querySelector('${cloud}')?.dataset.cloudAgentProject===${q(options.projectId)} && !!document.querySelector('${cloud} .cm-content')`, "selected Cloud Agent composer");
      assert.ok(await evaluate(`document.querySelector('${cloudEntry}').getAttribute('aria-expanded')==='true'`), "Cloud Agent must open directly");
    },
    async startEmptyChat() {
      // Admission starts in a new native tab; existing drafts and runs remain untouched.
      await click('.desktop-right-sidebar [aria-label="New tab"]');
      await click('.desktop-right-sidebar .desktop-terminal-launcher-tool');
      await wait(`!document.querySelector('${cloud} .desktop-agent-message')`, "new empty chat");
    },
    async sendAndReceive(marker) {
      const started = performance.now();
      let firstText;
      const prompt = `Connection test only. Reply with exactly ${marker}. Do not read or change any files, use tools, or publish changes.`;
      await click(`${cloud} .cm-content`);
      await evaluate(`document.querySelector('${cloud} .cm-content').focus()`);
      await command("Input.insertText", { text: prompt });
      await wait(`(${draftText})===${q(prompt)}`, "prompt entered");
      await click(`${cloud} .desktop-agent-composer-action:not(.is-stop)`);
      await wait(`!(${draftText}).trim()`, "server admission and cleared composer");
      const admitted = performance.now();
      const saved = await savedSession();
      assert.ok(saved?.sessionId, "Accepted session must be retained");
      const deadline = Date.now() + options.timeout;
      while (Date.now() < deadline) {
        const runs = await request(`/agents/sessions/${saved.sessionId}/runs?limit=100`);
        const receipt = runs.find(run => run.prompt === prompt);
        assert.ok(runs.filter(run => run.prompt === prompt).length <= 1, "No duplicate admission for one message");
        if (receipt) {
          const run = await request(`/agents/runs/${receipt.id}`);
          if (run.snapshot?.text && firstText === undefined) firstText = performance.now();
          if (run.state === "succeeded") return { ...run, acceptance_timing: {
            admission_ms: admitted - started,
            first_text_observed_ms: firstText === undefined ? null : firstText - started,
            completed_ms: performance.now() - started,
            observation: "client polling; includes transport and poll interval",
          }};
          if (!["queued", "running", "waiting_approval", "publishing"].includes(run.state)) throw new Error(`Run ended as ${run.state}: ${run.snapshot?.code || ''}`);
          if (run.state === "waiting_approval") throw new Error("Connectivity prompt unexpectedly requested tools/approval");
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error("Cloud worker did not complete the accepted run");
    },
    async assertAssistantReply(_id, marker) {
      await wait(`!![...document.querySelectorAll('${cloud} .desktop-agent-message.is-assistant')].find(x=>x.textContent.includes(${q(marker)})) && document.querySelector('${cloud} .desktop-agent-boundary')?.dataset.phase==='succeeded'`, "assistant reply rendered after server success");
    },
    async assertSessionRuns(id, ids) {
      const runs = await request(`/agents/sessions/${id}/runs?limit=100`);
      assert.equal(runs.length, ids.length, "New test conversation contains exactly three runs");
      assert.deepEqual(runs.map(run => run.id).sort(), [...ids].sort());
    },
  };
  return driver;
}
