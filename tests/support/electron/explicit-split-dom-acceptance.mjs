import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { readSourceIdentity } from "../../../scripts/release-checks/execution.mjs";

/** Renderer/layout acceptance only. Native Files admission is covered separately. */
export async function runExplicitSplitDomAcceptance({ window, entries, temporaryRoot, repoRoot }) {
  const source = await readSourceIdentity(repoRoot);
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  const until = async (source) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await evaluate(source);
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`DOM split acceptance timed out: ${source}`);
  };
  await fs.mkdir(path.join(repoRoot, "artifacts/tests/native-resource-drag"), { recursive: true });
  const directory = await fs.mkdtemp(path.join(repoRoot, "artifacts/tests/native-resource-drag/dom-split-"));
  await until("Boolean(document.querySelector('.cm-content'))");
  await evaluate(`window.splitProbe = {
    transfer(name, resource) {
      const data = new DataTransfer();
      data.setData('application/x-puppyone-workspace-entries+json', JSON.stringify({
        version: 1, workspaceId: 'smoke-workbench', entries: [{ path: resource, name, entryType: 'file' }],
      }));
      return data;
    },
    send(type, data, x, y) {
      const pane = document.querySelector('[data-editor-pane-id]');
      const target = document.elementFromPoint(x, y) || pane;
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: y }));
    },
    image: 'puppyone-local://workspace/smoke-root/assets/photo%20%231%25.png',
    file: 'puppyone-local://workspace/smoke-root/docs/%E4%B8%AD%E6%96%87%20file.md',
  }; true`);
  // The first over reveals shell cards. Read their real CSS boxes, not a ratio.
  await evaluate(`(() => {
    const r = document.querySelector('.cm-content').getBoundingClientRect();
    splitProbe.send('dragover', splitProbe.transfer('photo #1%.png', splitProbe.image), r.x + r.width / 2, r.y + 20);
  })()`);
  await until("document.querySelectorAll('[data-file-split-edge]').length === 2");
  const cards = await evaluate(`Array.from(document.querySelectorAll('[data-file-split-edge]'), card => {
    const r = card.getBoundingClientRect();
    return { edge: card.dataset.fileSplitEdge, x: r.x, y: r.y, width: r.width, height: r.height };
  })`);
  assert(cards.every(card => card.width >= 72 && card.height > 100));
  assert(cards[0].x + cards[0].width < cards[1].x, "Cards swallowed the document's insertion area");
  const right = cards[1];
  await evaluate(`splitProbe.send('dragover', splitProbe.transfer('中文 file.md', splitProbe.file), ${right.x + right.width / 2}, ${right.y + right.height / 2})`);
  assert.equal(await evaluate("document.querySelector('[data-file-split-edge=right]').dataset.active"), "true");
  await fs.writeFile(path.join(directory, "split-cards.png"), (await window.webContents.capturePage()).toPNG());
  // A supported nested split can leave only 150px for a pane. Both cards
  // must remain separate and the visible right card must still hit right.
  window.setContentSize(380, 700);
  const narrow = await until(`(() => {
    const pane = document.querySelector('[data-editor-pane-id]').getBoundingClientRect();
    if (pane.width > 160) return null;
    return Array.from(document.querySelectorAll('[data-file-split-edge]'), card => {
      const r = card.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  })()`);
  assert(narrow[0].x + narrow[0].width < narrow[1].x, "Narrow pane cards overlap");
  await evaluate(`splitProbe.send('dragover', splitProbe.transfer('中文 file.md', splitProbe.file), ${narrow[1].x + narrow[1].width / 2}, ${narrow[1].y + narrow[1].height / 2})`);
  assert.equal(await evaluate("document.querySelector('[data-file-split-edge=right]').dataset.active"), "true");
  window.setContentSize(1120, 700);
  await until("document.querySelector('[data-editor-pane-id]').getBoundingClientRect().width > 800");
  // Moving back into text must clear the split highlight and insert in place.
  await evaluate(`(() => {
    const r = document.querySelector('.cm-line').getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const data = splitProbe.transfer('photo #1%.png', splitProbe.image);
    splitProbe.send('dragover', data, x, y);
    splitProbe.send('drop', data, x, y);
  })()`);
  await until("Boolean(document.querySelector('img[data-preview-state=ready]'))");
  for (let attempt = 0; attempt < 200 && !entries.some(entry => entry.persisted && entry.content?.includes('![photo #1%]')); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert((await fs.readFile(path.join(temporaryRoot, "existing.md"), "utf8")).includes("(<assets/photo %231%25.png>)"));
  assert.equal(await evaluate("document.querySelectorAll('[data-editor-pane-id]').length"), 1);
  await evaluate(`(() => {
    const pane = document.querySelector('[data-editor-pane-id]').getBoundingClientRect();
    splitProbe.send('dragover', splitProbe.transfer('中文 file.md', splitProbe.file), pane.x + pane.width / 2, pane.y + pane.height / 2);
  })()`);
  await until("document.querySelectorAll('[data-file-split-edge]').length === 2");
  await evaluate(`(() => {
    const r = document.querySelector('[data-file-split-edge=right]').getBoundingClientRect();
    const data = splitProbe.transfer('中文 file.md', splitProbe.file);
    splitProbe.send('dragover', data, r.x + r.width / 2, r.y + r.height / 2);
    splitProbe.send('drop', data, r.x + r.width / 2, r.y + r.height / 2);
  })()`);
  await until("document.querySelectorAll('[data-editor-pane-id]').length === 2");
  assert.equal(await evaluate("document.querySelectorAll('[data-file-split-targets]').length"), 0);
  await fs.writeFile(path.join(directory, "split-result.png"), (await window.webContents.capturePage()).toPNG());
  const sourceAfter = await readSourceIdentity(repoRoot);
  assert.equal(sourceAfter.fingerprint, source.fingerprint, "Source changed during DOM split acceptance");
  await fs.writeFile(path.join(directory, "result.json"), JSON.stringify({ passed: true, source, sourceAfter, input: "Synthetic renderer DragEvent in isolated hidden test window", cards, narrow, checks: ["visible card bounds", "narrow pane disjoint targets", "card highlight", "body image persistence", "explicit card split", "drop cleanup"] }, null, 2));
  console.log(`DOM_SPLIT_ACCEPTANCE ${directory}`);
}
