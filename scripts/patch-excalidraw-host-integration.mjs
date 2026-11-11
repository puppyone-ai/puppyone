import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), "..");
const desktopGuard = (width) => `if (!globalThis.matchMedia?.("(pointer: coarse)").matches) return ${width} < 500; /* Puppyone desktop breakpoint */`;
const overlayHost = 'document.getElementById("desktop-overlay-root")/* Puppyone overlay host */??document.body';

/**
 * Excalidraw 0.18.1 assumes it owns the page. Two assumptions break inside the
 * Desktop workbench; remove each when upstream exposes a supported option.
 *
 * Breakpoint: the phone layout applies whenever the editor element is narrower
 * than 730px (or shorter than 500px), regardless of input device, so a pane
 * beside the Agent panel received the full-screen phone property sheet.
 * Mouse-driven editors keep the desktop layout down to 500px; touch-primary
 * devices retain upstream behavior.
 * Upstream: packages/excalidraw/components/App.tsx, isMobileBreakpoint.
 *
 * Overlay host: modals and tooltips are appended to document.body, outside the
 * themed Desktop overlay root, so they cannot resolve product appearance tokens.
 * Upstream: packages/excalidraw/hooks/useCreatePortalContainer.ts and
 * packages/excalidraw/components/Tooltip.tsx.
 *
 * Context menu fit: App passes container-relative coordinates, but Popover
 * subtracts the container offset again before its overflow check. Below the
 * titlebar and beside the sidebar, a menu near the bottom or right edge was not
 * pulled back, and focusing it scrolled the whole overflow-hidden editor.
 * Upstream: packages/excalidraw/components/Popover.tsx, fitInViewport.
 */
const fitted = "/* Puppyone container coordinates */";
export const excalidrawHostPatches = {
  dev: [
    {
      before: '__publicField(this, "isMobileBreakpoint", (width, height) => {',
      after: `__publicField(this, "isMobileBreakpoint", (width, height) => {\n      ${desktopGuard("width")}`,
    },
    {
      before: "excalidrawContainer?.querySelector(opts.parentSelector) : document.body;",
      after: `excalidrawContainer?.querySelector(opts.parentSelector) : ${overlayHost};`,
    },
    {
      before: 'document.body.appendChild(div);\n  div.classList.add("excalidraw-tooltip");',
      after: `(${overlayHost}).appendChild(div);\n  div.classList.add("excalidraw-tooltip");`,
    },
    {
      before: "} else if (left + width - offsetLeft > viewportWidth) {",
      after: `} else if (left + width ${fitted} > viewportWidth) {`,
    },
    {
      before: "} else if (top + height - offsetTop > viewportHeight) {",
      after: `} else if (top + height ${fitted} > viewportHeight) {`,
    },
  ],
  prod: [
    {
      before: 'C(this,"isMobileBreakpoint",(t,r)=>t<Ch||r<Sh&&t<Ih);',
      after: `C(this,"isMobileBreakpoint",(t,r)=>{${desktopGuard("t")}return t<Ch||r<Sh&&t<Ih});`,
    },
    {
      before: "i?.querySelector(e.parentSelector):document.body;",
      after: `i?.querySelector(e.parentSelector):${overlayHost};`,
    },
    {
      before: 'document.body.appendChild(o),o.classList.add("excalidraw-tooltip")',
      after: `(${overlayHost}).appendChild(o),o.classList.add("excalidraw-tooltip")`,
    },
    {
      before: "o+p-i>l?d.style.left",
      after: `o+p${fitted}>l?d.style.left`,
    },
    {
      before: "t+u-a>s?d.style.top",
      after: `t+u${fitted}>s?d.style.top`,
    },
  ],
};

const count = (source, text) => source.split(text).length - 1;

export function patchExcalidrawHostIntegration(source, build, label = `@excalidraw/excalidraw ${build}`) {
  const patches = excalidrawHostPatches[build];
  if (!patches) throw new Error(`${label}: unknown build.`);
  let result = source;
  for (const { before, after } of patches) {
    const applied = count(result, after);
    if (applied === 1) continue;
    if (applied > 1 || count(result, before) !== 1) {
      throw new Error(`${label}: host integration point changed; review the Excalidraw patch before upgrading.`);
    }
    result = result.replace(before, () => after);
  }
  return { source: result, changed: result !== source };
}

export function patchInstalledExcalidraw() {
  let changed = false;
  for (const build of Object.keys(excalidrawHostPatches)) {
    const filename = path.join(root, "node_modules/@excalidraw/excalidraw/dist", build, "index.js");
    const result = patchExcalidrawHostIntegration(readFileSync(filename, "utf8"), build);
    if (result.changed) { writeFileSync(filename, result.source); changed = true; }
  }
  // Optimizer metadata does not hash postinstall changes to dependency bytes.
  if (changed) rmSync(path.join(root, "node_modules/.vite"), { recursive: true, force: true });
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) patchInstalledExcalidraw();
