import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), "..");
const MARKER = "Puppyone desktop breakpoint";
const desktopGuard = (width) => `if (!globalThis.matchMedia?.("(pointer: coarse)").matches) return ${width} < 500; /* ${MARKER} */`;

/**
 * Excalidraw 0.18.1 switches to its phone layout whenever the editor element is
 * narrower than 730px (or shorter than 500px), regardless of input device. A
 * Desktop pane beside the Agent panel crosses that threshold and receives the
 * full-screen phone property sheet. Mouse-driven editors keep the desktop
 * layout down to 500px; touch-primary devices retain upstream behavior.
 * Remove when upstream exposes a supported breakpoint option.
 * Upstream: excalidraw/excalidraw packages/excalidraw/components/App.tsx, isMobileBreakpoint.
 */
export const excalidrawBreakpointPatches = {
  dev: {
    before: '__publicField(this, "isMobileBreakpoint", (width, height) => {',
    after: `__publicField(this, "isMobileBreakpoint", (width, height) => {\n      ${desktopGuard("width")}`,
  },
  prod: {
    before: 'C(this,"isMobileBreakpoint",(t,r)=>t<Ch||r<Sh&&t<Ih);',
    after: `C(this,"isMobileBreakpoint",(t,r)=>{${desktopGuard("t")}return t<Ch||r<Sh&&t<Ih});`,
  },
};

export function patchExcalidrawMobileBreakpoint(source, build, label = `@excalidraw/excalidraw ${build}`) {
  const patch = excalidrawBreakpointPatches[build];
  if (!patch) throw new Error(`${label}: unknown build.`);
  if (source.includes(MARKER)) {
    if (source.split(MARKER).length - 1 !== 1) throw new Error(`${label}: breakpoint patch applied more than once.`);
    return { source, changed: false };
  }
  if (source.split(patch.before).length - 1 !== 1) {
    throw new Error(`${label}: mobile breakpoint changed; review the breakpoint patch before upgrading.`);
  }
  return { source: source.replace(patch.before, () => patch.after), changed: true };
}

export function patchInstalledExcalidraw() {
  let changed = false;
  for (const build of Object.keys(excalidrawBreakpointPatches)) {
    const filename = path.join(root, "node_modules/@excalidraw/excalidraw/dist", build, "index.js");
    const result = patchExcalidrawMobileBreakpoint(readFileSync(filename, "utf8"), build);
    if (result.changed) { writeFileSync(filename, result.source); changed = true; }
  }
  // Optimizer metadata does not hash postinstall changes to dependency bytes.
  if (changed) rmSync(path.join(root, "node_modules/.vite"), { recursive: true, force: true });
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) patchInstalledExcalidraw();
