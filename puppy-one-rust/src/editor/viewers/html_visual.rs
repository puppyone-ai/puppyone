//! The HTML viewer's Edit mode: the product's `HtmlVisualSurface` (source
//! index, edit compiler, sanitized projection with the fixed frame bridge,
//! floating toolbar, block action rail and text input), bundled from the
//! product sources by `tools/import-html-visual.mjs` and run in the viewer's
//! WebView, its overlays drawn inside the page (D-2).
//!
//! Supports the async `prepare` flush barrier (`VW-22`) before leaving Edit
//! mode or snapshotting, and normalized cross-mode `viewportState` scroll
//! progress (`VW-23`).
use super::web::{WebFrame, parse_find_result};
use crate::{
    editor::registry::{HostCommand, ViewerSurface},
    platform::webview::{Content, Entry, Ipc, Source, import_image, local_url_for},
};
use gpui::{prelude::*, *};
use serde::Deserialize;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    ops::Range,
    path::PathBuf,
    rc::Rc,
    time::{Duration, Instant},
};

const SCRIPT: &[u8] = include_bytes!("../../../assets/web/html-visual.js");
const STYLE: &[u8] = include_bytes!("../../../assets/web/html-visual.css");
const GEIST: &[u8] = include_bytes!("../../../assets/web/html-visual-geist.woff2");
/// `HTML_VISUAL_MAX_CHARS` (UTF-16 code units).
pub const MAX_CHARS: usize = 512 * 1024;
/// Bounded timeout for the `prepare` flush barrier so hung pages never deadlock (`VW-22`).
pub const PREPARE_TIMEOUT: Duration = Duration::from_millis(250);
/// The page's own keyboard handling and the app menu can both ask for the
/// same undo; one request per gesture reaches the history.
const HISTORY_DEDUPE: Duration = Duration::from_millis(150);

/// Whether a document can enter Edit mode (`parseHtmlSource`'s path and
/// size admission; the page applies the remaining rules and reports
/// `unavailable`).
pub fn admits(name: &str, text: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    (lower.ends_with(".html") || lower.ends_with(".htm"))
        && text.encode_utf16().count() <= MAX_CHARS
}

/// Runs when the page cannot map the document.
pub type Unavailable = Rc<dyn Fn(&mut Window, &mut App)>;
pub type FindCallback = Rc<dyn Fn(usize, usize, &mut App)>;

/// What a session needs from its viewer.
pub struct Params {
    pub text: String,
    pub name: String,
    pub folder: Option<PathBuf>,
    pub assets: Option<Source>,
    pub dark: bool,
    pub enabled: bool,
    pub budget: u64,
    pub initial_scroll: f32,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Inbound {
    Ready,
    Edit {
        generation: u64,
        edits: Vec<Change>,
    },
    History {
        direction: String,
    },
    Unavailable,
    SelectRange {
        from: Option<usize>,
        to: Option<usize>,
    },
    Import {
        request: String,
        name: String,
        data: String,
    },
    Prepared {
        request: u64,
    },
    Scroll {
        ratio: f32,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
struct Change {
    from: usize,
    to: usize,
    insert: String,
}

struct State {
    /// The text the page holds, at `generation`.
    mirror: String,
    generation: u64,
    ready: bool,
    enabled: bool,
    last_history: Option<Instant>,
    scroll_ratio: Rc<Cell<f32>>,
    next_prepare: u64,
    pending_prepares: HashMap<u64, async_channel::Sender<()>>,
}

/// One Edit-mode page. Dropping it closes the WebView.
pub struct Session {
    pub frame: Entity<WebFrame>,
    state: Rc<RefCell<State>>,
    #[cfg(test)]
    inbox: async_channel::Sender<String>,
    _task: Task<()>,
}

impl Session {
    /// `on_unavailable` runs when the page cannot map the document
    /// (`onUnavailable`: templating, malformed markup, size).
    pub fn start(
        params: Params,
        source: Rc<dyn ViewerSurface>,
        scroll_ratio: Rc<Cell<f32>>,
        on_unavailable: Unavailable,
        on_find: FindCallback,
        window: &mut Window,
        cx: &mut App,
    ) -> Self {
        let (tx, rx) = async_channel::unbounded::<String>();
        let state = Rc::new(RefCell::new(State {
            mirror: params.text.clone(),
            generation: 1,
            ready: false,
            enabled: params.enabled,
            last_history: None,
            scroll_ratio,
            next_prepare: 0,
            pending_prepares: HashMap::new(),
        }));
        let folder = params.folder.clone();
        let content = Content {
            source: params.assets.clone().filter(|_| params.folder.is_none()),
            root: params.folder.clone(),
            entry: Entry::Html(page(&params, 1)),
            max_bytes: params.budget,
            assets: vec![
                ("html-visual.js", SCRIPT),
                ("html-visual.css", STYLE),
                ("fonts/geist/Geist-Variable.woff2", GEIST),
            ],
            ipc: Some(Ipc(tx.clone())),
            policy: None,
            frames: None,
            disk_assets: None,
            locked: false,
        };
        #[cfg(not(test))]
        drop(tx);
        let dark = params.dark;
        let frame = cx.new(|_| {
            let mut f = WebFrame::new(Some(content), dark);
            // Active visual edit sessions may hold uncommitted block drafts (`VW-20`).
            f.set_pinned(true);
            f
        });
        let task = {
            let state = state.clone();
            let frame_ref = frame.clone();
            frame.update(cx, |_, cx| {
                cx.spawn_in(window, async move |_, cx| {
                    while let Ok(body) = rx.recv().await {
                        if let Some((current, total)) = parse_find_result(&body) {
                            let on_find = on_find.clone();
                            let _ = cx.update(|_, cx| on_find(current, total, cx));
                            continue;
                        }
                        let Ok(message) = serde_json::from_str::<Inbound>(&body) else {
                            continue;
                        };
                        let state = state.clone();
                        let frame = frame_ref.clone();
                        let source = source.clone();
                        let on_unavailable = on_unavailable.clone();
                        let folder = folder.clone();
                        let imported = cx.update(|window, cx| {
                            receive(
                                message,
                                &state,
                                &frame,
                                &*source,
                                &on_unavailable,
                                folder,
                                window,
                                cx,
                            )
                        });
                        if let Ok(Some((request, folder, name, bytes))) = imported {
                            let result = cx
                                .background_executor()
                                .spawn(async move {
                                    import_image(&folder, &name, &bytes).map(|_| name)
                                })
                                .await;
                            let _ = cx.update(|_, cx| {
                                let reply = match result {
                                    Ok(path) => serde_json::json!({"type": "imported", "request": request, "path": path}),
                                    Err(_) => serde_json::json!({"type": "importFailed", "request": request}),
                                };
                                post(&frame_ref, &reply, cx);
                            });
                        }
                    }
                })
            })
        };
        Self {
            frame,
            state,
            #[cfg(test)]
            inbox: tx,
            _task: task,
        }
    }

    #[cfg(test)]
    pub fn deliver(&self, body: &str) -> bool {
        self.inbox.try_send(body.to_owned()).is_ok()
    }

    pub fn is_ready(&self) -> bool {
        self.state.borrow().ready
    }

    pub fn has_pending_prepare(&self) -> bool {
        !self.state.borrow().pending_prepares.is_empty()
    }

    /// Runs the async `prepare` flush barrier (`VW-22`) before exiting `Mode::Edit`
    /// or taking a snapshot: sends `{"type": "prepare", "request": id}` to the
    /// page and waits for `{"type": "prepared", "request": id}` (after any final
    /// `Inbound::Edit` on the FIFO IPC channel) or `PREPARE_TIMEOUT` (`250ms`).
    pub fn prepare(
        &self,
        window: &mut Window,
        cx: &mut App,
        done: impl FnOnce(&mut Window, &mut App) + 'static,
    ) {
        if !self.state.borrow().ready {
            done(window, cx);
            return;
        }
        let (tx, rx) = async_channel::bounded::<()>(1);
        let request = {
            let mut s = self.state.borrow_mut();
            s.next_prepare += 1;
            let id = s.next_prepare;
            s.pending_prepares.insert(id, tx.clone());
            id
        };
        post(
            &self.frame,
            &serde_json::json!({"type": "prepare", "request": request}),
            cx,
        );
        let state_for_timeout = self.state.clone();
        let timer = cx.background_executor().timer(PREPARE_TIMEOUT);
        cx.spawn(async move |cx| {
            timer.await;
            cx.update(|_| {
                state_for_timeout
                    .borrow_mut()
                    .pending_prepares
                    .remove(&request);
            });
            let _ = tx.try_send(());
        })
        .detach();

        let state_cleanup = self.state.clone();
        self.frame
            .update(cx, |_, cx| {
                cx.spawn_in(window, async move |_, cx| {
                    let _ = rx.recv().await;
                    let _ = cx.update(|window, cx| {
                        state_cleanup.borrow_mut().pending_prepares.remove(&request);
                        done(window, cx);
                    });
                })
            })
            .detach();
    }

    /// The text changed outside this page: replace the mirror.
    pub fn sync(&self, text: &str, cx: &mut App) {
        sync(&self.state, &self.frame, text, cx);
    }

    /// Input became blocked or allowed (`canEdit`).
    pub fn set_enabled(&self, enabled: bool, cx: &mut App) {
        let mut state = self.state.borrow_mut();
        if state.enabled == enabled {
            return;
        }
        state.enabled = enabled;
        if state.ready {
            drop(state);
            post(
                &self.frame,
                &serde_json::json!({"type": "enabled", "value": enabled}),
                cx,
            );
        }
    }

    /// Undo or redo from the app (menu, shortcut outside the page).
    pub fn history(
        &self,
        redo: bool,
        source: &dyn ViewerSurface,
        window: &mut Window,
        cx: &mut App,
    ) {
        history(&self.state, &self.frame, redo, source, window, cx);
    }
}

#[allow(clippy::too_many_arguments)]
fn receive(
    message: Inbound,
    state: &Rc<RefCell<State>>,
    frame: &Entity<WebFrame>,
    source: &dyn ViewerSurface,
    on_unavailable: &Unavailable,
    folder: Option<PathBuf>,
    window: &mut Window,
    cx: &mut App,
) -> Option<(String, PathBuf, String, Vec<u8>)> {
    match message {
        Inbound::Ready => {
            let (enabled, ratio) = {
                let mut s = state.borrow_mut();
                s.ready = true;
                (s.enabled, s.scroll_ratio.get())
            };
            post(
                frame,
                &serde_json::json!({"type": "enabled", "value": enabled}),
                cx,
            );
            // The text may have moved on while the page loaded.
            let text = source.text(cx).unwrap_or_default();
            sync(state, frame, &text, cx);
            if ratio > 0.0 {
                post(
                    frame,
                    &serde_json::json!({"type": "setScroll", "ratio": ratio}),
                    cx,
                );
            }
        }
        Inbound::Edit { generation, edits } => {
            let current = source.text(cx).unwrap_or_default();
            let next = {
                let s = state.borrow();
                if generation != s.generation || !s.ready {
                    return None;
                }
                (s.enabled && current == s.mirror)
                    .then(|| apply(&s.mirror, &edits))
                    .flatten()
            };
            let applied = next.is_some_and(|next| {
                state.borrow_mut().mirror = next;
                let ranges: Vec<(Range<usize>, String)> = edits
                    .iter()
                    .map(|c| (c.from..c.to, c.insert.clone()))
                    .collect();
                source.edit_utf16(&ranges, window, cx)
            });
            let text = source.text(cx).unwrap_or_default();
            if !applied || text != state.borrow().mirror {
                // Refused or diverged: the page restarts from the real text.
                state.borrow_mut().mirror = String::new();
                sync(state, frame, &text, cx);
            }
        }
        Inbound::History { direction } => {
            history(state, frame, direction == "redo", source, window, cx);
        }
        Inbound::Unavailable => on_unavailable(window, cx),
        Inbound::SelectRange { from, to } => {
            let range = {
                let s = state.borrow();
                from.zip(to).and_then(|(from, to)| {
                    let start = byte_offset(&s.mirror, from)?;
                    let end = byte_offset(&s.mirror, to)?;
                    (start <= end).then_some(start..end)
                })
            };
            source.reveal_range(range, window, cx);
        }
        Inbound::Import {
            request,
            name,
            data,
        } => {
            use base64::Engine as _;
            let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes());
            match (folder, bytes) {
                (Some(folder), Ok(bytes)) if state.borrow().enabled => {
                    return Some((request, folder, name, bytes));
                }
                _ => post(
                    frame,
                    &serde_json::json!({"type": "importFailed", "request": request}),
                    cx,
                ),
            }
        }
        Inbound::Prepared { request } => {
            let tx = state.borrow_mut().pending_prepares.remove(&request);
            if let Some(tx) = tx {
                let _ = tx.try_send(());
            }
        }
        Inbound::Scroll { ratio } => {
            if ratio.is_finite() {
                state.borrow().scroll_ratio.set(ratio.clamp(0.0, 1.0));
            }
        }
    }
    None
}

fn history(
    state: &Rc<RefCell<State>>,
    frame: &Entity<WebFrame>,
    redo: bool,
    source: &dyn ViewerSurface,
    window: &mut Window,
    cx: &mut App,
) {
    {
        let mut s = state.borrow_mut();
        let now = Instant::now();
        if !s.enabled
            || s.last_history
                .is_some_and(|last| now.duration_since(last) < HISTORY_DEDUPE)
        {
            return;
        }
        s.last_history = Some(now);
    }
    source.command(
        if redo {
            HostCommand::ReplayRedo
        } else {
            HostCommand::ReplayUndo
        },
        window,
        cx,
    );
    let text = source.text(cx).unwrap_or_default();
    sync(state, frame, &text, cx);
}

fn sync(state: &Rc<RefCell<State>>, frame: &Entity<WebFrame>, text: &str, cx: &mut App) {
    let message = {
        let mut s = state.borrow_mut();
        if !s.ready || s.mirror == text {
            return;
        }
        s.generation += 1;
        s.mirror = text.to_owned();
        serde_json::json!({"type": "reset", "text": text, "generation": s.generation})
    };
    post(frame, &message, cx);
}

fn post(frame: &Entity<WebFrame>, message: &serde_json::Value, cx: &mut App) {
    let script = format!(
        "window.__puppyoneHtmlVisual&&window.__puppyoneHtmlVisual({})",
        script_json(message)
    );
    frame.read(cx).evaluate(&script);
}

/// JSON safe inside a `<script>` element and script source.
pub(super) fn script_json(value: &serde_json::Value) -> String {
    value
        .to_string()
        .replace('<', "\\u003c")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// `text` with UTF-16 `changes` (ascending, disjoint, in `text`'s
/// coordinates) applied; `None` when a change does not fit the text.
fn apply(text: &str, changes: &[Change]) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut previous_end = 0;
    for change in changes {
        if change.from < previous_end || change.to < change.from {
            return None;
        }
        let from = byte_offset(text, change.from)?;
        let to = byte_offset(text, change.to)?;
        out.push_str(&text[copied..from]);
        out.push_str(&change.insert);
        copied = to;
        previous_end = change.to;
    }
    out.push_str(&text[copied..]);
    Some(out)
}

fn byte_offset(text: &str, utf16: usize) -> Option<usize> {
    let mut units = 0;
    for (index, c) in text.char_indices() {
        if units == utf16 {
            return Some(index);
        }
        units += c.len_utf16();
        if units > utf16 {
            return None;
        }
    }
    (units == utf16).then_some(text.len())
}

fn prepare_and_scroll_wrapper(initial_scroll: f32) -> String {
    let ratio = initial_scroll.clamp(0.0, 1.0);
    format!(
        "(()=>{{let inner=null,prep=null;window.__PUPPYONE_INITIAL_SCROLL={ratio:.6};\
window.registerPrepare=fn=>{{prep=fn}};\
const scroller=()=>{{const f=document.querySelector('iframe.native-preview-frame');\
try{{const d=f?.contentDocument;if(d)return d.scrollingElement||d.documentElement||d.body}}catch{{}}\
return document.scrollingElement||document.documentElement}};\
const readRatio=()=>{{const el=scroller();if(!el)return 0;\
const max=Math.max(0,el.scrollHeight-el.clientHeight);\
return max>0?Math.min(1,Math.max(0,el.scrollTop/max)):0}};\
const applyRatio=r=>{{const el=scroller();if(!el)return;\
const max=Math.max(0,el.scrollHeight-el.clientHeight);\
el.scrollTop=max*Math.min(1,Math.max(0,r))}};\
Object.defineProperty(window,'__puppyoneHtmlVisual',{{configurable:true,\
get(){{return msg=>{{if(msg&&msg.type==='prepare'){{Promise.resolve().then(async()=>{{if(typeof prep==='function')await prep();\
const active=document.activeElement;if(active instanceof HTMLElement&&active!==document.body)active.blur();\
document.querySelector('.html-visual-editor')?.dispatchEvent(new KeyboardEvent('keydown',{{key:'Escape',bubbles:true,cancelable:true}}))}}).catch(()=>{{}}).finally(()=>{{window.ipc?.postMessage(JSON.stringify({{type:'scroll',ratio:readRatio()}}));\
window.ipc?.postMessage(JSON.stringify({{type:'prepared',request:msg.request}}))}});return}}\
if(msg&&msg.type==='setScroll'){{applyRatio(Number(msg.ratio)||0);return}}\
return inner?.(msg)}}}},set(fn){{inner=fn}}}});\
let applied=false;const bind=()=>{{const f=document.querySelector('iframe.native-preview-frame');\
if(!f||f.__poScrollBound)return;f.__poScrollBound=true;\
const attach=()=>{{try{{const w=f.contentWindow;if(!w)return;\
if(!applied&&window.__PUPPYONE_INITIAL_SCROLL>0){{applied=true;applyRatio(window.__PUPPYONE_INITIAL_SCROLL)}}\
w.addEventListener('scroll',()=>window.ipc?.postMessage(JSON.stringify({{type:'scroll',ratio:readRatio()}})),{{passive:true}})}}catch{{}}}};\
f.addEventListener('load',attach);attach()}};\
new MutationObserver(bind).observe(document.documentElement,{{childList:true,subtree:true}})}})()"
    )
}

/// The trusted entry page: the bundled surface, its styles under the
/// active Sub Theme's tokens, and the boot data.
fn page(params: &Params, generation: u64) -> String {
    let tokens: String = crate::theme::pack_tokens(params.dark)
        .iter()
        .filter(|(name, value)| {
            name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !value.contains(['<', '>', '{', '}', ';'])
        })
        .map(|(name, value)| format!("--po-{name}:{value};"))
        .collect();
    let locale = crate::localization::current_code();
    let boot = serde_json::json!({
        "text": params.text,
        "name": params.name,
        "fileUrl": local_url_for(&params.name),
        "canEdit": params.enabled,
        "canImport": params.folder.is_some(),
        "generation": generation,
        "locale": locale,
        "direction": "ltr",
        "messages": crate::localization::messages(&["editor.html.", "shared-ui."]),
    });
    let scheme = if params.dark { "dark" } else { "light" };
    let wrapper = prepare_and_scroll_wrapper(params.initial_scroll);
    format!(
        "<!doctype html><html lang=\"{lang}\" class=\"{class}\" data-initial-theme=\"{scheme}\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width\">\
<link rel=\"stylesheet\" href=\"__assets__/html-visual.css\">\
<style id=\"po-theme\">:root:root:root{{{tokens}}}</style><style>html,body,#root{{height:100%;margin:0}}body{{background:var(--po-canvas);color:var(--po-text);font-family:var(--po-font-ui)}}#root>.html-document-editor{{height:100%}}</style>\
</head><body><div id=\"root\"></div><script>{wrapper};window.__PUPPYONE_HTML_VISUAL={boot}</script>\
<script src=\"__assets__/html-visual.js\"></script></body></html>",
        lang = locale.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', ""),
        class = if params.dark { "dark" } else { "" },
        wrapper = wrapper,
        boot = script_json(&boot),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn change(from: usize, to: usize, insert: &str) -> Change {
        Change {
            from,
            to,
            insert: insert.into(),
        }
    }

    #[test]
    fn utf16_changes_apply_to_the_mirror_or_are_refused() {
        let text = "<p>é😀x</p>";
        assert_eq!(
            apply(text, &[change(3, 4, "e"), change(6, 7, "y")]).as_deref(),
            Some("<p>e😀y</p>")
        );
        assert_eq!(apply(text, &[change(5, 5, "!")]), None);
        assert_eq!(apply(text, &[change(11, 12, "")]), None);
        assert_eq!(apply(text, &[change(3, 6, ""), change(4, 7, "")]), None);
        assert_eq!(apply(text, &[change(4, 3, "")]), None);
        assert_eq!(apply(text, &[]).as_deref(), Some(text));
        assert_eq!(
            apply(text, &[change(11, 11, "!")]).as_deref(),
            Some("<p>é😀x</p>!")
        );
    }

    #[test]
    fn page_messages_are_typed_and_unknown_ones_are_ignored() {
        let edit: Inbound = serde_json::from_str(
            r#"{"type":"edit","generation":3,"edits":[{"from":1,"to":2,"insert":"a"}]}"#,
        )
        .unwrap();
        assert_eq!(
            edit,
            Inbound::Edit {
                generation: 3,
                edits: vec![change(1, 2, "a")]
            }
        );
        assert_eq!(
            serde_json::from_str::<Inbound>(r#"{"type":"history","direction":"redo"}"#).unwrap(),
            Inbound::History {
                direction: "redo".into()
            }
        );
        assert_eq!(
            serde_json::from_str::<Inbound>(r#"{"type":"prepared","request":9}"#).unwrap(),
            Inbound::Prepared { request: 9 }
        );
        assert_eq!(
            serde_json::from_str::<Inbound>(r#"{"type":"scroll","ratio":0.65}"#).unwrap(),
            Inbound::Scroll { ratio: 0.65 }
        );
        assert!(serde_json::from_str::<Inbound>(r#"{"type":"navigate","url":"x"}"#).is_err());
    }

    #[test]
    fn the_entry_page_boots_the_bundle_without_letting_text_close_its_script() {
        let params = Params {
            text: "<p>x</p></script><script>alert(1)</script>\u{2028}".into(),
            name: "Report one.html".into(),
            folder: Some(PathBuf::from("/tmp")),
            assets: None,
            dark: true,
            enabled: true,
            budget: 1,
            initial_scroll: 0.25,
        };
        let html = page(&params, 4);
        assert!(html.contains("<script src=\"__assets__/html-visual.js\"></script>"));
        assert!(html.contains("class=\"dark\" data-initial-theme=\"dark\""));
        assert_eq!(html.matches("</script>").count(), 2);
        assert!(!html.contains('\u{2028}'));
        let boot = html
            .split("window.__PUPPYONE_HTML_VISUAL=")
            .nth(1)
            .and_then(|rest| rest.split("</script>").next())
            .unwrap();
        let boot: serde_json::Value = serde_json::from_str(boot).unwrap();
        assert_eq!(boot["text"], params.text);
        assert_eq!(boot["fileUrl"], "puppyone-local://local/Report%20one.html");
        assert_eq!(boot["canImport"], true);
        assert_eq!(boot["generation"], 4);
        assert_eq!(boot["messages"]["editor.html.editBlock"], "Edit block");
        assert!(html.contains("--po-canvas:"));
        assert!(html.contains("registerPrepare"));
    }

    #[test]
    fn edit_mode_admits_html_documents_within_the_visual_budget() {
        assert!(admits("a.HTML", "<p>x</p>"));
        assert!(admits("a.htm", ""));
        assert!(!admits("a.xhtml", "<p>x</p>"));
        assert!(!admits("a.html", &"x".repeat(MAX_CHARS + 1)));
    }
}
