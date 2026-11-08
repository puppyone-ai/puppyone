import { useEffect, type RefObject } from "react";
import type { HtmlFolderAccessSession } from "../../preview-services/types";
import { isHtmlFolderFileName } from "./htmlFolderFiles";

/**
 * A page asks for its folder the way it would in a browser. Pages that never
 * mention the picker open without a question; one that hides the call simply
 * finds no picker, because the bridge is only installed after the person allows it.
 */
export function requestsHtmlFolderAccess(source: string): boolean {
  return /\bshowDirectoryPicker\b/.test(source);
}

export async function digestHtmlSource(source: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const GRANTS_STORAGE_KEY = "puppyone.editor.html-folder-access.v1";
const MAX_STORED_GRANTS = 200;
type GrantStore = Record<string, { digest: string; updatedAt: number }>;
type GrantStorage = Pick<Storage, "getItem" | "setItem">;

/** An allowance belongs to the exact page text the person saw; any edit asks again. */
export function readHtmlFolderAccessGrant(documentId: string, storage = getBrowserStorage()): string | null {
  return storage ? readGrants(storage)[documentId]?.digest ?? null : null;
}

export function writeHtmlFolderAccessGrant(documentId: string, digest: string | null, storage = getBrowserStorage()) {
  if (!storage) return;
  const grants = readGrants(storage);
  if (digest) grants[documentId] = { digest, updatedAt: Date.now() };
  else delete grants[documentId];
  const kept = Object.entries(grants).sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, MAX_STORED_GRANTS);
  try { storage.setItem(GRANTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept))); } catch { /* Storage is full or unavailable. */ }
}

function readGrants(storage: GrantStorage): GrantStore {
  try {
    const value: unknown = JSON.parse(storage.getItem(GRANTS_STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, GrantStore[string]] => {
      const grant = entry[1] as Partial<GrantStore[string]> | null;
      return typeof grant?.digest === "string" && typeof grant.updatedAt === "number";
    }));
  } catch { return {}; }
}

function getBrowserStorage(): GrantStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/**
 * Runs before the page's own scripts. It offers the subset of the File System
 * Access API a page needs to keep data in text files beside itself; every call
 * is a message the host checks. Nothing here is a security boundary.
 */
export function htmlFolderAccessScript(channel: string, folderName: string): string {
  const literal = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c");
  return `<script>(()=>{const channel=${literal(channel)},folderName=${literal(folderName)};
let seq=0;const pending=new Map();
addEventListener('message',e=>{const d=e.data;if(e.source!==parent||d?.channel!==channel||d.type!=='puppyone-folder-response')return;
const p=pending.get(d.id);if(!p)return;pending.delete(d.id);if(d.ok)p[0](d.value);else p[1](new DOMException(String(d.message||'Request failed'),String(d.name||'NotAllowedError')))});
const call=(op,args)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,[resolve,reject]);parent.postMessage({type:'puppyone-folder-request',channel,id,op,...args},'*')});
const granted=async()=>'granted',denied=m=>Promise.reject(new DOMException(m,'NotAllowedError'));
const text=async d=>typeof d==='string'?d:d instanceof Blob?d.text():new TextDecoder().decode(d);
class FileHandle{constructor(name){this.kind='file';this.name=name}
async getFile(){const r=await call('read',{name:this.name});return new File([r.content],this.name,{type:'text/plain',lastModified:r.modified??Date.now()})}
async createWritable(o){let data=o?.keepExistingData?(await call('read',{name:this.name})).content:'',done=false;const name=this.name;
return{async write(d){if(done)throw new TypeError('This file stream is closed.');
if(d&&typeof d==='object'&&!(d instanceof Blob)&&!(d instanceof ArrayBuffer)&&!ArrayBuffer.isView(d)){
if(d.type==='truncate'){data=data.slice(0,d.size);return}if(d.type!=='write'||d.position!=null)throw new DOMException('Only appending text is available.','NotSupportedError');d=d.data}
data+=await text(d)},async truncate(size){data=data.slice(0,size)},
async seek(){throw new DOMException('Only appending text is available.','NotSupportedError')},
async close(){if(done)return;done=true;await call('write',{name,content:data})},async abort(){done=true}}}
queryPermission(){return granted()}requestPermission(){return granted()}async isSameEntry(o){return o instanceof FileHandle&&o.name===this.name}}
class DirectoryHandle{constructor(){this.kind='directory';this.name=folderName}
async*entries(){for(const f of await call('list',{}))yield[f.name,new FileHandle(f.name)]}
async*keys(){for await(const[n]of this.entries())yield n}
async*values(){for await(const[,h]of this.entries())yield h}
[Symbol.asyncIterator](){return this.entries()}
async getFileHandle(name,o){await call(o?.create?'create':'stat',{name:String(name)});return new FileHandle(String(name))}
getDirectoryHandle(){return denied('Only files directly in this folder are available.')}
removeEntry(){return denied('This page cannot delete files.')}
async resolve(h){return h instanceof FileHandle?[h.name]:null}
queryPermission(){return granted()}requestPermission(){return granted()}async isSameEntry(o){return o instanceof DirectoryHandle}}
const folder=new DirectoryHandle();const picker=async()=>folder;picker.puppyone=true;
Object.defineProperty(window,'showDirectoryPicker',{value:picker,configurable:false,writable:false})})();</script>`;
}

const MAX_LISTED_FILES = 1_000;
const MAX_WRITE_CHARACTERS = 2 * 1024 * 1024;

class FolderAccessError extends Error {
  constructor(readonly domName: string, message: string) { super(message); }
}

/** Answers the page's folder requests, one at a time, inside the allowed folder only. */
export function useHtmlFolderAccessBridge({ frame, channel, session }: {
  frame: RefObject<HTMLIFrameElement | null>;
  channel: string;
  session: HtmlFolderAccessSession | null;
}) {
  useEffect(() => {
    if (!session) return;
    // The version the page last read, so a write over someone else's newer edit fails.
    const versions = new Map<string, string | null>();
    let queue = Promise.resolve();
    let disposed = false;
    const requireName = (value: unknown) => {
      if (!isHtmlFolderFileName(value)) throw new FolderAccessError("NotAllowedError", "This page can only use text files directly in its folder.");
      return value;
    };
    const requireListed = async (name: string) => {
      if (!(await session.list()).some((file) => file.name === name)) throw new FolderAccessError("NotFoundError", `${name} was not found.`);
    };
    const handle = async (data: Record<string, unknown>): Promise<unknown> => {
      switch (data.op) {
        case "list":
          return (await session.list()).filter((file) => isHtmlFolderFileName(file.name)).slice(0, MAX_LISTED_FILES);
        case "stat":
          await requireListed(requireName(data.name));
          return null;
        case "create": {
          const name = requireName(data.name);
          if (!(await session.list()).some((file) => file.name === name)) await session.create(name);
          return null;
        }
        case "read": {
          const name = requireName(data.name);
          const file = await session.read(name);
          versions.set(name, file.version);
          return { content: file.content, modified: file.modified };
        }
        case "write": {
          const name = requireName(data.name);
          if (typeof data.content !== "string" || data.content.length > MAX_WRITE_CHARACTERS) {
            throw new FolderAccessError("QuotaExceededError", "This file is too large to save.");
          }
          await requireListed(name);
          const result = await session.write(name, data.content, versions.get(name) ?? null);
          versions.set(name, result.version);
          return null;
        }
        default:
          throw new FolderAccessError("NotSupportedError", "This request is not available.");
      }
    };
    const receive = (event: MessageEvent) => {
      const source = frame.current?.contentWindow;
      const data: unknown = event.data;
      if (!source || event.source !== source || !data || typeof data !== "object") return;
      const request = data as Record<string, unknown>;
      if (request.type !== "puppyone-folder-request" || request.channel !== channel || !Number.isSafeInteger(request.id)) return;
      const reply = (message: Record<string, unknown>) => {
        if (!disposed) source.postMessage({ type: "puppyone-folder-response", channel, id: request.id, ...message }, "*");
      };
      queue = queue.then(() => handle(request)).then((value) => reply({ ok: true, value }), (error: unknown) => reply({
        ok: false,
        name: error instanceof FolderAccessError ? error.domName : "InvalidStateError",
        message: error instanceof Error ? error.message : "Request failed.",
      }));
    };
    window.addEventListener("message", receive);
    return () => { disposed = true; window.removeEventListener("message", receive); };
  }, [frame, channel, session]);
}
