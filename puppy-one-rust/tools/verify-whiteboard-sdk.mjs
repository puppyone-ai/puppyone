#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {productRoot} from './product-bundle.mjs';
import {hostPatcher, requireInstalledHostPatches} from './excalidraw-host-contract.mjs';
const product = await productRoot();
const patcher = await hostPatcher(product);
const checks = [];
for (const build of ['dev', 'prod']) {
  const installed = await readFile(path.join(product, 'node_modules/@excalidraw/excalidraw/dist', build, 'index.js'), 'utf8');
  requireInstalledHostPatches(installed, build, patcher);
  const patches = patcher.excalidrawHostPatches[build];
  const unpatch = text => patches.reduce((text, {before, after}) => text.replace(after, () => before), text);
  const upstream = unpatch(installed);
  const result = patcher.patchExcalidrawHostIntegration(upstream, build);
  assert.equal(result.changed, true);
  assert.equal(result.source, installed);
  assert.equal(unpatch(result.source), upstream);
  assert.ok(result.source.includes('matchMedia?.("(pointer: coarse)")'));
  for (const [marker, count] of [['getElementById("desktop-overlay-root")',2],['Puppyone container coordinates',2],['Puppyone measured offsets',1]]) {
    assert.equal(result.source.split(marker).length - 1, count);
  }
  checks.push(`${build}:desktop-layout-overlay-and-offsets`);
  assert.deepEqual(patcher.patchExcalidrawHostIntegration(installed, build), {changed:false,source:installed});
  assert.throws(() => requireInstalledHostPatches(upstream, build, patcher), /missing required host patches/);
  for (const {before, after} of patches) {
    assert.throws(() => patcher.patchExcalidrawHostIntegration(upstream.replace(before,''), build), /review/);
    // A partial SDK still containing the other marker strings must be refused.
    assert.throws(() => requireInstalledHostPatches(installed.replace(after,before), build, patcher), /missing required host patches/);
  }
  assert.throws(() => patcher.patchExcalidrawHostIntegration(upstream+upstream, build), /review/);
  checks.push(`${build}:idempotent-and-fail-closed`);
  const observer = installed.match(/new ResizeObserver\(\(\)\s*=>\s*\{([^{}]*(?:\{\}[^{}]*)*)\}\)/g)?.find(s=>s.includes('Puppyone breakpoint repaint'));
  assert.ok(observer);
  let callback;
  const ResizeObserver = class {constructor(listener) {callback=listener;}};
  let mobile=false;const renders=[];
  const host={refreshEditorBreakpoints:()=>{const changed=!mobile;mobile=true;return changed;},updateDOMRect:()=>{},setState:()=>renders.push(mobile)};
  new Function('ResizeObserver',`return ${observer}`).call(host,ResizeObserver);
  callback();assert.deepEqual(renders,[true]);callback();assert.deepEqual(renders,[true]);
  checks.push(`${build}:observer-repaints-after-unchanged-dimensions`);
  const marker=build==='dev'?'__publicField(this, "onResize", ':'C(this,"onResize",';
  const markerAt=installed.indexOf(marker);assert.ok(markerAt>=0);
  const start=markerAt+marker.length;const resize=installed.slice(start,installed.indexOf('}));',start)+2);
  let resized=false;const frames=[];
  const nativeHost={scene:{getElementsIncludingDeleted:()=>[]},refreshViewportBreakpoints:()=>{},refreshEditorBreakpoints:()=>{resized=true;},updateDOMRect:()=>frames.push(resized),setState:()=>frames.push(resized)};
  const batch=callback=>callback;
  const onResize=new Function('withBatchedUpdates','Fe',`return ${resize}`).call(nativeHost,batch,batch);
  onResize();assert.deepEqual(frames,[true,true]);
  checks.push(`${build}:native-resize-updates-before-observer`);
}
console.log(JSON.stringify({passed:true,checks}));
