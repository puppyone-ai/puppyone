//! The pages documents are edited and previewed in, in an actual WKWebView
//! over the production Wry IPC and host protocol. For the bundled Context Map
//! and PuppyFlow viewers: what the page shows after a reset, what it reports
//! for a local edit, its generation tags, undo and redo, read-only input and
//! a page that leaves the screen and comes back. For the HTML preview: the
//! document Interact shows, before and after storage replaced it. DOM edits
//! use the same element events as the product's matrix fixtures.
use super::{
    probe::{eval, tick, wait},
    whiteboard_probe::NativeWindow,
};
use crate::platform::webview::Ipc;
use objc2::MainThreadMarker;
use serde_json::{Value, json};
use wry::WebViewExtMacOS;

const MARKERS: [&str; 3] = ["alpha", "agent", "human"];

#[derive(Clone, Copy)]
enum Kind {
    ContextMap,
    PuppyFlow,
}
impl Kind {
    fn id(self) -> &'static str {
        match self {
            Self::ContextMap => "context-map",
            Self::PuppyFlow => "puppyflow",
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::ContextMap => "matrix-map.contextmap",
            Self::PuppyFlow => "matrix-workflow.puppyflow",
        }
    }
    /// The product matrix's documents (`contextMapContent`, `puppyFlowContent`).
    fn text(self, marker: &str) -> String {
        let value = match self {
            Self::ContextMap => json!({
                "version": 1, "scope": ".", "layout": {"expanded": [marker], "offsets": {}},
            }),
            Self::PuppyFlow => json!({
                "kind": "puppyflow", "version": 1, "title": "Matrix", "description": "",
                "steps": [{"id": "step_matrix", "agent": "codex", "prompt": marker, "enabled": true}],
            }),
        };
        format!("{}\n", serde_json::to_string_pretty(&value).unwrap())
    }
    /// What the page shows (`readContextMapMarker`, `readPuppyFlowMarker`).
    fn marker_script(self) -> &'static str {
        match self {
            Self::ContextMap => {
                "(()=>{const e=document.querySelector('.folder-relationship-group[data-node-path]')??document.querySelector('.folder-relationship-card[data-node-path][data-expanded=\"true\"]');return e?e.dataset.nodePath:'none'})()"
            }
            Self::PuppyFlow => {
                "(()=>{const e=document.querySelector('.puppyflow-prompt-cell textarea');return e?e.value:'none'})()"
            }
        }
    }
    /// A person's edit to `human` (`applyLocalEdit`).
    fn edit_script(self) -> &'static str {
        match self {
            Self::ContextMap => {
                "(()=>{const c=document.querySelector('.folder-relationship-group:is([data-node-path=\"alpha\"],[data-node-path=\"agent\"]) .folder-relationship-collapse')??document.querySelector('button.folder-relationship-card:is([data-node-path=\"alpha\"],[data-node-path=\"agent\"])[data-expanded=\"true\"]');const x=document.querySelector('button.folder-relationship-card[data-node-path=\"human\"]');if(!c||!x)return 'missing';c.click();x.click();return 'edited'})()"
            }
            Self::PuppyFlow => {
                "(()=>{const t=document.querySelector('.puppyflow-prompt-cell textarea');if(!t)return 'missing';Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'human');t.dispatchEvent(new Event('input',{bubbles:true}));return 'edited'})()"
            }
        }
    }
    /// The marker a reported document carries: the expanded folder, or the
    /// step's prompt (`"agent"` is also a step field name).
    fn marker_of(self, text: &str) -> Option<&'static str> {
        let document: Value = serde_json::from_str(text).ok()?;
        let value = match self {
            Self::ContextMap => &document["layout"]["expanded"][0],
            Self::PuppyFlow => &document["steps"][0]["prompt"],
        };
        MARKERS.into_iter().find(|marker| value == marker)
    }
    /// Model steps one person's edit takes (the Context Map collapses, then expands).
    fn steps(self) -> usize {
        match self {
            Self::ContextMap => 2,
            Self::PuppyFlow => 1,
        }
    }
}

struct Fixture {
    kind: Kind,
    host: super::super::WebHost,
    _window: NativeWindow,
    received: async_channel::Receiver<String>,
    messages: Vec<Value>,
}
impl Fixture {
    fn new(kind: Kind, marker: &str) -> Self {
        let window = NativeWindow::new();
        let (tx, received) = async_channel::unbounded();
        let content = crate::editor::viewers::structured::probe_content(
            kind.id(),
            kind.name(),
            &kind.text(marker),
            Ipc(tx),
        );
        let host = super::super::WebHost::new_child(&window, 0, content, false).unwrap();
        host.native()
            .view
            .set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0., 0.).into(),
                size: wry::dpi::LogicalSize::new(1100., 800.).into(),
            })
            .unwrap();
        host.native().view.set_visible(true).unwrap();
        let mut fixture = Self {
            kind,
            host,
            _window: window,
            received,
            messages: Vec::new(),
        };
        fixture.until("the page reports ready over the real IPC", |f| {
            f.drain();
            f.messages
                .iter()
                .any(|m| m["type"] == "ready" && m["generation"] == 1)
        });
        fixture.js("window.__errors=[]; window.addEventListener('error',e=>__errors.push(e.message)); window.addEventListener('unhandledrejection',e=>__errors.push(String(e.reason))); 'observing'");
        fixture.until_shown(marker);
        fixture
    }
    fn js(&self, source: &str) -> String {
        eval(&self.host.native().view.webview(), source)
    }
    fn until(&mut self, label: &str, mut predicate: impl FnMut(&mut Self) -> bool) {
        wait(label, || predicate(self));
    }
    /// Takes the page's messages; answers its workspace reads as the product
    /// matrix's `listChildren` does: three folders named after the markers.
    fn drain(&mut self) {
        while let Ok(body) = self.received.try_recv() {
            let message: Value = serde_json::from_str(&body).expect("typed structured IPC");
            match message["type"].as_str() {
                Some("list") => {
                    let value = if message["path"].is_null() {
                        MARKERS
                            .iter()
                            .map(|m| json!({"id": m, "name": m, "path": m, "source": "local", "type": "folder"}))
                            .collect()
                    } else {
                        Vec::new()
                    };
                    self.command(json!({"type": "reply", "request": message["request"], "ok": true, "value": value}));
                }
                Some("read") => self.command(json!({"type": "reply", "request": message["request"], "ok": false, "error": "not a document"})),
                _ => self.messages.push(message),
            }
        }
    }
    fn command(&self, message: Value) {
        self.js(&format!(
            "window.__puppyoneStructured&&window.__puppyoneStructured({message}); 'sent'"
        ));
    }
    fn shown(&self) -> String {
        self.js(self.kind.marker_script())
    }
    fn until_shown(&mut self, marker: &str) {
        let label = format!("the page shows {marker}");
        self.until(&label, |f| {
            f.drain();
            f.shown() == marker
        });
    }
    fn settle(&mut self) {
        for _ in 0..3 {
            self.js("window.__settled=false; requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__settled=true})); 'waiting'");
            self.until("two painted frames", |f| f.js("window.__settled") == "1");
            for _ in 0..10 {
                tick();
            }
            self.drain();
        }
        assert_eq!(
            self.js("JSON.stringify(window.__errors)"),
            "[]",
            "page errors"
        );
    }
    fn edits(&self) -> Vec<&Value> {
        self.messages
            .iter()
            .filter(|m| m["type"] == "content")
            .collect()
    }
    /// The last reported document, which must be tagged with `generation`.
    fn last_edit(&self, generation: u64) -> &'static str {
        let edits = self.edits();
        let last = edits.last().expect("the page reported an edit");
        assert!(
            edits.iter().all(|m| m["generation"] == generation),
            "edits under an old generation: {edits:?}"
        );
        self.kind
            .marker_of(last["text"].as_str().unwrap())
            .expect("a matrix document")
    }
    fn reset(&mut self, marker: &str, generation: u64) {
        self.messages.clear();
        self.command(
            json!({"type": "reset", "text": self.kind.text(marker), "generation": generation}),
        );
        self.until_shown(marker);
        self.settle();
        assert!(self.edits().is_empty(), "a reset was reported as an edit");
    }
    fn edit(&mut self, generation: u64) {
        self.messages.clear();
        assert_eq!(self.js(self.kind.edit_script()), "edited");
        self.until("the edit reaches the host", |f| {
            f.drain();
            f.edits().last().is_some_and(|m| {
                m["text"]
                    .as_str()
                    .and_then(|t| f.kind.marker_of(t))
                    .is_some_and(|marker| marker == "human")
            })
        });
        self.settle();
        assert_eq!(self.shown(), "human");
        assert_eq!(self.last_edit(generation), "human");
    }
    fn history(&mut self, direction: &str, expected: &str, generation: u64) {
        self.messages.clear();
        for _ in 0..self.kind.steps() {
            self.command(json!({"type": "history", "direction": direction}));
            self.settle();
        }
        self.until_shown(expected);
        self.settle();
        assert_eq!(self.last_edit(generation), expected, "{direction} report");
    }
}

fn run_kind(kind: Kind) -> Value {
    // Opening reports nothing: the document is the host's as it was read.
    let mut page = Fixture::new(kind, "alpha");
    page.settle();
    assert!(page.edits().is_empty(), "opening rewrote the document");
    // A clean storage update reaches the page without an edit report.
    page.reset("agent", 2);
    // A person's edit is reported under the generation the page took.
    page.edit(2);
    // Storage wins over the unsaved edit, shown without a write request.
    page.reset("agent", 3);
    // The next edit is made against, and tagged with, the adopted text.
    page.edit(3);
    // Undo and redo move the page model and are reported as its text.
    page.history("undo", "agent", 3);
    page.history("redo", "human", 3);
    // A page that leaves the screen and comes back keeps its model history.
    page.host.native().view.set_visible(false).unwrap();
    // A hidden page paints nothing; it only has to stay a while.
    for _ in 0..100 {
        tick();
    }
    assert_eq!(page.js("document.visibilityState"), "hidden");
    page.host.native().view.set_visible(true).unwrap();
    page.until("the page is visible again", |f| {
        f.js("document.visibilityState") == "visible"
    });
    page.settle();
    page.history("undo", "agent", 3);
    page.history("redo", "human", 3);
    // Read-only input takes no edits and reports none.
    page.command(json!({"type": "enabled", "value": false}));
    page.settle();
    page.messages.clear();
    page.js(kind.edit_script());
    page.command(json!({"type": "history", "direction": "undo"}));
    page.settle();
    assert!(page.edits().is_empty(), "read-only page reported an edit");
    page.command(json!({"type": "enabled", "value": true}));
    page.settle();
    // A reset replaces the model's history with its text: undo has nothing.
    page.reset("alpha", 4);
    page.messages.clear();
    page.command(json!({"type": "history", "direction": "undo"}));
    page.settle();
    assert!(
        page.edits().is_empty(),
        "undo resurrected text from before the reset"
    );
    assert_eq!(page.shown(), "alpha");
    drop(page);
    // A page created again for the same document shows its current text.
    let mut again = Fixture::new(kind, "agent");
    again.settle();
    assert!(again.edits().is_empty());
    json!({"cleanReset": true, "editGeneration": true, "dirtyReset": true, "editAfterAdoption": true,
        "undoRedo": true, "hiddenAndShown": true, "readOnly": true, "resetClearsHistory": true, "recreated": true})
}

/// The preview Interact loads for a lone document (`html_interact::show`):
/// a replaced document is a new page load, as `Interact::refresh` makes it.
fn run_html_preview() -> Value {
    let heading = |marker: &str| {
        let window = NativeWindow::new();
        let (tx, received) = async_channel::unbounded::<String>();
        let text = format!("<!doctype html><h1>{marker}</h1>");
        let content = crate::editor::viewers::html_interact::probe_content(&text, Ipc(tx));
        let host = super::super::WebHost::new_child(&window, 0, content, false).unwrap();
        host.native()
            .view
            .set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0., 0.).into(),
                size: wry::dpi::LogicalSize::new(1100., 800.).into(),
            })
            .unwrap();
        host.native().view.set_visible(true).unwrap();
        let view = host.native().view.webview();
        let shown = |script: &str| eval(&view, script);
        wait("the preview shows the document", || {
            shown("document.querySelector('h1')?.textContent ?? 'none'") == marker
        });
        assert_eq!(
            shown("!!document.getElementById('puppyone-html-preview-interaction')"),
            "1",
            "the preview lost its interaction stylesheet"
        );
        while let Ok(body) = received.try_recv() {
            let message: Value = serde_json::from_str(&body).unwrap();
            assert_ne!(message["type"], "link", "loading followed a link");
        }
        drop(view);
        drop(host);
        drop(window);
    };
    heading("alpha");
    heading("agent");
    json!({"shows": true, "replaced": true})
}

pub(super) fn run() {
    let _mtm = MainThreadMarker::new().expect("main-thread document pages probe");
    let context_map = run_kind(Kind::ContextMap);
    let puppyflow = run_kind(Kind::PuppyFlow);
    let html_preview = run_html_preview();
    println!(
        "{}",
        json!({"passed": true, "contextMap": context_map, "puppyflow": puppyflow, "htmlPreview": html_preview})
    );
}
