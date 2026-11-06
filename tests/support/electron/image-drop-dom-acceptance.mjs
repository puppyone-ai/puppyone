import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { readSourceIdentity } from "../../../scripts/release-checks/execution.mjs";

/** Real Chromium layout and production persistence, with synthetic HTML drag
 * input in an isolated window. OS-native receipt admission has its own smoke. */
export async function runImageDropDomAcceptance({ window, entries, temporaryRoot, repoRoot }) {
  const identity = await readSourceIdentity(repoRoot);
  const evaluate = source => window.webContents.executeJavaScript(source);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async source => {
    for (let attempt = 0; attempt < 160; attempt++) {
      const result = await evaluate(source);
      if (result) return result;
      await wait(50);
    }
    throw new Error(`Image drop acceptance timed out: ${source}`);
  };
  const base = path.join(repoRoot, "artifacts/tests/native-resource-drag");
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, "image-drop-"));
  const documentFile = path.join(temporaryRoot, "existing.md");
  const snippet = "![photo #1%](<assets/photo %231%25.png>)";
  const checks = [];
  const install = async () => {
    await until("Boolean(document.querySelector('[data-preview-state=ready] .cm-content') && window.imageDropFixture)");
    await evaluate(`window.dropProbe = {
      send(type, x, y) {
        const data = new DataTransfer();
        data.setData('application/x-puppyone-workspace-entries+json', JSON.stringify({ version: 1,
          workspaceId: 'smoke-workbench', entries: [{ path: 'puppyone-local://workspace/smoke-root/assets/photo%20%231%25.png', name: 'photo #1%.png', entryType: 'file' }] }));
        const target = document.elementFromPoint(x, y);
        if (!target) throw new Error('No hit target');
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: y }));
      },
      line(text) {
        const el = [...document.querySelectorAll('.cm-line')].find(el => el.textContent.includes(text));
        if (!el) throw new Error('Missing line ' + text);
        const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height };
      },
      sample() {
        const s = document.querySelector('.cm-scroller'), p = document.querySelector('[data-editor-pane-id]').getBoundingClientRect();
        const marker = document.querySelector('.cm-md-image-drop-indicator'), r = marker.getBoundingClientRect();
        return { source: imageDropFixture.source(), selection: imageDropFixture.selection(), scrollTop: s.scrollTop,
          scrollHeight: s.scrollHeight, visible: !marker.hidden && r.height > 0, markerY: (r.top+r.bottom)/2,
          markerWidth: r.width, markerHeight: r.height, x: p.left + p.width * .22 };
      }
    }; true`);
  };
  const load = async content => {
    await fs.writeFile(documentFile, content);
    await window.loadURL(window.webContents.getURL());
    await install();
    await until(`imageDropFixture.source() === ${JSON.stringify(content)}`);
  };
  const sample = () => evaluate("dropProbe.sample()");
  const send = (type, x, y) => evaluate(`dropProbe.send(${JSON.stringify(type)}, ${x}, ${y})`);
  const saved = async expected => {
    await until(`imageDropFixture.source() === ${JSON.stringify(expected)}`);
    for (let i = 0; i < 160; i++) {
      if (await fs.readFile(documentFile, "utf8") === expected) return;
      await wait(50);
    }
    assert.fail("Source was not persisted to disk");
  };

  const first = "第一段。这里是一段会自动换行的中文正文。".repeat(8);
  const second = "第二段。图片应该放在这段之前。";
  const original = `${first}\n\n${second}\n`;
  await load(original);
  const baseline = await sample();
  const writes = entries.filter(entry => entry.persisted).length;
  const a = await evaluate("dropProbe.line('第一段')"), b = await evaluate("dropProbe.line('第二段')");
  const positions = [a.bottom - a.height * .2, (a.bottom + b.top) / 2, b.top + b.height * .2];
  const previews = [];
  for (const y of positions) {
    await send("dragover", baseline.x, y);
    await wait(70);
    const current = await sample();
    assert(current.visible && current.markerWidth > 100 && current.markerHeight === 2, "Missing horizontal insertion line");
    assert.equal(current.source, original, "Hover changed source");
    assert.deepEqual(current.selection, baseline.selection, "Hover changed selection");
    assert.equal(current.scrollHeight, baseline.scrollHeight, "Hover changed document height");
    assert.equal(current.scrollTop, baseline.scrollTop, "Hover moved the viewport");
    previews.push(current);
  }
  assert(previews.every(item => Math.abs(item.markerY - previews[0].markerY) < 1), "Before/after/gap disagree");
  assert.equal(entries.filter(entry => entry.persisted).length, writes, "Hover wrote a document");
  await fs.writeFile(path.join(directory, "paragraph-boundary.png"), (await window.webContents.capturePage()).toPNG());
  checks.push("wrapped CJK before/after/gap share one visible line", "hover preserves source, selection, scrollTop, scrollHeight and disk");

  for (const edge of ["left", "right", "top", "bottom"]) {
    const rect = await evaluate(`(() => { const r = document.querySelector('[data-file-split-edge=${edge}]').getBoundingClientRect(); return { x: r.x+r.width/2, y:r.y+r.height/2 }; })()`);
    await send("dragover", rect.x, rect.y);
    assert.equal((await sample()).visible, false, `${edge} split left insertion line behind`);
    assert.equal(await evaluate("document.querySelector('.desktop-editor-drop-preview')?.dataset.edge"), edge);
    await send("dragover", baseline.x, positions[1]);
    assert((await sample()).visible);
  }
  for (const event of ["escape", "blur", "dragend"]) {
    await evaluate(event === "escape" ? "window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))"
      : `window.dispatchEvent(new Event(${JSON.stringify(event)}))`);
    assert.equal((await sample()).visible, false, `${event} left a marker behind`);
    await send("dragover", baseline.x, positions[1]);
  }
  await send("drop", baseline.x, positions[1]);
  const expected = `${first}\n\n${snippet}\n\n${second}\n`;
  await saved(expected);
  assert.equal((await sample()).visible, false);
  await window.loadURL(window.webContents.getURL());
  await install();
  await until("Boolean(document.querySelector('img[data-preview-state=ready]'))");
  assert.equal((await sample()).source, expected, "Reload lost the image reference");
  await fs.writeFile(path.join(directory, "inserted-and-reloaded.png"), (await window.webContents.capturePage()).toPNG());
  checks.push("four split cards exclude insertion", "Escape/blur/dragend/drop clear marker", "previewed paragraph insertion persists and renders after reload");

  await load("");
  const empty = await sample();
  await send("dragover", empty.x, 300);
  assert((await sample()).visible, "Empty document has no marker");
  await send("drop", empty.x, 300);
  await saved(snippet);
  checks.push("empty document insertion");

  const tall = "这是同一个很长的段落，不能在中间拆开插图。".repeat(320) + "\n\n最后一段。";
  await load(tall);
  await evaluate("document.querySelector('.cm-scroller').scrollTop = 1000");
  await wait(120);
  const longStart = await sample();
  await send("dragover", longStart.x, 350);
  assert.equal((await sample()).visible, false, "Tall paragraph invented a viewport-edge boundary");
  const edgeY = await evaluate("document.querySelector('.cm-scroller').getBoundingClientRect().bottom - 8");
  await send("dragover", longStart.x, edgeY);
  await until(`document.querySelector('.cm-scroller').scrollTop > ${longStart.scrollTop + 60}`);
  await evaluate("window.dispatchEvent(new Event('dragend'))");
  const stopped = await sample();
  await wait(180);
  assert.equal((await sample()).scrollTop, stopped.scrollTop, "Autoscroll survived cancellation");
  assert.equal((await sample()).source, tall);
  checks.push("offscreen paragraph boundary is not advertised", "stationary edge drag autoscrolls and cancellation stops it");

  const identityAfter = await readSourceIdentity(repoRoot);
  assert.equal(identity.fingerprint, identityAfter.fingerprint, "Source changed during acceptance");
  await fs.writeFile(path.join(directory, "result.json"), JSON.stringify({ passed: true, input: "Synthetic renderer DragEvent in isolated Electron window", identity, identityAfter, checks, previews }, null, 2));
  console.log(`IMAGE_DROP_DOM_ACCEPTANCE ${directory}`);
}
