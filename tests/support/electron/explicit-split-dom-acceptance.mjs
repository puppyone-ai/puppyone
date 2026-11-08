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
  const installProbe = async () => {
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
        const target = document.elementFromPoint(x, y);
        if (!target || !pane.contains(target)) throw new Error('Drop coordinate is outside the visible pane');
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: y }));
      },
      image: 'puppyone-local://workspace/smoke-root/assets/photo%20%231%25.png',
      file: 'puppyone-local://workspace/smoke-root/docs/%E4%B8%AD%E6%96%87%20file.md',
    }; true`);
  };
  const reveal = async () => {
    await evaluate(`(() => {
      const r = document.querySelector('[data-editor-pane-id]').getBoundingClientRect();
      splitProbe.send('dragover', splitProbe.transfer('photo #1%.png', splitProbe.image), r.x + r.width / 2, r.y + r.height / 2);
    })()`);
    await until("document.querySelectorAll('[data-file-split-edge]').length === 4");
  };
  const geometry = () => evaluate(`(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { pane: rect(document.querySelector('[data-editor-pane-id]')),
      cards: Array.from(document.querySelectorAll('[data-file-split-edge]'), card => ({ edge: card.dataset.fileSplitEdge, ...rect(card) })) };
  })()`);
  const hover = async card => {
    await evaluate(`splitProbe.send('dragover', splitProbe.transfer('中文 file.md', splitProbe.file), ${card.x + card.width / 2}, ${card.y + card.height / 2})`);
    assert.equal(await evaluate(`document.querySelector('[data-file-split-edge="${card.edge}"]').dataset.active`), "true");
    assert.equal(await evaluate("document.querySelector('.desktop-editor-drop-preview').dataset.edge"), card.edge);
  };
  await installProbe();
  await reveal();
  const geometries = [];
  for (const [width, height] of [[1120, 700], [380, 700], [1120, 150], [380, 150]]) {
    window.setContentSize(width, height);
    await until(`innerWidth === ${width} && innerHeight === ${height}`);
    const sample = await geometry();
    assert.equal(sample.pane.width, width - 230);
    assert.equal(sample.pane.height, height);
    assertSeparateCards(sample);
    for (const card of sample.cards) await hover(card);
    geometries.push(sample);
    await fs.writeFile(path.join(directory, `cards-${width}x${height}.png`), (await window.webContents.capturePage()).toPNG());
  }
  window.setContentSize(1120, 700);
  await until("innerWidth === 1120 && innerHeight === 700");
  // Moving from a card back to the document center must insert, not split.
  await evaluate(`(() => {
    const r = document.querySelector('[data-editor-pane-id]').getBoundingClientRect();
    const data = splitProbe.transfer('photo #1%.png', splitProbe.image);
    splitProbe.send('dragover', data, r.x + r.width / 2, r.y + r.height / 2);
  })()`);
  await until("document.querySelector('[data-editor-pane-id]').dataset.dropKind === 'insert'");
  assert.equal(await evaluate("document.querySelectorAll('.desktop-editor-drop-preview').length"), 0);
  await evaluate(`(() => {
    const r = document.querySelector('[data-editor-pane-id]').getBoundingClientRect();
    splitProbe.send('drop', splitProbe.transfer('photo #1%.png', splitProbe.image), r.x + r.width / 2, r.y + r.height / 2);
  })()`);
  await until("Boolean(document.querySelector('img[data-preview-state=ready]'))");
  for (let attempt = 0; attempt < 200 && !entries.some(entry => entry.persisted && entry.content?.includes('![photo #1%]')); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const saved = await fs.readFile(path.join(temporaryRoot, "existing.md"), "utf8");
  assert(saved.includes("(<assets/photo %231%25.png>)"));
  assert.equal(await evaluate("document.querySelectorAll('[data-editor-pane-id]').length"), 1);
  const splits = [];
  for (const edge of ["left", "right", "top", "bottom"]) {
    if (splits.length) {
      await window.loadURL(window.webContents.getURL());
      await installProbe();
      await until("document.querySelectorAll('[data-editor-pane-id]').length === 1");
    }
    await reveal();
    const sample = await geometry();
    await hover(sample.cards.find(card => card.edge === edge));
    await evaluate(`(() => {
      const r = document.querySelector('[data-file-split-edge="${edge}"]').getBoundingClientRect();
      splitProbe.send('drop', splitProbe.transfer('中文 file.md', splitProbe.file), r.x + r.width / 2, r.y + r.height / 2);
    })()`);
    await until("document.querySelectorAll('[data-editor-pane-id]').length === 2 && document.querySelectorAll('.cm-editor').length === 2");
    assert.equal(await evaluate("document.querySelectorAll('[data-file-split-targets]').length"), 0);
    const panes = await evaluate(`Array.from(document.querySelectorAll('[data-editor-pane-id]'), pane => {
      const r = pane.getBoundingClientRect(); return { label: pane.getAttribute('aria-label'), x: r.x, y: r.y, width: r.width, height: r.height };
    })`);
    const original = panes.find(pane => pane.label.includes('existing.md'));
    const added = panes.find(pane => pane.label.includes('中文 file.md'));
    assert(original && added, `Missing documents after ${edge} split`);
    if (edge === "left") assert(added.x + added.width <= original.x);
    if (edge === "right") assert(original.x + original.width <= added.x);
    if (edge === "top") assert(added.y + added.height <= original.y);
    if (edge === "bottom") assert(original.y + original.height <= added.y);
    assert.equal(await fs.readFile(path.join(temporaryRoot, "existing.md"), "utf8"), saved, "Split edited the original document");
    splits.push({ edge, panes });
    await fs.writeFile(path.join(directory, `split-${edge}.png`), (await window.webContents.capturePage()).toPNG());
  }
  // Exercise a real split at the supported minimum ratio, not only a small
  // window. Keyboard resizing commits through the production layout controller.
  for (let step = 1; step <= 14; step++) {
    await evaluate(`document.querySelector('.desktop-editor-splitter[data-direction="vertical"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))`);
    await until(`document.querySelector('.desktop-editor-splitter').getAttribute('aria-valuenow') === '${Math.round(50 - step * 2.5)}'`);
  }
  await reveal();
  const nested = await geometry();
  assert(nested.pane.height > 100 && nested.pane.height < 110, "Minimum split ratio did not produce a short pane");
  assertSeparateCards(nested);
  for (const card of nested.cards) await hover(card);
  await fs.writeFile(path.join(directory, "cards-minimum-split.png"), (await window.webContents.capturePage()).toPNG());
  const sourceAfter = await readSourceIdentity(repoRoot);
  assert.equal(sourceAfter.fingerprint, source.fingerprint, "Source changed during DOM split acceptance");
  await fs.writeFile(path.join(directory, "result.json"), JSON.stringify({ passed: true, source, sourceAfter, input: "Synthetic renderer DragEvent in isolated hidden test window", geometries, splits, nested, checks: ["four visible cards", "narrow/short pane disjoint targets", "minimum split ratio", "four card highlights", "body image persistence", "four split placements", "drop cleanup"] }, null, 2));
  console.log(`DOM_SPLIT_ACCEPTANCE ${directory}`);
}

function assertSeparateCards({ pane, cards }) {
  assert.deepEqual(cards.map(card => card.edge).sort(), ["bottom", "left", "right", "top"]);
  for (const card of cards) {
    assert(card.width > 0 && card.height > 0, `Hidden ${card.edge} card`);
    assert(card.x >= pane.x && card.y >= pane.y && card.x + card.width <= pane.x + pane.width && card.y + card.height <= pane.y + pane.height, `${card.edge} card escapes pane`);
    const cx = pane.x + pane.width / 2, cy = pane.y + pane.height / 2;
    assert(!(cx >= card.x && cx < card.x + card.width && cy >= card.y && cy < card.y + card.height), "Card swallowed document center");
    for (const other of cards) {
      if (other === card) continue;
      assert(card.x + card.width <= other.x || other.x + other.width <= card.x || card.y + card.height <= other.y || other.y + other.height <= card.y, `${card.edge}/${other.edge} overlap`);
    }
  }
}
