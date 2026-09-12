import { afterEach, describe, expect, it } from "vitest";
import { excludeNativeSurfacePaneChrome, setNativeSurfacePaneChrome } from "../../../../src/features/native-surfaces/nativeSurfacePaneChrome";

afterEach(() => { for (const id of [1, 2, 3]) setNativeSurfacePaneChrome(id, null); });
describe("Shell pane-edge paint footprints", () => {
  it("reserves the full active stroke on a native body, independently of hover", () => {
    setNativeSurfacePaneChrome(1, { x: 800, y: 38, width: 3, height: 962 });
    expect(excludeNativeSurfacePaneChrome({ x: 801, y: 76, width: 799, height: 924 }))
      .toEqual({ x: 803, y: 76, width: 797, height: 924 });
  });
  it("trims the opposite edge for RTL and adjacent native panes", () => {
    setNativeSurfacePaneChrome(1, { x: 797, y: 38, width: 3, height: 962 });
    expect(excludeNativeSurfacePaneChrome({ x: 0, y: 76, width: 799, height: 924 }))
      .toEqual({ x: 0, y: 76, width: 797, height: 924 });
  });
  it("keeps unrelated native surfaces and interior overlays out of this contract", () => {
    setNativeSurfacePaneChrome(1, { x: 800, y: 38, width: 3, height: 962 });
    const unrelated = { x: 50, y: 76, width: 600, height: 924 };
    expect(excludeNativeSurfacePaneChrome(unrelated)).toEqual(unrelated);
    const spanning = { x: 0, y: 0, width: 1600, height: 1000 };
    expect(excludeNativeSurfacePaneChrome(spanning)).toEqual(spanning);
  });
  it("samples current chrome even when the slot subscriber runs first in a frame", () => {
    const element={isConnected:true,getBoundingClientRect:()=>({left:820,top:38,right:823,bottom:1000,width:3,height:962})} as HTMLElement;
    setNativeSurfacePaneChrome(1,{x:800,y:38,width:3,height:962},element);
    expect(excludeNativeSurfacePaneChrome({x:821,y:76,width:779,height:924}))
      .toEqual({x:823,y:76,width:777,height:924});
  });
  it("releases reservations and handles a slot narrower than its paint footprint", () => {
    setNativeSurfacePaneChrome(1, { x: 800, y: 38, width: 3, height: 962 });
    expect(excludeNativeSurfacePaneChrome({ x: 801, y: 76, width: 1, height: 924 }).width).toBe(0);
    setNativeSurfacePaneChrome(1, null);
    expect(excludeNativeSurfacePaneChrome({ x: 801, y: 76, width: 799, height: 924 }).width).toBe(799);
  });
});
