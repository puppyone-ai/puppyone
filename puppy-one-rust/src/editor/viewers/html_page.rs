//! What an interactive HTML page may do beyond showing itself
//! (`htmlFolderAccess.ts`, `htmlFolderFiles.ts`, `htmlLinkNavigation.ts`).
//!
//! A page that mentions `showDirectoryPicker` asks once, before it runs, to
//! use its own folder. Allowed, it runs offline ([`OFFLINE_HEADER`]) with a
//! picker that reaches only plain text files directly beside it and a
//! `localStorage` the host keeps ([`folder_script`]); declined, it runs as
//! any other page, without a picker. A link the person really clicks is
//! never followed inside the page: the host resolves it ([`link_script`],
//! [`navigation_href`]) and opens the document or the browser.
//!
//! The product's page lives in an iframe and talks to its parent; here the
//! page is the web view's own document, so it posts through `window.ipc`
//! and the host answers by evaluating `window.__puppyoneHtmlPage(…)`.
//! Nothing in these scripts is a security boundary: every request is
//! checked here ([`Folder`]).
use crate::workspace::{Document, TextEncoding, Workspace};
use std::{path::PathBuf, sync::Arc};

/// `requestsHtmlFolderAccess`: pages that never name the picker open
/// without a question.
pub fn requests_folder_access(source: &str) -> bool {
    const NAME: &str = "showDirectoryPicker";
    let word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    source.match_indices(NAME).any(|(at, _)| {
        !word(source[..at].chars().next_back()) && !word(source[at + NAME.len()..].chars().next())
    })
}
/// The page text an allowance belongs to; any edit asks again.
pub fn digest(source: &str) -> String {
    blake3::hash(source.as_bytes()).to_hex().to_string()
}

/// `isHtmlFolderFileName`: plain-text data a page may keep beside itself.
/// Never pages, scripts or hidden files.
pub fn is_folder_file_name(name: &str) -> bool {
    const EXTENSIONS: [&str; 8] = ["md", "markdown", "txt", "json", "csv", "tsv", "yaml", "yml"];
    if name.is_empty() || name.encode_utf16().count() > 255 || name.starts_with('.') {
        return false;
    }
    if name
        .chars()
        .any(|c| matches!(c, '/' | '\\' | ':') || c.is_control())
    {
        return false;
    }
    name.rsplit_once('.')
        .is_some_and(|(_, ext)| EXTENSIONS.contains(&ext.to_lowercase().as_str()))
}

/// `OFFLINE_HTML_PREVIEW_POLICY`: a page that can use its folder may not
/// reach the network. `puppyone-preview:` is the native resource scheme the
/// product's projection serves from.
macro_rules! offline_csp {
    () => {
        "default-src 'none'; \
        script-src 'unsafe-inline' puppyone-preview: puppyone-local:; \
        style-src 'unsafe-inline' puppyone-preview: puppyone-local:; \
        img-src data: blob: puppyone-preview: puppyone-local:; \
        media-src data: blob: puppyone-preview: puppyone-local:; \
        font-src data: puppyone-preview: puppyone-local:; \
        connect-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; \
        worker-src 'none'; base-uri puppyone-preview: puppyone-local:; form-action 'none'"
    };
}
pub const OFFLINE_CSP: &str = offline_csp!();
/// Response header for every response of an offline page.
pub const OFFLINE_HEADER: &str = concat!(
    offline_csp!(),
    "; sandbox allow-scripts allow-forms allow-modals"
);

/// `<script>` text with `<` escaped, for values inlined into a script.
fn literal(value: &serde_json::Value) -> String {
    value.to_string().replace('<', "\\u003c")
}

/// `htmlFolderAccessScript`: runs before the page's own scripts. It offers
/// the File System Access API a page needs to keep data in text files beside
/// itself, and a `localStorage` the host keeps for this page.
pub fn folder_script(
    folder_name: &str,
    storage: &serde_json::Map<String, serde_json::Value>,
) -> String {
    let folder = literal(&serde_json::Value::String(folder_name.to_owned()));
    let storage = literal(&serde_json::Value::Object(storage.clone()));
    format!(
        "<script>(()=>{{const ipc=window.ipc,post=m=>ipc&&ipc.postMessage(JSON.stringify(m)),folderName={folder};
const store=new Map(Object.entries({storage}));let storeQueued=false;
const storeChanged=()=>{{if(storeQueued)return;storeQueued=true;queueMicrotask(()=>{{storeQueued=false;
post({{type:'storage',entries:Object.fromEntries(store)}})}})}};
const pageStorage={{get length(){{return store.size}},key(i){{return[...store.keys()][i]??null}},
getItem(k){{k=String(k);return store.has(k)?store.get(k):null}},setItem(k,v){{store.set(String(k),String(v));storeChanged()}},
removeItem(k){{store.delete(String(k));storeChanged()}},clear(){{store.clear();storeChanged()}}}};
Object.defineProperty(window,'localStorage',{{value:pageStorage,configurable:false,writable:false}});
let seq=0;const pending=new Map();
Object.defineProperty(window,'__puppyoneHtmlPage',{{value:d=>{{const p=pending.get(d.id);if(!p)return;pending.delete(d.id);
if(d.ok)p[0](d.value);else p[1](new DOMException(String(d.message||'Request failed'),String(d.name||'NotAllowedError')))}},configurable:false,writable:false}});
const call=(op,args)=>new Promise((resolve,reject)=>{{const id=++seq;pending.set(id,[resolve,reject]);post({{type:'folder',id,op,...args}})}});
const granted=async()=>'granted',denied=m=>Promise.reject(new DOMException(m,'NotAllowedError'));
const text=async d=>typeof d==='string'?d:d instanceof Blob?d.text():new TextDecoder().decode(d);
class FileHandle{{constructor(name){{this.kind='file';this.name=name}}
async getFile(){{const r=await call('read',{{name:this.name}});return new File([r.content],this.name,{{type:'text/plain',lastModified:r.modified??Date.now()}})}}
async createWritable(o){{let data=o?.keepExistingData?(await call('read',{{name:this.name}})).content:'',done=false;const name=this.name;
return{{async write(d){{if(done)throw new TypeError('This file stream is closed.');
if(d&&typeof d==='object'&&!(d instanceof Blob)&&!(d instanceof ArrayBuffer)&&!ArrayBuffer.isView(d)){{
if(d.type==='truncate'){{data=data.slice(0,d.size);return}}if(d.type!=='write'||d.position!=null)throw new DOMException('Only appending text is available.','NotSupportedError');d=d.data}}
data+=await text(d)}},async truncate(size){{data=data.slice(0,size)}},
async seek(){{throw new DOMException('Only appending text is available.','NotSupportedError')}},
async close(){{if(done)return;done=true;await call('write',{{name,content:data}})}},async abort(){{done=true}}}}}}
queryPermission(){{return granted()}}requestPermission(){{return granted()}}async isSameEntry(o){{return o instanceof FileHandle&&o.name===this.name}}}}
class DirectoryHandle{{constructor(){{this.kind='directory';this.name=folderName}}
async*entries(){{for(const f of await call('list',{{}}))yield[f.name,new FileHandle(f.name)]}}
async*keys(){{for await(const[n]of this.entries())yield n}}
async*values(){{for await(const[,h]of this.entries())yield h}}
[Symbol.asyncIterator](){{return this.entries()}}
async getFileHandle(name,o){{await call(o?.create?'create':'stat',{{name:String(name)}});return new FileHandle(String(name))}}
getDirectoryHandle(){{return denied('Only files directly in this folder are available.')}}
removeEntry(){{return denied('This page cannot delete files.')}}
async resolve(h){{return h instanceof FileHandle?[h.name]:null}}
queryPermission(){{return granted()}}requestPermission(){{return granted()}}async isSameEntry(o){{return o instanceof DirectoryHandle}}}}
const folder=new DirectoryHandle();const picker=async()=>folder;picker.puppyone=true;
Object.defineProperty(window,'showDirectoryPicker',{{value:picker,configurable:false,writable:false}})}})();</script>"
    )
}

/// `htmlLinkNavigationScript`: links never replace the page being shown. A
/// real click on a link goes to the host; the page's own handlers get first
/// refusal, downloads keep their path and fragments scroll in place.
pub fn link_script(source_url: Option<&str>) -> String {
    let source = literal(&source_url.map_or(serde_json::Value::Null, |s| s.into()));
    format!(
        "<script>(()=>{{const ipc=window.ipc,sourceUrl={source};
const withoutHash=value=>{{try{{const url=new URL(value);url.hash='';return url.href}}catch{{return null}}}};
const follow=event=>{{if(!event.isTrusted||event.defaultPrevented||event.button!==0&&event.button!==1)return;
const link=event.composedPath().find(node=>node instanceof Element&&node.matches('a[href],area[href]'));
if(!link||link.hasAttribute('download'))return;const href=link.getAttribute('href');if(href===null)return;
event.preventDefault();let fragment=null;
if(href.trim().startsWith('#'))fragment=href.trim();
else{{try{{const url=new URL(href,document.baseURI);if(sourceUrl&&url.hash&&withoutHash(url.href)===withoutHash(sourceUrl))fragment=url.hash}}catch{{}}}}
if(fragment!==null){{let id;try{{id=decodeURIComponent(fragment.slice(1))}}catch{{id=fragment.slice(1)}};
const target=document.getElementById(id)||document.getElementsByName(id)[0];
if(!id)scrollTo(0,0);else target?.scrollIntoView();
try{{location.hash=fragment}}catch{{}}return}}
ipc&&ipc.postMessage(JSON.stringify({{type:'link',href}}))}};
addEventListener('click',follow);addEventListener('auxclick',follow)}})();</script>"
    )
}

/// `resolveHtmlNavigationHref`: where a clicked link points, against the
/// page's own `<base href>` (never the private resource URL the page is
/// served from). Scheme links stay as they are; paths become relative to the
/// document (`./…`), or stay rooted (`/…`).
pub fn navigation_href(href: &str, source_base: Option<&str>) -> Option<String> {
    if href.is_empty() || href.chars().count() > 8192 || href.chars().any(|c| c.is_control()) {
        return None;
    }
    let value = href.trim();
    if value.is_empty() || value.starts_with('#') {
        return None;
    }
    let web_base = source_base.filter(|b| {
        let lower = b.to_ascii_lowercase();
        lower.starts_with("http:") || lower.starts_with("https:") || b.starts_with("//")
    });
    if let Some(rest) = value.strip_prefix("//") {
        let base = web_base.filter(|b| !b.starts_with("//")).map_or_else(
            || format!("https://{rest}"),
            |b| join_url(b, value).unwrap_or_default(),
        );
        return url::Url::parse(&base).ok().map(String::from);
    }
    if has_scheme(value) {
        return Some(value.to_owned());
    }
    if let Some(base) = web_base {
        let base = if base.starts_with("//") {
            format!("https:{base}")
        } else {
            base.to_owned()
        };
        return join_url(&base, value);
    }
    // A relative `<base>` changes the path, not which workspace owns the link.
    if source_base.is_some_and(has_scheme) {
        return None;
    }
    let base_path = source_base
        .map(|b| b.split(['?', '#']).next().unwrap_or_default())
        .unwrap_or_default();
    let directory = if base_path.ends_with('/')
        || base_path == "."
        || base_path == ".."
        || base_path.ends_with("/.")
        || base_path.ends_with("/..")
    {
        format!("{}/", base_path.trim_end_matches('/'))
    } else {
        base_path[..base_path.rfind('/').map_or(0, |i| i + 1)].to_owned()
    };
    let relative = if value.starts_with('/') {
        value.to_owned()
    } else {
        format!("{directory}{value}")
    };
    let mut parts = Vec::new();
    for part in relative.split('/') {
        let decoded = percent_decode(part)?;
        if decoded
            .chars()
            .any(|c| matches!(c, '\\' | '/') || c.is_control())
        {
            return None;
        }
        parts.push(decoded);
    }
    let target = parts.join("/");
    Some(
        if target.starts_with('/') || target.starts_with("./") || target.starts_with("../") {
            target
        } else {
            format!("./{target}")
        },
    )
}
fn has_scheme(value: &str) -> bool {
    value.split_once(':').is_some_and(|(scheme, _)| {
        scheme.starts_with(|c: char| c.is_ascii_alphabetic())
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
    })
}
fn join_url(base: &str, value: &str) -> Option<String> {
    url::Url::parse(base)
        .ok()?
        .join(value)
        .ok()
        .map(String::from)
}
/// `decodeURIComponent`: `None` where it would throw.
fn percent_decode(part: &str) -> Option<String> {
    let bytes = part.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// `useHtmlFolderAccessBridge`'s failures, by DOM exception name.
#[derive(Debug, PartialEq)]
pub struct Refusal {
    pub name: &'static str,
    pub message: String,
}
fn refuse(name: &'static str, message: impl Into<String>) -> Refusal {
    Refusal {
        name,
        message: message.into(),
    }
}
const MAX_LISTED_FILES: usize = 1_000;
const MAX_WRITE_CHARACTERS: usize = 2 * 1024 * 1024;

/// The folder a page may use (`HtmlFolderAccessSession` and the bridge's
/// checks): text files directly in it, through the workspace's own
/// provider. The version a page last read is kept, so a write over someone
/// else's newer edit fails.
pub struct Folder {
    workspace: Arc<Workspace>,
    /// The page's folder, relative to the workspace.
    dir: PathBuf,
    read: std::collections::HashMap<String, Document>,
}
impl Folder {
    pub fn new(workspace: Arc<Workspace>, dir: PathBuf) -> Self {
        Self {
            workspace,
            dir,
            read: Default::default(),
        }
    }
    /// A request the page posted, answered on the calling (background)
    /// thread.
    pub fn handle(&mut self, request: &serde_json::Value) -> Result<serde_json::Value, Refusal> {
        let name = || {
            request["name"]
                .as_str()
                .filter(|n| is_folder_file_name(n))
                .map(str::to_owned)
                .ok_or_else(|| {
                    refuse(
                        "NotAllowedError",
                        "This page can only use text files directly in its folder.",
                    )
                })
        };
        match request["op"].as_str() {
            Some("list") => Ok(serde_json::Value::Array(
                self.list()
                    .into_iter()
                    .take(MAX_LISTED_FILES)
                    .map(|name| serde_json::json!({ "name": name, "modified": null }))
                    .collect(),
            )),
            Some("stat") => {
                let name = name()?;
                self.require_listed(&name)?;
                Ok(serde_json::Value::Null)
            }
            Some("create") => {
                let name = name()?;
                if !self.list().contains(&name) {
                    self.workspace
                        .create_entry(&self.dir, &name, false, "")
                        .map_err(|e| refuse("InvalidStateError", e.to_string()))?;
                }
                Ok(serde_json::Value::Null)
            }
            Some("read") => {
                let name = name()?;
                self.require_listed(&name)?;
                let document = self
                    .workspace
                    .read(&self.dir.join(&name))
                    .map_err(|_| refuse("NotFoundError", format!("{name} was not found.")))?;
                if document.encoding != TextEncoding::Utf8 {
                    return Err(refuse(
                        "InvalidStateError",
                        format!("{name} is not a UTF-8 text file."),
                    ));
                }
                let content = document.text.clone();
                self.read.insert(name, document);
                Ok(serde_json::json!({ "content": content, "modified": null }))
            }
            Some("write") => {
                let name = name()?;
                let content = request["content"]
                    .as_str()
                    .filter(|c| c.encode_utf16().count() <= MAX_WRITE_CHARACTERS)
                    .ok_or_else(|| {
                        refuse("QuotaExceededError", "This file is too large to save.")
                    })?;
                self.require_listed(&name)?;
                // A file the page never read is written over as it is now.
                let baseline = match self.read.remove(&name) {
                    Some(document) => document,
                    None => self
                        .workspace
                        .read(&self.dir.join(&name))
                        .map_err(|_| refuse("NotFoundError", format!("{name} was not found.")))?,
                };
                // Line endings are the provider's to keep.
                let text = content.replace("\r\n", "\n").replace('\r', "\n");
                let outcome = self
                    .workspace
                    .save(&baseline, &text)
                    .map_err(|e| refuse("InvalidStateError", e.to_string()))?;
                if outcome.updated {
                    return Err(refuse(
                        "InvalidStateError",
                        format!("{name} changed since this page read it."),
                    ));
                }
                self.read.insert(name, outcome.document);
                Ok(serde_json::Value::Null)
            }
            _ => Err(refuse(
                "NotSupportedError",
                "This request is not available.",
            )),
        }
    }
    /// Text files directly in the folder, by name.
    fn list(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .workspace
            .list(&self.dir)
            .unwrap_or_default()
            .into_iter()
            .filter(|node| !node.folder && is_folder_file_name(&node.name))
            .map(|node| node.name)
            .collect();
        names.sort();
        names
    }
    fn require_listed(&self, name: &str) -> Result<(), Refusal> {
        if self.list().iter().any(|n| n == name) {
            Ok(())
        } else {
            Err(refuse("NotFoundError", format!("{name} was not found.")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_a_page_naming_the_picker_asks_and_any_edit_asks_again() {
        assert!(requests_folder_access("await window.showDirectoryPicker()"));
        assert!(!requests_folder_access("showDirectoryPickerShim()"));
        assert!(!requests_folder_access("<p>No folder here</p>"));
        assert_ne!(digest("<p>a</p>"), digest("<p>b</p>"));
    }

    #[test]
    fn a_page_keeps_only_plain_text_files_beside_itself() {
        for ok in ["notes.md", "Tasks.JSON", "data.csv", "a.yml"] {
            assert!(is_folder_file_name(ok), "{ok}");
        }
        for no in [
            "",
            ".hidden.md",
            "page.html",
            "script.js",
            "a/b.md",
            "a\\b.md",
            "c:d.md",
            "x",
        ] {
            assert!(!is_folder_file_name(no), "{no}");
        }
    }

    #[test]
    fn links_resolve_against_the_pages_own_base_not_its_served_url() {
        assert_eq!(
            navigation_href("notes.md", None).as_deref(),
            Some("./notes.md")
        );
        assert_eq!(
            navigation_href("../a%20b.md", None).as_deref(),
            Some("../a b.md")
        );
        assert_eq!(
            navigation_href("/root.md", None).as_deref(),
            Some("/root.md")
        );
        assert_eq!(
            navigation_href("x.md", Some("docs/")).as_deref(),
            Some("./docs/x.md")
        );
        assert_eq!(
            navigation_href("x.html", Some("https://site.test/a/")).as_deref(),
            Some("https://site.test/a/x.html")
        );
        assert_eq!(
            navigation_href("//cdn.test/p", None).as_deref(),
            Some("https://cdn.test/p")
        );
        assert_eq!(
            navigation_href("mailto:a@b.test", None).as_deref(),
            Some("mailto:a@b.test")
        );
        assert_eq!(navigation_href("#top", None), None);
        assert_eq!(
            navigation_href("x.md", Some("puppyone-preview://local/")),
            None
        );
        assert_eq!(navigation_href("a%2Fb.md", None), None);
    }

    #[test]
    fn the_folder_answers_inside_itself_and_refuses_a_stale_write() {
        let dir = tempfile::tempdir().unwrap();
        let site = dir.path().join("site");
        std::fs::create_dir(&site).unwrap();
        std::fs::write(site.join("tasks.md"), "- a\n").unwrap();
        std::fs::write(site.join("page.html"), "<p>").unwrap();
        std::fs::write(dir.path().join("secret.md"), "x").unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let mut folder = Folder::new(workspace, "site".into());
        let listed = folder.handle(&json!({ "op": "list" })).unwrap();
        let names: Vec<_> = listed
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["name"].clone())
            .collect();
        assert_eq!(names, [json!("tasks.md")], "no pages, nothing above");
        let read = folder
            .handle(&json!({ "op": "read", "name": "tasks.md" }))
            .unwrap();
        assert_eq!(read["content"], "- a\n");
        assert_eq!(
            folder
                .handle(&json!({ "op": "read", "name": "../secret.md" }))
                .unwrap_err()
                .name,
            "NotAllowedError"
        );
        // Someone else edits it after the page read it: the page's write fails.
        std::fs::write(site.join("tasks.md"), "- b\n").unwrap();
        let stale =
            folder.handle(&json!({ "op": "write", "name": "tasks.md", "content": "- c\n" }));
        assert_eq!(stale.unwrap_err().name, "InvalidStateError");
        assert_eq!(
            std::fs::read_to_string(site.join("tasks.md")).unwrap(),
            "- b\n"
        );
        folder
            .handle(&json!({ "op": "read", "name": "tasks.md" }))
            .unwrap();
        folder
            .handle(&json!({ "op": "write", "name": "tasks.md", "content": "- c\r\n" }))
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(site.join("tasks.md")).unwrap(),
            "- c\n"
        );
        // New files are created empty, then written.
        folder
            .handle(&json!({ "op": "create", "name": "log.txt" }))
            .unwrap();
        assert_eq!(std::fs::read_to_string(site.join("log.txt")).unwrap(), "");
        folder
            .handle(&json!({ "op": "write", "name": "log.txt", "content": "one\n" }))
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(site.join("log.txt")).unwrap(),
            "one\n"
        );
        assert_eq!(
            folder
                .handle(&json!({ "op": "stat", "name": "none.md" }))
                .unwrap_err()
                .name,
            "NotFoundError"
        );
        assert_eq!(
            folder.handle(&json!({ "op": "delete" })).unwrap_err().name,
            "NotSupportedError"
        );
    }

    #[test]
    fn the_scripts_keep_the_page_text_out_of_their_own() {
        let mut storage = serde_json::Map::new();
        storage.insert("k".into(), json!("</script><script>alert(1)"));
        let script = folder_script("Notes</script>", &storage);
        assert_eq!(script.matches("</script>").count(), 1);
        assert!(script.contains("showDirectoryPicker"));
        assert!(link_script(Some("puppyone-preview://local/a.html")).contains("'link'"));
        assert!(OFFLINE_HEADER.contains("connect-src 'none'"));
        assert!(OFFLINE_HEADER.ends_with("sandbox allow-scripts allow-forms allow-modals"));
    }
}
