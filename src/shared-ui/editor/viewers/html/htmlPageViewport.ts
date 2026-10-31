import { useEffect, type MutableRefObject, type RefObject } from "react";

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
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "puppyone-html-viewport"
        || event.data.channel !== channel) return;
      const position = readHtmlPageViewport(event.data);
      if (position) viewportState.current = position;
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [enabled, viewportState, channel, frame]);

  return () => {
    // The initial about:blank load is not the projected page becoming ready.
    if (waiting) return;
    onFrameLoad();
    if (enabled && viewportState) frame.current?.contentWindow?.postMessage({
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

export function htmlPageViewportScript(channel: string): string {
  return `<script>(()=>{const channel=${JSON.stringify(channel)};let queued=false;
addEventListener('scroll',()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;
parent.postMessage({type:'puppyone-html-viewport',channel,x:scrollX,y:scrollY},'*')})},{passive:true});
addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='puppyone-html-restore'||event.data.channel!==channel)return;
const {x,y}=event.data;if(Number.isFinite(x)&&Number.isFinite(y))scrollTo(x,y)})})();</script>`;
}
