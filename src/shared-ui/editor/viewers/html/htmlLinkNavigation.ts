import { useEffect, type RefObject } from "react";
import { DocumentNavigationMissingError, type DocumentNavigationPort } from "../../navigation/documentNavigation";

export type HtmlLinkFailure = "unavailable" | "missing" | "offline" | "failed";

/** Resource bases and navigation destinations are separate: private resource
 * URLs never become OS navigation targets or saved document identities. */
export function resolveHtmlNavigationHref(href: string, sourceBase: string | null): string | null {
  if (!href || href.length > 8192 || /[\u0000-\u001f\u007f]/.test(href)) return null;
  const value = href.trim();
  if (!value || value.startsWith("#")) return null;
  if (value.startsWith("//")) {
    try { return sourceBase && /^https?:/i.test(sourceBase) ? new URL(value, sourceBase).href : new URL(`https:${value}`).href; } catch { return null; }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  if (sourceBase && /^(?:https?:|\/\/)/i.test(sourceBase)) {
    try { return new URL(value, sourceBase.startsWith("//") ? `https:${sourceBase}` : sourceBase).href; } catch { return null; }
  }
  // A relative <base> changes the path, not which workspace owns the link.
  if (sourceBase && /^[a-z][a-z0-9+.-]*:/i.test(sourceBase)) return null;
  const basePath = sourceBase?.split(/[?#]/, 1)[0] ?? "";
  const directory = /\/$|(?:^|\/)\.\.?$/.test(basePath)
    ? `${basePath.replace(/\/$/, "")}/` : basePath.slice(0, basePath.lastIndexOf("/") + 1);
  const relative = value.startsWith("/") ? value : `${directory}${value}`;
  try {
    const target = relative.split("/").map((part) => {
      const decoded = decodeURIComponent(part);
      if (/[\\/\u0000-\u001f\u007f]/.test(decoded)) throw new Error("Invalid link path");
      return decoded;
    }).join("/");
    return target.startsWith("/") || target.startsWith("./") || target.startsWith("../") ? target : `./${target}`;
  } catch { return null; }
}

/** Only the active iframe can submit an intent, during real user activation.
 * The existing host port owns file resolution and Main owns external opening. */
export function useHtmlLinkNavigation({ frame, channel, generation, path, sourceBase, navigation, offline, onFailure }: {
  frame: RefObject<HTMLIFrameElement | null>;
  channel: string;
  generation: string;
  path: string;
  sourceBase: string | null;
  navigation?: DocumentNavigationPort | null;
  offline: boolean;
  onFailure?: (reason: HtmlLinkFailure) => void;
}) {
  useEffect(() => {
    let active = true;
    const receive = (event: MessageEvent) => {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow
        || event.data?.type !== "puppyone-html-link" || event.data.channel !== channel
        || typeof event.data.href !== "string" || !navigator.userActivation?.isActive) return;
      if (offline) { onFailure?.("offline"); return; }
      try {
        const target = resolveHtmlNavigationHref(event.data.href, sourceBase);
        const reference = target && navigation?.resolveReference(path, target);
        if (!reference || !navigation?.canOpenReference(reference)) {
          onFailure?.(reference && reference.kind === "workspace" && reference.status === "missing" ? "missing" : "unavailable");
          return;
        }
        void Promise.resolve().then(() => {
          if (active) return navigation.openReference(reference);
        }).catch((error: unknown) => { if (active) onFailure?.(error instanceof DocumentNavigationMissingError ? "missing" : "failed"); });
      } catch { onFailure?.("failed"); }
    };
    window.addEventListener("message", receive);
    return () => { active = false; window.removeEventListener("message", receive); };
  }, [frame, channel, generation, path, sourceBase, navigation, offline, onFailure]);
}

/** Fixed preview-only code: links do not replace the document being edited.
 * Page handlers get first refusal; downloads retain their own browser path. */
export function htmlLinkNavigationScript(channel: string, sourceUrl?: string | null): string {
  return `<script nonce="${channel}">(()=>{const channel=${JSON.stringify(channel)},sourceUrl=${JSON.stringify(sourceUrl ?? null)};
const withoutHash=value=>{try{const url=new URL(value);url.hash='';return url.href}catch{return null}};
const follow=event=>{if(!event.isTrusted||event.defaultPrevented||event.button!==0&&event.button!==1)return;
const link=event.composedPath().find(node=>node instanceof Element&&node.matches('a[href],area[href]'));
if(!link||link.hasAttribute('download'))return;const href=link.getAttribute('href');if(href===null)return;
event.preventDefault();let fragment=null;
if(href.trim().startsWith('#'))fragment=href.trim();
else{try{const url=new URL(href,document.baseURI);if(sourceUrl&&url.hash&&withoutHash(url.href)===withoutHash(sourceUrl))fragment=url.hash}catch{}}
if(fragment!==null){let id;try{id=decodeURIComponent(fragment.slice(1))}catch{id=fragment.slice(1)};
const target=document.getElementById(id)||document.getElementsByName(id)[0];
if(!id)scrollTo(0,0);else target?.scrollIntoView();
try{location.hash=fragment}catch{}return}
parent.postMessage({type:'puppyone-html-link',channel,href},'*')};
addEventListener('click',follow);addEventListener('auxclick',follow)})();</script>`;
}

/** Author CSP remains effective; authorize only our fixed UI script when its
 * inline policy would otherwise disable the host's link and scroll controls. */
export function allowHtmlNavigationScript(csp: string, nonce: string): string {
  const directives = csp.split(";").map((part) => part.trim()).filter(Boolean);
  const name = (part: string) => part.split(/\s+/, 1)[0]?.toLowerCase();
  let index = directives.findIndex((part) => name(part) === "script-src-elem");
  if (index < 0) index = directives.findIndex((part) => name(part) === "script-src");
  if (index < 0) {
    const fallback = directives.find((part) => name(part) === "default-src");
    if (!fallback) return csp;
    index = directives.push(`script-src ${fallback.split(/\s+/).slice(1).join(" ")}`) - 1;
  }
  const parts = directives[index]!.split(/\s+/);
  if (parts.includes("'unsafe-inline'") && !parts.some((part) => /^'(?:nonce-|sha(?:256|384|512)-)/.test(part))) return csp;
  directives[index] = [...parts.filter((part) => part !== "'none'"), `'nonce-${nonce}'`].join(" ");
  return directives.join("; ");
}
