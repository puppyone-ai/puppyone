import { useEffect, type MutableRefObject, type RefObject } from "react";
import { readEmbeddedChromeInset, relayEmbeddedPointer, relayEmbeddedScroll } from "../../host/embeddedFrameRelay";

export type HtmlPageViewport = MutableRefObject<{ x: number; y: number }>;

export function useHtmlPageViewport({ frame, viewportState, channel, enabled, waiting, onFrameLoad }: {
  frame: RefObject<HTMLIFrameElement | null>;
  viewportState?: HtmlPageViewport;
  channel: string;
  enabled: boolean;
  waiting: boolean;
  onFrameLoad: () => void;
}) {
  useEffect(() => {
    if (!enabled || !viewportState) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
      if (event.data.type === "puppyone-html-viewport") {
        const position = readHtmlPageViewport(event.data);
        if (!position) return;
        viewportState.current = position;
        // The page scrolls inside its frame, out of the host's sight.
        relayEmbeddedScroll(frame.current, position.y);
      } else if (event.data.type === "puppyone-html-pointer") {
        const pointer = readHtmlPagePointer(event.data);
        if (pointer !== undefined) relayEmbeddedPointer(frame.current, pointer);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [enabled, viewportState, channel, frame]);

  return () => {
    // The initial about:blank load is not the projected page becoming ready.
    if (waiting) return;
    onFrameLoad();
    if (!enabled) return;
    // Before the page shows: room for chrome the host draws over its top.
    const inset = readEmbeddedChromeInset(frame.current);
    if (inset) frame.current?.contentWindow?.postMessage({ type: "puppyone-html-inset", channel, top: inset }, "*");
    if (viewportState) frame.current?.contentWindow?.postMessage({
      type: "puppyone-html-restore", channel, ...viewportState.current,
    }, "*");
  };
}

/** Untrusted page messages can only update bounded, disposable scroll state. */
export function readHtmlPageViewport(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
    && x >= 0 && y >= 0 && x <= 1e7 && y <= 1e7 ? { x, y } : null;
}

/**
 * Where the page last saw the pointer, in its own client coordinates: a point,
 * null once it has left the page, or undefined for anything else.
 */
export function readHtmlPagePointer(value: unknown): { x: number; y: number } | null | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { x, y, left } = value as { x?: unknown; y?: unknown; left?: unknown };
  if (left === true) return null;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
    && Math.abs(x) <= 1e7 && Math.abs(y) <= 1e7 ? { x, y } : undefined;
}

export function htmlPageViewportScript(channel: string): string {
  return `<script>(()=>{const channel=${JSON.stringify(channel)};let queued=false;
addEventListener('scroll',()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;
parent.postMessage({type:'puppyone-html-viewport',channel,x:scrollX,y:scrollY},'*')})},{passive:true});
let pointer=null,pointerQueued=false;
addEventListener('pointermove',event=>{pointer=[event.clientX,event.clientY];if(pointerQueued)return;pointerQueued=true;
requestAnimationFrame(()=>{pointerQueued=false;if(pointer)parent.postMessage({type:'puppyone-html-pointer',channel,x:pointer[0],y:pointer[1]},'*')})},{capture:true,passive:true});
document.addEventListener('pointerout',event=>{if(event.relatedTarget)return;pointer=null;
parent.postMessage({type:'puppyone-html-pointer',channel,left:true},'*')},{capture:true,passive:true});
addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==channel)return;
if(event.data.type==='puppyone-html-inset'){const top=event.data.top;if(Number.isFinite(top)&&top>0&&top<=400)document.documentElement.style.setProperty('padding-top',top+'px','important');return}
if(event.data.type!=='puppyone-html-restore')return;
const {x,y}=event.data;if(Number.isFinite(x)&&Number.isFinite(y))scrollTo(x,y)})})();</script>`;
}

/**
 * The product scrollbar for a page's own viewport, as an editor's document
 * has it: a thumb on a clear lane, shown while the page is under the pointer.
 * It goes first in the page's head with no specificity of its own, so any
 * scrollbar the page styles itself wins. Colours are neutral enough for a
 * light or a dark page, since the app's tokens do not reach inside it.
 */
export const HTML_PAGE_SCROLLBAR_STYLE = `<style id="puppyone-html-page-scrollbar">
:where(html)::-webkit-scrollbar{width:12px;height:12px}
:where(html)::-webkit-scrollbar-track,:where(html)::-webkit-scrollbar-corner{background:transparent}
:where(html)::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:999px;background-clip:padding-box;background-color:transparent}
:where(html:hover)::-webkit-scrollbar-thumb{border-width:2px;background-color:rgb(128 128 128 / .45)}
:where(html)::-webkit-scrollbar-thumb:hover{background-color:rgb(128 128 128 / .6)}
</style>`;
