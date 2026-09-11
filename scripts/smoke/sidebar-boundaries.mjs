import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";

/** Real App + native child: test discovery, border acquisition and a common
 * painter across all three outer panes. No content/provider input is sent. */
export async function verifySidebarBoundaries({ window, contents, temp, label, until }) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const view = window.contentView.children.find(child => child.webContents === contents);
  const pause = () => new Promise(resolve => setTimeout(resolve, 300));
  const assert = (condition, message) => { if (!condition) throw new Error(`${label}: ${message}`); };
  const selectors = [".desktop-project-switcher-resizer", ".data-explorer-resizer", ".desktop-right-sidebar-resizer"];
  const inspect = selector => evaluate(`(() => {
    const handle=document.querySelector(${JSON.stringify(selector)});
    const chrome=handle.querySelector('[data-pane-edge-chrome]');
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const base=getComputedStyle(chrome,'::before'), line=getComputedStyle(chrome,'::after');
    return {handle:rect(handle),paint:rect(chrome),rtl:getComputedStyle(handle).direction==='rtl',
      hover:handle.matches(':hover,[data-native-hover]'),dragging:handle.dataset.resizing==='true',
      base:{width:base.width,color:base.backgroundColor},
      line:{width:line.width,color:line.backgroundColor,shadow:line.boxShadow}};
  })()`);
  await evaluate(`(() => {
    const h=document.querySelector('.desktop-project-switcher-resizer');
    if(h.classList.contains('po-collapsed-pane-edge-handle')) h.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  await pause();
  const send = (type, x, y) => {
    const b=view.getBounds();
    const native=view.getVisible() && x>=b.x && x<b.x+b.width && y>=b.y && y<b.y+b.height;
    const target=native?contents:window.webContents;
    window.focus();
    target.focus();
    target.sendInputEvent({type,x:Math.round(x-(native?b.x:0)),y:Math.round(y-(native?b.y:0)),
      ...(type==='mouseMove'?{}:{button:'left',clickCount:1})});
    return native;
  };
  const observations=[];
  window.show(); window.focus();
  for(const selector of selectors) {
    window.webContents.sendInputEvent({type:'mouseMove',x:10,y:15});await pause();
    const idle=await inspect(selector);
    assert(idle.handle.width===8 && idle.paint.width===3,`${selector} hit/paint sizes`);
    assert(idle.line.color==='rgba(0, 0, 0, 0)',`${selector} idle highlight leaked`);
    const edgeX=idle.rtl?idle.paint.x+idle.paint.width-1:idle.paint.x;
    const inward=idle.rtl?-1:1;
    const y=view.getBounds().y+60;
    const nativeHover=send('mouseMove',edgeX+4*inward,y);await pause();
    const hover=await inspect(selector);
    assert(hover.hover && hover.line.color!==idle.line.color,`${selector} discoverable hover ${JSON.stringify({idle,hover,nativeHover,hit:await evaluate('document.elementFromPoint('+Math.round(edgeX+4*inward)+','+Math.round(y)+')?.className')})}`);
    if(nativeHover) {
      assert(await contents.executeJavaScript("getComputedStyle(document.body).cursor") === 'col-resize', 'native cursor feedback');
    }
    const hits=[];
    for(const offset of [0,2,4,7]) {
      send('mouseDown',edgeX+offset*inward,y);
      await until(async()=>(await inspect(selector)).dragging,`${selector} acquire visible edge +${offset}`);
      if(offset===0) await pause();
      const active=await inspect(selector);
      assert(view.getVisible(),'press hid native content');
      hits.push({offset,active});
      send('mouseUp',edgeX+offset*inward,y);
      await until(async()=>!(await inspect(selector)).dragging,`${selector} release`);
    }
    window.webContents.sendInputEvent({type:'mouseMove',x:10,y:15});await pause();
    assert(!(await inspect(selector)).hover,`${selector} hover cleanup`);
    observations.push({selector,idle,hover,nativeHover,hits});
  }
  for(const state of ['idle','hover']) {
    const first=observations[0][state];
    for(const observation of observations.slice(1)) {
      assert(JSON.stringify(observation[state].base)===JSON.stringify(first.base),`${state} base stroke differs`);
      assert(JSON.stringify(observation[state].line)===JSON.stringify(first.line),`${state} highlight differs`);
    }
  }
  const activeLine=JSON.stringify(observations[0].hits[0].active.line);
  for(const observation of observations.slice(1)) assert(JSON.stringify(observation.hits[0].active.line)===activeLine,'active stroke differs');
  const right=observations.at(-1).idle;
  const native=view.getBounds();
  assert(right.rtl ? native.x+native.width<=right.paint.x : native.x>=right.paint.x+right.paint.width,
    'native body covers the shared paint footprint');
  const x=right.rtl?right.paint.x+right.paint.width-2:right.paint.x+1;
  send('mouseMove',x,native.y+60);await pause();
  await fs.writeFile(path.join(temp,`${label}-boundary-shell.png`),(await window.webContents.capturePage()).toPNG());
  // Shell pixels are conclusive for this band only because the actual native
  // bounds above prove the child cannot cover it. Capture both height segments.
  const capture=PNG.sync.read((await window.webContents.capturePage()).toPNG());
  const scale=capture.width/window.getContentSize()[0];
  const strip=y=>Array.from({length:Math.round(right.paint.width*scale)},(_,index)=>{
    const offset=(Math.round(y*scale)*capture.width+Math.round(right.paint.x*scale)+index)*4;
    return [...capture.data.subarray(offset,offset+4)];
  });
  const headerPixels=strip(right.paint.y+12),bodyPixels=strip(native.y+60);
  assert(JSON.stringify(headerPixels)===JSON.stringify(bodyPixels),'Header/body paint differs');
  await evaluate("document.querySelector('.desktop-titlebar-terminal, .desktop-shell-toolbar-terminal').click()");
  await until(async()=>evaluate("Boolean(document.querySelector('.desktop-right-sidebar-resizer.po-collapsed-pane-edge-handle'))"),'collapsed edge settled');
  const collapsed=await evaluate(`(() => {const r=document.querySelector('.desktop-right-sidebar-resizer').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
  assert(collapsed.width===12 && collapsed.x>=0 && collapsed.x+collapsed.width<=window.getContentSize()[0], 'collapsed edge leaves the window');
  send('mouseDown',collapsed.x+6,collapsed.y+60);
  send('mouseUp',collapsed.x+6,collapsed.y+60);
  await until(async()=>evaluate("Boolean(document.querySelector('.desktop-right-sidebar.is-open [data-pane-edge-chrome]'))"),'reopen from collapsed edge');
  await until(()=>view.getVisible(),'native restored after reopen');
  await pause();
  const report={label,observations,native,headerPixels,bodyPixels,nativeExcludesPaint:true,collapsedReopen:true};
  await fs.writeFile(path.join(temp,`${label}-boundaries.json`),JSON.stringify(report,null,2));
  return report;
}
