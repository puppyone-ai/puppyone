//! The HTML viewer's Edit mode: the product's `HtmlVisualSurface` (source
//! index, edit compiler, sanitized projection with the fixed frame bridge,
//! floating toolbar, block action rail and text input), bundled from the
//! product sources by `tools/import-html-visual.mjs` and run in the viewer's
//! WebView, its overlays drawn inside the page (D-2).
//!
//! The native code editor stays the only owner of the text, its undo
//! history and saves. The page keeps a mirror (the product's
//! `CodeMirrorDocumentModel`):
//! - each local visual edit arrives as UTF-16 changes against the mirror
//!   `generation` it was made on; it is checked against the mirror, applied
//!   to the code editor as one user change, and the mirror advances;
//! - undo and redo run the code editor's history;
//! - any other change of the text (Source mode, a disk reload, history)
//!   replaces the mirror as an external update under a new generation,
//!   which retires the visual session and rebuilds the projection exactly
//!   as the product does. Edits made on an older generation are dropped.
use super::web::WebFrame;
use crate::{
    editor::registry::ViewerSurface,
    platform::webview::{Content, Entry, Ipc, Source, import_image, local_url_for},
};
use gpui::{prelude::*, *};
use serde::Deserialize;
use std::{
    cell::RefCell,
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

/// What a session needs from its viewer.
pub struct Params {
    pub text: String,
    pub name: String,
    pub folder: Option<PathBuf>,
    pub assets: Option<Source>,
    pub dark: bool,
    pub enabled: bool,
    pub budget: u64,
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
    Import {
        request: String,
        name: String,
        data: String,
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
        on_unavailable: Unavailable,
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
        };
        #[cfg(not(test))]
        drop(tx);
        let frame = cx.new(|_| WebFrame::new(Some(content), params.dark));
        let task = {
            let state = state.clone();
            let frame_ref = frame.clone();
            frame.update(cx, |_, cx| {
                cx.spawn_in(window, async move |_, cx| {
                    while let Ok(body) = rx.recv().await {
                        let Ok(message) = serde_json::from_str::<Inbound>(&body) else {
                            continue;
                        };
                        let state = state.clone();
                        let frame = frame_ref.clone();
                        let source = source.clone();
                        let on_unavailable = on_unavailable.clone();
                        let folder = folder.clone();
                        let imported = cx.update(|window, cx| {
                            receive(message, &state, &frame, &*source, &on_unavailable, folder, window, cx)
                        });
                        if let Ok(Some((request, folder, name, bytes))) = imported {
                            let result = cx
                                .background_executor()
                                .spawn(async move { import_image(&folder, &name, &bytes).map(|_| name) })
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
            let enabled = {
                let mut s = state.borrow_mut();
                s.ready = true;
                s.enabled
            };
            post(
                frame,
                &serde_json::json!({"type": "enabled", "value": enabled}),
                cx,
            );
            // The text may have moved on while the page loaded.
            let text = source.text(cx).unwrap_or_default();
            sync(state, frame, &text, cx);
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
    // The code editor is not rendered in Edit mode: replay its history
    // directly rather than dispatching an action to it.
    source.command(if redo { "replay-redo" } else { "replay-undo" }, window, cx);
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
fn script_json(value: &serde_json::Value) -> String {
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
    format!(
        "<!doctype html><html lang=\"{lang}\" class=\"{class}\" data-initial-theme=\"{scheme}\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width\">\
<link rel=\"stylesheet\" href=\"__assets__/html-visual.css\">\
<style>:root:root:root{{{tokens}}}html,body,#root{{height:100%;margin:0}}body{{background:var(--po-canvas);color:var(--po-text);font-family:var(--po-font-ui)}}#root>.html-document-editor{{height:100%}}</style>\
</head><body><div id=\"root\"></div><script>window.__PUPPYONE_HTML_VISUAL={boot}</script>\
<script src=\"__assets__/html-visual.js\"></script></body></html>",
        lang = locale.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', ""),
        class = if params.dark { "dark" } else { "" },
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
        // "é" is one unit, "😀" two: offsets are the page's UTF-16 offsets.
        let text = "<p>é😀x</p>";
        assert_eq!(
            apply(text, &[change(3, 4, "e"), change(6, 7, "y")]).as_deref(),
            Some("<p>e😀y</p>")
        );
        // Inside a surrogate pair, past the end, overlapping or reversed.
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
    }

    #[test]
    fn edit_mode_admits_html_documents_within_the_visual_budget() {
        assert!(admits("a.HTML", "<p>x</p>"));
        assert!(admits("a.htm", ""));
        assert!(!admits("a.xhtml", "<p>x</p>"));
        assert!(!admits("a.html", &"x".repeat(MAX_CHARS + 1)));
    }
}
