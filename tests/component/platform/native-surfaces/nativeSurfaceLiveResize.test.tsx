/** @vitest-environment happy-dom */
import { EventEmitter } from "node:events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { attachNativeSurfaceView } from "../../../../electron/main/native-surfaces/view-attachment.mjs";
import type { ItemHostBridge, ItemHostState } from "../../../../shared/item-host-contract/types";
import { projectItemHosts } from "../../../../src/features/app-shell/auxiliary-workbench/host/HostedItemPool";
import { HostedItemView } from "../../../../src/features/app-shell/auxiliary-workbench/host/HostedItemView";
import { ProjectWorkbenchStore } from "../../../../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";


let root: Root | null = null;
const cleanups: Array<() => void> = [];
afterEach(() => {
  act(() => root?.unmount()); root = null;
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.replaceChildren();
  delete window.puppyoneDesktop;
});

function fixture() {
  const state: ItemHostState = { itemId: "terminal-1", generation: "display-1", display: "ready", execution: "ready" };
  const bridge: ItemHostBridge = {
    create: vi.fn(async () => state), configure: vi.fn(async () => {}), focus: vi.fn(),
    close: vi.fn(async () => {}), recover: vi.fn(async () => ({ ...state, generation: "display-2" })),
    setGeometry: vi.fn(), onState: () => () => {}, onEvent: () => () => {}, respond: vi.fn(),
  };
  const project = new ProjectWorkbenchStore({ projectId: "project-a", generation: "open-1", rootPath: "/fixture" });
  return { bridge, project };
}

import { AuxiliaryPanelHost } from "../../../../src/features/app-shell/auxiliary/AuxiliaryPanelHost";
import { acquireNativeSurfacePointerPassthroughLease, useNativeSurfacePointerPassthroughActivity } from "../../../../src/features/native-surfaces";
import { withTestLocalization } from "../../../support/react/localization";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps native content visible throughout a live outer resize, including the held-pointer interval", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1200);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
  const frames = new Map<number, FrameRequestCallback>(); let nextFrame=0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  const flush = async () => { const pending=[...frames.values()]; frames.clear(); await act(async () => pending.forEach(callback => callback(performance.now()))); };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const panel=this.closest<HTMLElement>(".desktop-right-sidebar");
    const width=Number.parseFloat(panel?.style.getPropertyValue("--desktop-right-sidebar-width") || "420");
    if (this.matches("[data-pane-edge-chrome]")) return {x:1200-width,y:40,left:1200-width,top:40,right:1203-width,bottom:740,width:3,height:700,toJSON:()=>({})};
    return { x:1200-width,y:40,left:1200-width,top:40,right:1200,bottom:740,width,height:700,toJSON:()=>({}) };
  });
  const view={webContents:{isDestroyed:()=>false},setVisible:vi.fn(),setBounds:vi.fn()};
  const windowFixture=Object.assign(new EventEmitter(), {webContents:{id:1},isVisible:()=>true,getContentSize:()=>[1200,800],contentView:{addChildView(){},removeChildView(){}}});
  const attachment=attachNativeSurfaceView({window:windowFixture,view,nativeSurfaceOcclusion:undefined,nativeSurfacePointerPassthrough:undefined,onPointerDown:undefined,onVisibilityChange:undefined});
  cleanups.push(()=>attachment.dispose());
  const {bridge,project}=fixture();
  vi.mocked(bridge.setGeometry).mockImplementation(request=>attachment.geometry(request));
  Object.defineProperty(window,"puppyoneDesktop",{configurable:true,value:{itemHosts:bridge,setNativeSurfacePointerPassthrough:vi.fn(),setNativeSurfacePointerRoutingRegions:vi.fn()}});
  const pool=projectItemHosts(project); cleanups.push(()=>project.dispose());
  await pool.prepare("terminal-1","terminal");
  let setOtherResize:(active:boolean)=>void=()=>{};
  const onWidthChange=vi.fn();
  function Harness(){
    const [width,setWidth]=React.useState(420);
    setOtherResize=useNativeSurfacePointerPassthroughActivity("explorer-resize");
    return <AuxiliaryPanelHost open resizable width={width} minWidth={320} maxWidth={900}
      onWidthChange={value=>{onWidthChange(value);setWidth(value);}}>
      <HostedItemView project={project} item={{id:"terminal-1",kind:"terminal",rootId:"/fixture",contextId:"project-a"}}
        presentation={{presented:true,sidebarVisible:true,commandTarget:true,domFocused:false}} onPresentationChange={()=>{}} />
    </AuxiliaryPanelHost>;
  }
  const container=document.createElement("div");document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(withTestLocalization(<Harness/>)));
  const handle=container.querySelector<HTMLElement>(".desktop-right-sidebar-resizer")!;
  const fire=async(target:EventTarget,type:string,x:number)=>act(async()=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,buttons:type==="pointerup"?0:1,pointerId:1,clientX:x,clientY:80})));
  const observations: Array<{
    phase: string;
    visible: boolean;
    width: string;
    bounds?: { x: number; y: number; width: number; height: number };
    published?: boolean;
  }> = [];
  const record=(phase:string)=>observations.push({phase,visible:attachment.isVisible(),width:container.querySelector<HTMLElement>("aside")!.style.getPropertyValue("--desktop-right-sidebar-width"),bounds:view.setBounds.mock.lastCall?.[0],published:vi.mocked(bridge.setGeometry).mock.lastCall?.[0]?.visible});
  await flush();record("before");expect(attachment.isVisible()).toBe(true);
  await fire(handle,"pointerdown",780);await flush();record("held without movement");
  expect.soft(attachment.isVisible(),"pressing the outer sash must not blank a live native view").toBe(true);
  await fire(window,"pointermove",680);await flush();await flush();record("dragged 100px");
  expect.soft(attachment.isVisible(),"native content must remain drawn while the width is previewed").toBe(true);
  expect(onWidthChange).not.toHaveBeenCalled();
  await fire(window,"pointerup",680);await flush();await flush();record("released");
  expect(attachment.isVisible()).toBe(true);expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(520);
  const rawLease=acquireNativeSurfacePointerPassthroughLease("terminal-split-resize");await flush();record("internal split pointer lease");
  expect(attachment.isVisible()).toBe(true);rawLease.release();
  await act(async()=>setOtherResize(true));await flush();record("unrelated explorer resize");
  expect.soft(attachment.isVisible(),"resizing the Explorer must not blank a native item in the right sidebar").toBe(true);
  await act(async()=>setOtherResize(false));await flush();record("other resize released");
  expect(attachment.isVisible()).toBe(true);
  expect(bridge.create).toHaveBeenCalledTimes(1);expect(bridge.close).not.toHaveBeenCalled();
  expect(observations.every(phase => phase.visible)).toBe(true);
  expect(observations.find(phase => phase.phase === "dragged 100px")?.bounds?.width).toBe(517);
  expect(view.setVisible.mock.calls.filter(([visible]) => visible === false)).toHaveLength(1);
});
