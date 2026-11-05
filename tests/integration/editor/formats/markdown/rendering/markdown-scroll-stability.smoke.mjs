#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as reservePort } from "node:net";
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import { readSourceIdentity } from "../../../../../../scripts/release-checks/execution.mjs";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-scroll-stability-"));
const artifactRoot = path.join(root, "artifacts/tests/scroll-stability");
await fs.mkdir(artifactRoot, { recursive: true });
const directory = await fs.mkdtemp(path.join(artifactRoot, "run-"));
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, vite;
const results = [];
let source;
const failures = [];
const evaluate = source => window.webContents.executeJavaScript(source);
const call = (method, ...args) => evaluate(`window.scrollFixture[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
async function scenario(name, test) {
  try { const detail = await test(); results.push({ name, passed: true, ...detail }); console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); results.push({ name, passed: false, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function wheelToEnd(pane = "primary") {
  const point = await evaluate(`(() => { const r = document.querySelector('#${pane} .cm-scroller').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  await call("startSampling", pane);
  let stalled = 0, previous = -1;
  for (let step = 0; step < 400; step++) {
    window.webContents.sendInputEvent({ type: "mouseWheel", ...point, deltaY: -120, canScroll: true });
    await wait(90);
    const now = await call("geometry", pane);
    stalled = Math.abs(now.scrollTop - previous) < 1 ? stalled + 1 : 0; previous = now.scrollTop;
    if (stalled >= 10 && now.scrollTop >= now.maxScroll - 1) break;
    if (stalled >= 30) break;
  }
  await wait(600);
  const samples = await call("stopSampling");
  const geometry = await call("geometry", pane);
  assert(samples.length >= 20, "No continuous rendered frame samples");
  if (geometry.scrollTop < geometry.maxScroll - 1) {
    await fs.writeFile(path.join(directory, `incomplete-${Date.now()}.json`), JSON.stringify({ samples, geometry }));
    assert.fail(`Did not reach the document end: ${JSON.stringify(geometry)}`);
  }
  const maxBackward = Math.max(0, ...samples.slice(1).map((s, i) => samples[i].scrollTop - s.scrollTop));
  const maxHeightDrop = Math.max(0, ...samples.slice(1).map((s, i) => samples[i].scrollHeight - s.scrollHeight));
  return { samples, geometry, maxBackward, maxHeightDrop, scrollWrites: await call("scrollWrites") };
}
app.whenReady().then(async () => {
  try {
    source = await readSourceIdentity(root);
    const reservation = reservePort(); await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    vite = await createServer({ root, cacheDir: path.join(temporary, "vite"), logLevel: "error", server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } }); await vite.listen();
    window = new BrowserWindow({ width: 1100, height: 760, show: true, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    for (const slow of [false, true]) {
      await window.loadURL(`http://127.0.0.1:${port}/tests/fixtures/editor/formats/markdown/scroll-stability.html${slow ? "?slow=1" : ""}`);
      await evaluate("(async () => { for(let i=0;i<800&&!window.scrollFixture;i++) await new Promise(r=>setTimeout(r,10)); if(!window.scrollFixture)throw Error('Missing fixture'); await window.scrollFixture.ready(); })()");
      const label = slow ? "slow" : "normal";
      const first = await wheelToEnd();
      await fs.writeFile(path.join(directory, `${label}-first.json`), JSON.stringify(first));
      await scenario(`${label}: down-scroll never reverses`, () => { assert(first.maxBackward <= 2, `scrollTop went back ${first.maxBackward}px`); return { maxBackward: first.maxBackward }; });
      await scenario(`${label}: first pass height never collapses`, () => { assert(first.maxHeightDrop <= 8, `document height shrank ${first.maxHeightDrop}px`); return { maxHeightDrop: first.maxHeightDrop }; });
      const measured = await call("lineHeights"); await call("setScrollTop", 0); await wait(600);
      await scenario(`${label}: offscreen image lines retain geometry`, async () => { const after = await call("lineHeights"); const ratio = Math.min(...after.map((row, i) => row.inMap / measured[i].inMap)); assert(ratio >= .95, `offscreen height retained only ${ratio}`); return { measured, after, ratio }; });
      const second = await wheelToEnd(); await fs.writeFile(path.join(directory, `${label}-second.json`), JSON.stringify(second));
      await scenario(`${label}: second pass stays smooth`, () => { assert(second.maxBackward <= 2 && second.maxHeightDrop <= 8, `second pass reversed ${second.maxBackward}px; height dropped ${second.maxHeightDrop}px`); return { maxBackward: second.maxBackward, maxHeightDrop: second.maxHeightDrop }; });
    }
    await scenario("a final image without a newline can reach and stay at the end", async () => {
      await evaluate("window.scrollFixture.configure({ documentPath: 'no-newline.md', value: window.scrollFixture.originalNote.trimEnd() })"); await wait(700);
      await call("setScrollTop", 0); await wait(300);
      const pass = await wheelToEnd(); await fs.writeFile(path.join(directory, "no-newline.json"), JSON.stringify(pass));
      assert(pass.maxBackward <= 2 && pass.maxHeightDrop <= 8, `No-newline document reversed ${pass.maxBackward}px; height dropped ${pass.maxHeightDrop}px`);
      const before = await call("geometry"); await wait(800); const after = await call("geometry");
      assert(Math.abs(after.scrollTop - before.scrollTop) <= 2, "Last image drifted after wheel input stopped");
      return { maxBackward: pass.maxBackward, maxHeightDrop: pass.maxHeightDrop, before, after };
    });
    await scenario("narrower pane fits the natural aspect ratio and stays smooth on revisit", async () => {
      const before = (await call("images")).find(image => image.alt === "photo-5"); assert(before, "Last image not mounted");
      window.setContentSize(650, 760); await wait(700); await call("visitImage", 4); await wait(600);
      const after = (await call("images")).find(image => image.alt === "photo-5");
      assert(after && after.width < before.width && after.height < before.height, "Image retained its old pane size");
      assert(Math.abs(after.height - after.width * after.naturalHeight / after.naturalWidth) <= 1, "Responsive image lost its natural aspect ratio");
      await call("setScrollTop", 0); await wait(600); const pass = await wheelToEnd();
      await fs.writeFile(path.join(directory, "narrow-pass.json"), JSON.stringify(pass));
      assert(pass.maxBackward <= 2 && pass.maxHeightDrop <= 8, `Narrow revisit reversed ${pass.maxBackward}px; height dropped ${pass.maxHeightDrop}px`);
      return { before, after, maxBackward: pass.maxBackward, maxHeightDrop: pass.maxHeightDrop };
    });
    await scenario("the same source fits two independent panes", async () => {
      window.setContentSize(1100, 760); await call("configure", { second: true }); await wait(700);
      for (const pane of ["primary", "secondary"]) { await call("visitImage", 4, pane); await wait(600); }
      const primary = (await call("images", "primary")).find(image => image.alt === "photo-5");
      const secondary = (await call("images", "secondary")).find(image => image.alt === "photo-5");
      assert(primary && secondary && primary.width > secondary.width && primary.height > secondary.height, "Panes shared a rendered pixel height");
      for (const image of [primary, secondary]) assert(Math.abs(image.height - image.width * image.naturalHeight / image.naturalWidth) <= 1, "Pane image ratio is wrong");
      for (const pane of ["primary", "secondary"]) {
        await call("setScrollTop", 0, pane); await wait(600); const pass = await wheelToEnd(pane);
        await fs.writeFile(path.join(directory, `${pane}-pass.json`), JSON.stringify(pass));
        assert(pass.maxBackward <= 2 && pass.maxHeightDrop <= 8, `${pane} reversed ${pass.maxBackward}px; height dropped ${pass.maxHeightDrop}px`);
      }
      return { primary, secondary };
    });
    await scenario("failed resources and document replacement release reserved boxes", async () => {
      await call("configure", { second: false, failed: true, revision: 1, documentPath: "broken.md", value: "![broken](photo-1.svg)\n\n![broken](photo-2.svg)" }); await wait(1000);
      const heights = await call("lineHeights");
      assert(heights.length === 2 && heights.every(row => row.inMap < 200), "Failed resource reserved a stale tall box");
      assert.equal(await evaluate("document.querySelectorAll('#primary .cm-md-image-placeholder.is-loading').length"), 0);
      await call("configure", { value: "" }); await wait(200);
      assert.equal((await call("lineHeights")).length, 0, "Cleared document retained image geometry");
      return { heights };
    });
    const notePath = process.argv.find(arg => arg.startsWith("--note="))?.slice(7);
    const assetRoot = process.argv.find(arg => arg.startsWith("--asset-root="))?.slice(13);
    if (notePath) await scenario("real note and JPEGs remain unchanged and scroll smoothly", async () => {
      assert(assetRoot, "--asset-root is required for the read-only note fixture");
      const original = await fs.readFile(notePath); const hash = value => createHash("sha256").update(value).digest("hex");
      const content = original.toString("utf8");
      const names = [...new Set([...content.matchAll(/!\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/g)].map(match => path.basename(match[1])))];
      assert(names.length >= 5, "Real-note scenario requires the reported image sequence");
      const assets = {}, hashes = {};
      for (const name of names) {
        const bytes = await fs.readFile(path.join(assetRoot, name)); hashes[name] = hash(bytes);
        assets[name] = { mime: "image/jpeg", base64: bytes.toString("base64") };
      }
      await call("realAssets", assets);
      window.setContentSize(1100, 760);
      await call("configure", { documentPath: "read-only-real-note.md", value: content, failed: false, revision: 2, second: false }); await wait(700);
      await call("setScrollTop", 0); await wait(300);
      for (const passName of ["first", "second"]) {
        const pass = await wheelToEnd(); await fs.writeFile(path.join(directory, `real-note-${passName}.json`), JSON.stringify(pass));
        assert(pass.maxBackward <= 2 && pass.maxHeightDrop <= 8, `Real note ${passName} reversed ${pass.maxBackward}px; height dropped ${pass.maxHeightDrop}px`);
        if (passName === "first") { await call("setScrollTop", 0); await wait(600); }
      }
      assert.equal(hash(await fs.readFile(notePath)), hash(original), "Original note was changed");
      for (const name of names) assert.equal(hash(await fs.readFile(path.join(assetRoot, name))), hashes[name], "Original asset was changed");
      return { noteSha256: hash(original), assets: hashes, noteReadOnly: true };
    });
    await fs.writeFile(path.join(directory, "final.png"), (await window.webContents.capturePage()).toPNG());
  } catch (error) { failures.push(error.stack); }
  finally {
    const sourceAfter = await readSourceIdentity(root);
    if (source?.fingerprint !== sourceAfter.fingerprint) failures.push("Source changed during scroll stability verification");
    await fs.writeFile(path.join(directory, "result.json"), JSON.stringify({ passed: !failures.length, source, sourceAfter, system: { electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform }, results, failures }, null, 2));
    console.log(`SCROLL_STABILITY_ARTIFACTS ${directory}`);
    for (const failure of failures) console.error(failure);
    window?.destroy(); await vite?.close(); await fs.rm(temporary, { recursive: true, force: true }); app.exit(failures.length ? 1 : 0);
  }
});
