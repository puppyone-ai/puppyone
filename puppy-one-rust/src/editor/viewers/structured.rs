//! The product's structured document viewers (`PuppyFlowViewer`), bundled
//! from its sources by `tools/import-structured-viewers.mjs` and running in
//! the system web engine with their own `StructuredDocumentModel`.
//!
//! This side owns the document text the host saves: the page sends the
//! serialized document after every local edit, undo or redo; a disk reload
//! or external edit resets the page's model; the menu's Undo / Redo move the
//! model's history; read-only input disables it.
use super::{html_visual::script_json, web::WebFrame};
use crate::{
    editor::registry::{SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface},
    platform::webview::{Content, Entry, Ipc},
    typography::Scale,
};
use gpui::{prelude::*, *};
use serde::Deserialize;
use std::path::{Path, PathBuf};

const SCRIPT: &[u8] = include_bytes!("../../../assets/web/structured-viewers.js");
const STYLE: &[u8] = include_bytes!("../../../assets/web/structured-viewers.css");
/// The product's public agent marks (`assets/icons/agents/…` under the
/// bundle's `BASE_URL`).
const BRAND_PREFIX: &str = "public/assets/icons/agents/";

/// Messages the page posts.
#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Inbound {
    Ready,
    Content { text: String },
}

/// `puppyflow`: the PuppyFlow step editor.
pub fn open_puppyflow(
    request: &SurfaceRequest,
    _: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    let text = match request.input {
        SurfaceInput::Text(text) => text.to_owned(),
        _ => String::new(),
    };
    let root = request
        .workspace
        .as_ref()
        .and_then(|w| w.local_root().map(Path::to_path_buf));
    let view = cx.new(|cx| {
        let mut view = StructuredView {
            kind: "puppyflow",
            name: request.name.to_owned(),
            root,
            text,
            enabled: true,
            dark: request.dark,
            ready: false,
            frame: None,
            _inbox: None,
        };
        view.show(cx);
        view
    });
    Box::new(StructuredSurface { view })
}

/// The page reported a local edit.
pub struct Changed;

struct StructuredView {
    kind: &'static str,
    name: String,
    root: Option<PathBuf>,
    /// The document text, mirrored from the page's model.
    text: String,
    enabled: bool,
    dark: bool,
    /// The page answers messages (its receiver is installed).
    ready: bool,
    frame: Option<Entity<WebFrame>>,
    _inbox: Option<Task<()>>,
}
impl EventEmitter<Changed> for StructuredView {}

impl StructuredView {
    /// A new engine over the current text, input state and appearance.
    fn show(&mut self, cx: &mut Context<Self>) {
        let boot = serde_json::json!({
            "kind": self.kind,
            "text": self.text,
            "name": Path::new(&self.name).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(),
            "path": self.name,
            "canEdit": self.enabled,
            "workspaceRoot": self.root.as_ref().map(|r| r.to_string_lossy().into_owned()),
            "locale": crate::localization::current_code(),
            "direction": "ltr",
            "messages": crate::localization::messages(&[
                "editor.puppyflow.", "editor.contextMap.", "editor.preview.", "common.", "shared-ui.",
            ]),
        });
        let mut assets: Vec<(&'static str, &'static [u8])> = vec![
            ("structured-viewers.js", SCRIPT),
            ("structured-viewers.css", STYLE),
        ];
        assets.extend(brand_assets());
        let (tx, rx) = async_channel::unbounded::<String>();
        let content = Content {
            root: None,
            source: None,
            entry: Entry::Html(page(&boot, self.dark)),
            max_bytes: 0,
            assets,
            ipc: Some(Ipc(tx)),
            policy: None,
        };
        self.ready = false;
        self.frame = Some(cx.new(|_| WebFrame::new(Some(content), self.dark)));
        self._inbox = Some(cx.spawn(async move |this, cx| {
            while let Ok(body) = rx.recv().await {
                let Ok(message) = serde_json::from_str::<Inbound>(&body) else {
                    continue;
                };
                let _ = this.update(cx, |view, cx| view.receive(message, cx));
            }
        }));
        cx.notify();
    }
    fn receive(&mut self, message: Inbound, cx: &mut Context<Self>) {
        match message {
            Inbound::Ready => self.ready = true,
            Inbound::Content { text } => {
                if self.enabled && text != self.text {
                    self.text = text;
                    cx.emit(Changed);
                }
            }
        }
    }
    /// A message to the page's receiver; before it is ready the next page
    /// starts from the current state instead.
    fn post(&mut self, message: serde_json::Value, cx: &mut Context<Self>) {
        let script = format!(
            "window.__puppyoneStructured&&window.__puppyoneStructured({})",
            script_json(&message)
        );
        let sent = self.ready
            && self
                .frame
                .as_ref()
                .is_some_and(|frame| frame.read(cx).evaluate(&script));
        if !sent {
            self.show(cx);
        }
    }
    fn replace_text(&mut self, text: &str, cx: &mut Context<Self>) {
        if self.text == text {
            return;
        }
        self.text = text.to_owned();
        self.post(serde_json::json!({ "type": "reset", "text": text }), cx);
    }
    fn history(&mut self, redo: bool, cx: &mut Context<Self>) {
        if self.ready && self.enabled {
            let direction = if redo { "redo" } else { "undo" };
            self.post(
                serde_json::json!({ "type": "history", "direction": direction }),
                cx,
            );
        }
    }
    fn apply(&mut self, read_only: bool, dark: bool, cx: &mut Context<Self>) {
        let enabled = !read_only;
        if dark != self.dark {
            // The theme is part of the page: rebuild it on the current text.
            self.dark = dark;
            self.enabled = enabled;
            self.show(cx);
        } else if enabled != self.enabled {
            self.enabled = enabled;
            self.post(
                serde_json::json!({ "type": "enabled", "value": enabled }),
                cx,
            );
        }
    }
}

/// Every embedded agent mark under the bundle's public prefix.
fn brand_assets() -> Vec<(&'static str, &'static [u8])> {
    static SERVED: std::sync::OnceLock<Vec<(&'static str, &'static [u8])>> =
        std::sync::OnceLock::new();
    SERVED
        .get_or_init(|| {
            crate::assets::EMBEDDED
                .iter()
                .filter_map(|path| {
                    let name = path.strip_prefix("agents/")?;
                    let bytes = crate::assets::embedded(path)?;
                    // Named once for the process: the table outlives every page.
                    let served: &'static str =
                        Box::leak(format!("{BRAND_PREFIX}{name}").into_boxed_str());
                    Some((served, bytes))
                })
                .collect()
        })
        .clone()
}

/// The entry document: the product's tokens with the native theme's
/// colours over them, then the bundle.
fn page(boot: &serde_json::Value, dark: bool) -> String {
    let tokens: String = crate::theme::pack_tokens(dark)
        .iter()
        .filter(|(name, value)| {
            name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !value.contains(['<', '>', '{', '}', ';'])
        })
        .map(|(name, value)| format!("--po-{name}:{value};"))
        .collect();
    let locale = crate::localization::current_code();
    let scheme = if dark { "dark" } else { "light" };
    format!(
        "<!doctype html><html lang=\"{lang}\" class=\"{class}\" data-initial-theme=\"{scheme}\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width\">\
<link rel=\"stylesheet\" href=\"__assets__/structured-viewers.css\">\
<style>:root:root:root{{{tokens}}}html,body,#root{{height:100%;margin:0}}body{{background:var(--po-editor-bg,var(--po-canvas));color:var(--po-text);font-family:var(--po-font-ui)}}#root>.structured-document-host{{height:100%;display:flex;flex-direction:column}}</style>\
</head><body><div id=\"root\"></div><script>window.__PUPPYONE_STRUCTURED={boot}</script>\
<script src=\"__assets__/structured-viewers.js\"></script></body></html>",
        lang = locale.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', ""),
        class = if dark { "dark" } else { "" },
        boot = script_json(boot),
    )
}

struct StructuredSurface {
    view: Entity<StructuredView>,
}
impl ViewerSurface for StructuredSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        Some(cx.subscribe(&self.view, move |_, _: &Changed, cx| {
            events(SurfaceEvent::Changed, cx)
        }))
    }
    fn text(&self, cx: &App) -> Option<String> {
        Some(self.view.read(cx).text.clone())
    }
    fn replace_text(&self, text: &str, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| view.replace_text(text, cx));
    }
    fn rebind_name(&self, name: &str, cx: &mut App) {
        let name = name.to_owned();
        self.view.update(cx, |view, _| view.name = name);
    }
    fn undo(&self, redo: bool, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| view.history(redo, cx));
    }
    fn apply(&self, read_only: bool, dark: bool, _: Scale, _: &mut Window, cx: &mut App) {
        self.view
            .update(cx, |view, cx| view.apply(read_only, dark, cx));
    }
}

impl Render for StructuredView {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().children(self.frame.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_page_carries_the_document_and_serves_the_agent_marks() {
        let boot = serde_json::json!({ "text": "{\"title\":\"</script>\"}" });
        let html = page(&boot, true);
        assert!(html.contains(r#"class="dark" data-initial-theme="dark""#));
        assert!(!html.contains("\"</script>"));
        assert!(
            brand_assets()
                .iter()
                .any(|(name, _)| *name == "public/assets/icons/agents/claude-code.svg")
        );
        assert_eq!(
            serde_json::from_str::<Inbound>(r#"{"type":"content","text":"x"}"#).unwrap(),
            Inbound::Content { text: "x".into() }
        );
    }

    #[gpui::test]
    fn page_edits_become_the_document_text_and_read_only_refuses_them(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = StructuredView {
                kind: "puppyflow",
                name: "flows/release.puppyflow".into(),
                root: None,
                text: "{}".into(),
                enabled: true,
                dark: false,
                ready: true,
                frame: None,
                _inbox: None,
            };
            view.show(cx);
            view
        });
        let surface = StructuredSurface { view: view.clone() };
        let changed = std::rc::Rc::new(std::cell::Cell::new(0));
        let count = changed.clone();
        let _subscription = cx.update(|_, cx| {
            surface.subscribe(
                std::rc::Rc::new(move |event, _| {
                    if event == SurfaceEvent::Changed {
                        count.set(count.get() + 1);
                    }
                }),
                cx,
            )
        });
        view.update(cx, |v, cx| {
            v.receive(
                Inbound::Content {
                    text: "{\"title\":\"A\"}".into(),
                },
                cx,
            )
        });
        cx.run_until_parked();
        assert_eq!(changed.get(), 1);
        assert_eq!(
            cx.update(|_, cx| surface.text(cx)).as_deref(),
            Some("{\"title\":\"A\"}")
        );
        cx.update(|window, cx| surface.apply(true, false, Scale::default(), window, cx));
        view.update(cx, |v, cx| {
            v.receive(Inbound::Content { text: "x".into() }, cx)
        });
        cx.run_until_parked();
        assert_eq!(changed.get(), 1);
        // A disk reload is the new mirror; the page is reset to it.
        cx.update(|window, cx| surface.replace_text("{}", window, cx));
        assert_eq!(cx.update(|_, cx| surface.text(cx)).as_deref(), Some("{}"));
    }
}
