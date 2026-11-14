//! The product's structured document viewers (`PuppyFlowViewer`,
//! `ContextMapViewer`), bundled from its sources by
//! `tools/import-structured-viewers.mjs` and running in the system web
//! engine with their own `StructuredDocumentModel`.
//!
//! This side owns the document text the host saves: the page sends the
//! serialized document after every local edit, undo or redo; a disk reload
//! or external edit resets the page's model; the menu's Undo / Redo move the
//! model's history; read-only input disables it.
//!
//! The Context Map reads the workspace through this side
//! (`contextMapEnvironment`: folder listings and Markdown sources, read off
//! the main thread) and its layout and line filters are the pane menu's
//! (`EditorPaneMenuContribution`).
use super::{html_visual::script_json, web::WebFrame};
use crate::{
    editor::{
        registry::{
            PaneEntries, SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface,
        },
        workbench::pane::{Item, ItemKind, Segment, Segmented},
    },
    platform::webview::{Content, Entry, Ipc},
    typography::Scale,
    workspace::Workspace,
};
use gpui::{prelude::*, *};
use serde::Deserialize;
use std::{path::Path, sync::Arc};

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
    Content {
        text: String,
    },
    /// `listChildren(path)`.
    List {
        request: u64,
        path: Option<String>,
    },
    /// `readFile(path)`.
    Read {
        request: u64,
        path: String,
    },
    /// The page's `EditorPaneMenuContribution`.
    Pane {
        items: Vec<PaneWire>,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum PaneWire {
    Segmented {
        id: String,
        label: String,
        value: String,
        options: Vec<OptionWire>,
    },
    Toggle {
        id: String,
        label: String,
        checked: bool,
    },
    Command {
        id: String,
        label: String,
        disabled: bool,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
struct OptionWire {
    id: String,
    label: String,
}

/// `puppyflow`: the PuppyFlow step editor.
pub fn open_puppyflow(
    request: &SurfaceRequest,
    _: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    open(request, "puppyflow", cx)
}
/// `context-map`: the workspace relationship map.
pub fn open_context_map(
    request: &SurfaceRequest,
    _: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    open(request, "context-map", cx)
}
fn open(request: &SurfaceRequest, kind: &'static str, cx: &mut App) -> Box<dyn ViewerSurface> {
    let text = match request.input {
        SurfaceInput::Text(text) => text.to_owned(),
        _ => String::new(),
    };
    let workspace = request.workspace.clone();
    let view = cx.new(|cx| {
        let mut view = StructuredView {
            kind,
            name: request.name.to_owned(),
            workspace,
            text,
            enabled: true,
            dark: request.dark,
            ready: false,
            pane: Vec::new(),
            revision: 0,
            _watch: None,
            frame: None,
            _inbox: None,
        };
        if kind == "context-map" {
            view.watch(cx);
        }
        view.show(cx);
        view
    });
    Box::new(StructuredSurface { view })
}

/// Product icons for the Context Map's layout options.
fn option_icon(id: &str) -> &'static str {
    match id {
        "radial" => "context-map-radial",
        "canvas" => "context-map-canvas",
        "layered" => "context-map-layered",
        _ => "circle",
    }
}
/// Pane ids are static in the native menu; the page's are few and fixed.
fn intern(id: &str) -> &'static str {
    static IDS: std::sync::Mutex<Vec<&'static str>> = std::sync::Mutex::new(Vec::new());
    let mut ids = IDS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(known) = ids.iter().find(|known| **known == id) {
        return known;
    }
    let leaked: &'static str = Box::leak(id.to_owned().into_boxed_str());
    ids.push(leaked);
    leaked
}
/// The page reported a local edit.
pub struct Changed;

struct StructuredView {
    kind: &'static str,
    name: String,
    workspace: Option<Arc<Workspace>>,
    /// The document text, mirrored from the page's model.
    text: String,
    enabled: bool,
    dark: bool,
    /// The page answers messages (its receiver is installed).
    ready: bool,
    /// The page's pane menu contribution.
    pane: Vec<PaneWire>,
    /// `contextMapEnvironment.revision`: workspace changes reread the map.
    revision: u64,
    _watch: Option<(crate::workspace::Subscription, Task<()>)>,
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
            "workspaceRoot": self.workspace.as_ref().and_then(|w| w.local_root()).map(|r| r.to_string_lossy().into_owned()),
            "hasWorkspace": self.workspace.is_some(),
            "locale": crate::localization::current_code(),
            "direction": "ltr",
            "messages": crate::localization::messages(&[
                "editor.puppyflow.", "workspace.relationships.", "editor.preview.", "common.", "shared-ui.",
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
            frames: None,
            disk_assets: None,
            locked: false,
        };
        self.ready = false;
        self.pane.clear();
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
            Inbound::List { request, path } => {
                let Some(workspace) = self.workspace.clone() else {
                    return self.reply(request, Err("The workspace is unavailable.".into()), cx);
                };
                let task = cx
                    .background_executor()
                    .spawn(async move { super::workspace_port::list(&workspace, path.as_deref()) });
                self.answer(request, task, cx);
            }
            Inbound::Read { request, path } => {
                let Some(workspace) = self.workspace.clone() else {
                    return self.reply(request, Err("The workspace is unavailable.".into()), cx);
                };
                let task = cx
                    .background_executor()
                    .spawn(async move { super::workspace_port::read(&workspace, &path) });
                self.answer(request, task, cx);
            }
            Inbound::Pane { items } => {
                self.pane = items;
                cx.notify();
            }
        }
    }
    /// External changes (Agents, terminals, other apps) bump the
    /// environment's revision; one per coalesced burst.
    fn watch(&mut self, cx: &mut Context<Self>) {
        let Some(workspace) = self.workspace.clone() else {
            return;
        };
        let (tx, rx) = async_channel::bounded::<()>(1);
        let notify: crate::workspace::ports::Notify = Arc::new(move || {
            let _ = tx.try_send(());
        });
        let Ok(subscription) = workspace.watch_root(notify) else {
            return;
        };
        let task = cx.spawn(async move |this, cx| {
            while rx.recv().await.is_ok() {
                let alive = this.update(cx, |view, cx| {
                    view.revision += 1;
                    let message = serde_json::json!({ "type": "revision", "value": view.revision });
                    // A page that is not ready yet reads the workspace anew.
                    if view.ready {
                        view.post(message, cx);
                    }
                });
                if alive.is_err() {
                    break;
                }
            }
        });
        self._watch = Some((subscription, task));
    }
    fn answer(
        &mut self,
        request: u64,
        task: Task<Result<serde_json::Value, String>>,
        cx: &mut Context<Self>,
    ) {
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |view, cx| view.reply(request, result, cx));
        })
        .detach();
    }
    /// A workspace read's answer; a page that was rebuilt meanwhile has
    /// already forgotten it.
    fn reply(
        &mut self,
        request: u64,
        result: Result<serde_json::Value, String>,
        cx: &mut Context<Self>,
    ) {
        let message = match result {
            Ok(value) => {
                serde_json::json!({ "type": "reply", "request": request, "ok": true, "value": value })
            }
            Err(error) => {
                serde_json::json!({ "type": "reply", "request": request, "ok": false, "error": error })
            }
        };
        let script = format!(
            "window.__puppyoneStructured&&window.__puppyoneStructured({})",
            script_json(&message)
        );
        if let Some(frame) = &self.frame {
            frame.read(cx).evaluate(&script);
        }
    }
    /// `EditorPaneMenuContribution` in the native pane menu.
    fn pane_entries(&self) -> PaneEntries {
        let mut entries = PaneEntries::default();
        for item in &self.pane {
            match item {
                PaneWire::Segmented {
                    label,
                    value,
                    options,
                    ..
                } => {
                    entries.segmented = Some(Segmented {
                        label: label.clone().into(),
                        options: options
                            .iter()
                            .map(|option| Segment {
                                id: intern(&option.id),
                                icon: option_icon(&option.id),
                                label: option.label.clone().into(),
                            })
                            .collect(),
                        value: intern(value),
                    });
                }
                PaneWire::Toggle { id, label, checked } => entries.items.push(Item {
                    id: intern(id),
                    label: label.clone().into(),
                    kind: ItemKind::Toggle(*checked),
                }),
                PaneWire::Command {
                    id,
                    label,
                    disabled,
                } => entries.items.push(Item {
                    id: intern(id),
                    label: label.clone().into(),
                    kind: ItemKind::Command {
                        disabled: *disabled,
                    },
                }),
            }
        }
        entries
    }
    /// A segment chosen in the pane menu; shown at once, then confirmed by
    /// the page's next contribution.
    fn pane_segment(&mut self, option: &str, cx: &mut Context<Self>) {
        let Some(PaneWire::Segmented { id, value, .. }) = self
            .pane
            .iter_mut()
            .find(|item| matches!(item, PaneWire::Segmented { .. }))
        else {
            return;
        };
        *value = option.to_owned();
        let message = serde_json::json!({ "type": "paneSegment", "id": id, "value": option });
        self.post(message, cx);
        cx.notify();
    }
    fn pane_item(&mut self, chosen: &str, cx: &mut Context<Self>) {
        let message = match self.pane.iter_mut().find(|item| match item {
            PaneWire::Toggle { id, .. } | PaneWire::Command { id, .. } => id == chosen,
            PaneWire::Segmented { .. } => false,
        }) {
            Some(PaneWire::Toggle { id, checked, .. }) => {
                *checked = !*checked;
                serde_json::json!({ "type": "paneToggle", "id": id, "checked": *checked })
            }
            Some(PaneWire::Command {
                id,
                disabled: false,
                ..
            }) => {
                serde_json::json!({ "type": "paneCommand", "id": id })
            }
            _ => return,
        };
        self.post(message, cx);
        cx.notify();
    }
    /// A message to the page's receiver; `false` before it is ready.
    fn post(&mut self, message: serde_json::Value, cx: &mut Context<Self>) -> bool {
        let script = format!(
            "window.__puppyoneStructured&&window.__puppyoneStructured({})",
            script_json(&message)
        );
        self.ready
            && self
                .frame
                .as_ref()
                .is_some_and(|frame| frame.read(cx).evaluate(&script))
    }
    /// State the page must hold: a page that cannot take it yet is rebuilt
    /// from the current state instead.
    fn post_state(&mut self, message: serde_json::Value, cx: &mut Context<Self>) {
        if !self.post(message, cx) {
            self.show(cx);
        }
    }
    fn replace_text(&mut self, text: &str, cx: &mut Context<Self>) {
        if self.text == text {
            return;
        }
        self.text = text.to_owned();
        self.post_state(serde_json::json!({ "type": "reset", "text": text }), cx);
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
            self.post_state(
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
    fn pane(&self, cx: &App) -> PaneEntries {
        self.view.read(cx).pane_entries()
    }
    fn pane_segment(&self, id: &'static str, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| view.pane_segment(id, cx));
    }
    fn pane_item(&self, id: &'static str, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| view.pane_item(id, cx));
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
                workspace: None,
                text: "{}".into(),
                enabled: true,
                dark: false,
                ready: true,
                pane: Vec::new(),
                revision: 0,
                _watch: None,
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

    #[gpui::test]
    fn the_context_map_lists_the_workspace_and_drives_the_pane_menu(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("notes")).unwrap();
        std::fs::write(dir.path().join("plan.md"), "# Plan").unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let nodes = workspace.list(Path::new("")).unwrap();
        let mut listed: Vec<_> = nodes
            .iter()
            .map(|n| super::super::workspace_port::data_node(&workspace, n))
            .collect();
        listed.sort_by_key(|n| n["path"].as_str().unwrap_or_default().to_owned());
        assert_eq!(listed[0]["type"], "folder");
        assert_eq!(listed[1]["type"], "markdown");
        assert_eq!(listed[1]["source"], "local");
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = StructuredView {
                kind: "context-map",
                name: "overview.contextmap".into(),
                workspace: Some(workspace.clone()),
                text: "{}".into(),
                enabled: true,
                dark: false,
                ready: true,
                pane: Vec::new(),
                revision: 0,
                _watch: None,
                frame: None,
                _inbox: None,
            };
            view.show(cx);
            view
        });
        let items: Vec<PaneWire> = serde_json::from_str(
            r#"[{"kind":"segmented","id":"context-map-layout","label":"Layout","value":"radial",
                 "options":[{"id":"radial","label":"Radial"},{"id":"canvas","label":"Canvas"}]},
                {"kind":"toggle","id":"context-map-filter-one-way-links","label":"One-way","checked":true}]"#,
        )
        .unwrap();
        view.update(cx, |v, cx| {
            v.ready = true;
            v.receive(Inbound::Pane { items }, cx);
            let entries = v.pane_entries();
            let segmented = entries.segmented.unwrap();
            assert_eq!(segmented.value, "radial");
            assert_eq!(segmented.options[1].icon, "context-map-canvas");
            assert_eq!(entries.items[0].kind, ItemKind::Toggle(true));
            // Chosen in the menu, shown at once.
            v.pane_segment("canvas", cx);
            v.pane_item("context-map-filter-one-way-links", cx);
            let entries = v.pane_entries();
            assert_eq!(entries.segmented.unwrap().value, "canvas");
            assert_eq!(entries.items[0].kind, ItemKind::Toggle(false));
        });
    }
}
