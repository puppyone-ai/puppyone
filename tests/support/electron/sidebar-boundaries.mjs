import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";

/** Real application DOM: test discovery, border acquisition and a common
 * painter across all three outer panes. No content/provider input is sent. */
export async function verifySidebarBoundaries(options) {
  const debuggerSession = options.window.webContents.debugger;
  debuggerSession.attach("1.3");
  try { return await verifyBoundaries(options); }
  finally { if (debuggerSession.isAttached()) debuggerSession.detach(); }
}

async function verifyBoundaries({ window, temp, label, until }) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const pause = () => new Promise(resolve => setTimeout(resolve, 300));
  const assert = (condition, message) => { if (!condition) throw new Error(`${label}: ${message}`); };
  const selectors = [".desktop-project-switcher-resizer", ".data-explorer-resizer", ".desktop-right-sidebar-resizer"];
  const inspect = selector => evaluate(`(() => {
    const handle=document.querySelector(${JSON.stringify(selector)});
    if(!handle)return {missing:'handle'};
    const chrome=handle.querySelector('[data-pane-edge-chrome]');
    if(!chrome)return {missing:'chrome'};
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const base=getComputedStyle(chrome,'::before'), line=getComputedStyle(chrome,'::after');
    return {handle:rect(handle),paint:rect(chrome),rtl:getComputedStyle(handle).direction==='rtl',
      hover:handle.matches(':hover,[data-native-hover]'),dragging:handle.dataset.resizing==='true',
      base:{width:base.width,color:base.backgroundColor},
      line:{width:line.width,color:line.backgroundColor,shadow:line.boxShadow}};
  })()`);
  await evaluate(`(() => {
    const h=document.querySelector('.desktop-project-switcher-resizer');
    if(h?.classList.contains('po-collapsed-pane-edge-handle')) h.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  await pause();
  const send = (type, x, y) => {
    return window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type:type === 'mouseMove' ? 'mouseMoved' : type === 'mouseDown' ? 'mousePressed' : 'mouseReleased',
      x:Math.round(x), y:Math.round(y), pointerType:'mouse',
      buttons:type === 'mouseDown' ? 1 : 0,
      ...(type === 'mouseMove' ? {} : {button:'left',clickCount:1}),
    });
  };
  const observations=[];
  window.show(); window.focus();
  for(const selector of selectors) {
    await send('mouseMove',10,15);await pause();
    const idle=await inspect(selector);
    assert(!idle.missing,`${selector} missing ${idle.missing}`);
    assert(idle.handle.width===8 && idle.paint.width===3,`${selector} hit/paint sizes`);
    assert(idle.line.color==='rgba(0, 0, 0, 0)',`${selector} idle highlight leaked`);
    const edgeX=idle.rtl?idle.paint.x+idle.paint.width-1:idle.paint.x;
    const inward=idle.rtl?-1:1;
    const y=idle.handle.y+90;
    await send('mouseMove',edgeX+4*inward,y);await pause();
    const hover=await inspect(selector);
    assert(hover.hover && hover.line.color!==idle.line.color,`${selector} discoverable hover ${JSON.stringify({idle,hover,hit:await evaluate('document.elementFromPoint('+Math.round(edgeX+4*inward)+','+Math.round(y)+')?.className')})}`);
    const hits=[];
    for(const offset of [0,2,4,7]) {
      await send('mouseDown',edgeX+offset*inward,y);
      await until(async()=>(await inspect(selector)).dragging,`${selector} acquire visible edge +${offset}`);
      if(offset===0) {
        await pause();
        await evaluate(`Promise.allSettled(document.querySelector(${JSON.stringify(selector)}).getAnimations({subtree:true}).map(animation=>animation.finished))`);
      }
      const active=await inspect(selector);
      assert(await evaluate("document.querySelector('.desktop-right-sidebar').dataset.paneContentVisible === 'true'"), 'press hid content');
      hits.push({offset,active});
      await send('mouseUp',edgeX+offset*inward,y);
      await until(async()=>!(await inspect(selector)).dragging,`${selector} release`);
    }
    await send('mouseMove',10,15);await pause();
    assert(!(await inspect(selector)).hover,`${selector} hover cleanup`);
    observations.push({selector,idle,hover,hits});
  }
  for(const state of ['idle','hover']) {
    const first=observations[0][state];
    for(const observation of observations.slice(1)) {
      assert(JSON.stringify(observation[state].base)===JSON.stringify(first.base),`${state} base stroke differs`);
      assert(JSON.stringify(observation[state].line)===JSON.stringify(first.line),`${state} highlight differs`);
    }
  }
  const activeLine=JSON.stringify(observations[0].hits[0].active.line);
  for(const observation of observations.slice(1)) assert(JSON.stringify(observation.hits[0].active.line)===activeLine,
    `active stroke differs: ${JSON.stringify(observations.map(item=>({selector:item.selector,active:item.hits[0].active})))}`);
  const explorerMotion=await evaluate(`(async()=>{
    const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
    const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    const content=document.querySelector('.data-content');
    const measureExplorerElements=()=>Object.fromEntries([
      '.data-explorer-layout',
      '.data-explorer-pane',
      '.data-explorer-view-stack',
      '.tree-row',
    ].map(selector=>{
      const rect=document.querySelector(selector)?.getBoundingClientRect();
      return [selector,rect?{width:rect.width,height:rect.height}:null];
    }));
    let collapsePreview=null,restoredPreview=null;
    if(!content.dataset.explorerCollapsed){
      const handle=document.querySelector('.data-explorer-resizer');
      const rect=handle.getBoundingClientRect();
      const expandedContentWidth=document.querySelector('.data-explorer-inner').getBoundingClientRect().width;
      const rtl=getComputedStyle(handle).direction==='rtl';
      const pointerId=817, clientY=rect.top+80, startX=rtl?rect.right-1:rect.left+1, collapsedX=rtl?window.innerWidth:0;
      const elementGeometry=measureExplorerElements();
      handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,buttons:1,clientX:startX,clientY,pointerId}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,buttons:1,clientX:collapsedX,clientY,pointerId}));
      await nextFrame();
      await nextFrame();
      collapsePreview={
        temporarilyCollapsed:content.dataset.explorerCollapsed==='true',
        gesture:content.dataset.explorerGesture,
        frameWidth:document.querySelector('.explorer-column').getBoundingClientRect().width,
        contentWidth:document.querySelector('.data-explorer-inner').getBoundingClientRect().width,
        expandedContentWidth,
        elementGeometry,
        previewElementGeometry:measureExplorerElements(),
        collapsedFillPresent:Boolean(document.querySelector('.data-explorer-collapsed-fill')),
      };
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,buttons:1,clientX:startX,clientY,pointerId}));
      await nextFrame();
      await nextFrame();
      restoredPreview={
        expanded:content.dataset.explorerCollapsed!=='true',
        gesture:content.dataset.explorerGesture,
        frameWidth:document.querySelector('.explorer-column').getBoundingClientRect().width,
      };
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,buttons:1,clientX:collapsedX,clientY,pointerId}));
      await nextFrame();
      await nextFrame();
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,buttons:0,clientX:collapsedX,clientY,pointerId}));
      await sleep(500);
    }
    const expand=document.querySelector('.desktop-titlebar-sidebar-expand');
    if(!expand) throw new Error('Explorer expand action was not available after collapse.');
    expand.click();
    const samples=[], startedAt=performance.now();
    while(performance.now()-startedAt<500){
      await nextFrame();
      const frame=document.querySelector('.explorer-column')?.getBoundingClientRect();
      const paint=document.querySelector('.data-explorer-resizer [data-pane-edge-chrome]')?.getBoundingClientRect();
      const inner=document.querySelector('.data-explorer-inner')?.getBoundingClientRect();
      if(frame&&paint&&inner){
        const rtl=getComputedStyle(document.documentElement).direction==='rtl';
        samples.push({frameWidth:frame.width,contentWidth:inner.width,
          dividerDelta:Math.abs((rtl?frame.left:frame.right)-(rtl?paint.right:paint.left))});
      }
    }
    return {collapsePreview,restoredPreview,sampleCount:samples.length,maxDividerDelta:Math.max(...samples.map(sample=>sample.dividerDelta)),
      contentWidths:[...new Set(samples.map(sample=>Math.round(sample.contentWidth)))],
      firstWidth:samples[0]?.frameWidth,lastWidth:samples.at(-1)?.frameWidth};
  })()`);
  assert(explorerMotion.sampleCount>=5,'Explorer open motion did not produce enough frame samples');
  assert(!explorerMotion.collapsePreview
    || explorerMotion.collapsePreview.contentWidth===explorerMotion.collapsePreview.expandedContentWidth,
  `Explorer content squeezed during collapse preview: ${JSON.stringify(explorerMotion.collapsePreview)}`);
  assert(!explorerMotion.collapsePreview || explorerMotion.collapsePreview.temporarilyCollapsed,
    `Explorer did not enter its temporary collapsed state before release: ${JSON.stringify(explorerMotion.collapsePreview)}`);
  assert(!explorerMotion.collapsePreview || explorerMotion.collapsePreview.gesture==='collapse-preview',
    `Explorer did not expose the shared collapse-preview phase: ${JSON.stringify(explorerMotion.collapsePreview)}`);
  assert(!explorerMotion.collapsePreview || !explorerMotion.collapsePreview.collapsedFillPresent,
    `Explorer inserted a competing flex child during collapse preview: ${JSON.stringify(explorerMotion.collapsePreview)}`);
  assert(!explorerMotion.collapsePreview || Object.keys(explorerMotion.collapsePreview.elementGeometry).every(selector=>{
    const before=explorerMotion.collapsePreview.elementGeometry[selector];
    const preview=explorerMotion.collapsePreview.previewElementGeometry[selector];
    return !before || !preview || (Math.abs(before.width-preview.width)<=1 && Math.abs(before.height-preview.height)<=1);
  }),`Explorer elements reflowed during collapse preview: ${JSON.stringify(explorerMotion.collapsePreview)}`);
  assert(!explorerMotion.restoredPreview || explorerMotion.restoredPreview.expanded,
    `Explorer did not restore its expanded preview in the same pointer gesture: ${JSON.stringify(explorerMotion.restoredPreview)}`);
  assert(!explorerMotion.restoredPreview || explorerMotion.restoredPreview.gesture==='expand-preview',
    `Explorer did not expose its animated recovery after leaving the collapse hysteresis: ${JSON.stringify(explorerMotion.restoredPreview)}`);
  assert(explorerMotion.firstWidth<explorerMotion.lastWidth,'Explorer frame did not expand from its collapsed edge');
  assert(Math.abs(explorerMotion.lastWidth-220)<=1,
    `Explorer reopened at a stale pre-collapse width: ${JSON.stringify(explorerMotion)}`);
  assert(explorerMotion.maxDividerDelta<=2,`Explorer divider left its animated frame: ${JSON.stringify(explorerMotion)}`);
  assert(explorerMotion.contentWidths.length===1,`Explorer content reflowed during open motion: ${JSON.stringify(explorerMotion)}`);
  const right=await inspect(".desktop-right-sidebar-resizer");
  assert(!right.missing, 'Auxiliary divider missing');
  const bodyY=right.paint.y+90;
  const x=right.rtl?right.paint.x+right.paint.width-2:right.paint.x+1;
  await send('mouseMove',x,bodyY);await pause();
  await fs.writeFile(path.join(temp,`${label}-boundary-shell.png`),(await window.webContents.capturePage()).toPNG());
  // Divider is a sibling of the clipping viewport; its header/body paint must agree.
  const capture=PNG.sync.read((await window.webContents.capturePage()).toPNG());
  const scale=capture.width/window.getContentSize()[0];
  const strip=y=>Array.from({length:Math.round(right.paint.width*scale)},(_,index)=>{
    const offset=(Math.round(y*scale)*capture.width+Math.round(right.paint.x*scale)+index)*4;
    return [...capture.data.subarray(offset,offset+4)];
  });
  const headerPixels=strip(right.paint.y+12),bodyPixels=strip(bodyY);
  assert(JSON.stringify(headerPixels)===JSON.stringify(bodyPixels),'Header/body paint differs');
  await evaluate("document.querySelector('.desktop-titlebar-terminal, .desktop-shell-toolbar-terminal').click()");
  await new Promise(resolve => setTimeout(resolve, 80));
  assert(await evaluate("document.querySelector('.desktop-right-sidebar').dataset.paneContentVisible === 'true'"), `${label} content hid before motion finished`);
  await until(async()=>evaluate("Boolean(document.querySelector('.desktop-right-sidebar-resizer.po-collapsed-pane-edge-handle'))"),'collapsed edge settled');
  assert(await evaluate("document.querySelector('.desktop-right-sidebar').dataset.paneContentVisible === 'false'"), `${label} collapsed content remains interactive`);
  const collapsed=await evaluate(`(() => {const r=document.querySelector('.desktop-right-sidebar-resizer').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
  assert(collapsed.width===12 && collapsed.x>=0 && collapsed.x+collapsed.width<=window.getContentSize()[0], 'collapsed edge leaves the window');
  await send('mouseDown',collapsed.x+6,collapsed.y+60);
  await send('mouseUp',collapsed.x+6,collapsed.y+60);
  await until(async()=>evaluate("Boolean(document.querySelector('.desktop-right-sidebar.is-open [data-pane-edge-chrome]'))"),'reopen from collapsed edge');
  await until(async()=>evaluate("document.querySelector('.desktop-right-sidebar').dataset.panePresentation === 'expanded'"),'content restored after reopen');
  await pause();
  const report={label,observations,explorerMotion,headerPixels,bodyPixels,collapsedReopen:true};
  await fs.writeFile(path.join(temp,`${label}-boundaries.json`),JSON.stringify(report,null,2));
  return report;
}
