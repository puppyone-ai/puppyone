//! Real Windows WebView2 integration fixtures (`dev-capture` only, never part
//! of the packaged app). Exercises the production `WebHost`, custom protocol
//! handlers (`puppyone-preview` / `puppyone-local`), Range/HEAD semantics, Wry
//! IPC, bundled Context Map & PuppyFlow viewers, and HTML preview inside an
//! offscreen Win32 HWND.
use crate::platform::{
    viewer_packs,
    webview::{Content, Entry, Ipc, ResourceSource, ResourceStream, Source},
    window::probe_window::NativeWindow,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

fn tick() {
    NativeWindow::tick();
}

fn wait(label: &str, mut condition: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(30);
    while !condition() {
        assert!(
            Instant::now() < until,
            "Windows WebView2 probe timed out: {label}"
        );
        tick();
    }
}

/// Evaluates `script` in WebView2 and normalizes the JSON-serialized result to
/// match the macOS probe (`true` -> `"1"`, `false` -> `"0"`, strings unquoted).
fn eval(view: &wry::WebView, script: &str) -> String {
    let slot: Arc<Mutex<Option<String>>> = Arc::default();
    let capture = slot.clone();
    view.evaluate_script_with_callback(script, move |raw| {
        *capture.lock().unwrap() = Some(raw);
    })
    .expect("WebView2 evaluate_script_with_callback");
    wait("WebView2 JavaScript completion", || {
        slot.lock().unwrap().is_some()
    });
    let raw = slot.lock().unwrap().take().unwrap();
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Bool(true)) => "1".into(),
        Ok(Value::Bool(false)) => "0".into(),
        Ok(Value::String(s)) => s,
        Ok(Value::Null) => "null".into(),
        Ok(other) => other.to_string(),
        Err(_) => raw,
    }
}

#[derive(Default)]
struct Counts {
    bytes: usize,
}

struct RangeProvider {
    counts: Mutex<HashMap<String, Counts>>,
    live: AtomicBool,
}

impl RangeProvider {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            counts: Mutex::default(),
            live: AtomicBool::new(true),
        })
    }
}

struct SyntheticReader {
    provider: Arc<RangeProvider>,
    name: String,
    length: u64,
    offset: u64,
}

impl Read for SyntheticReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let n = self
            .length
            .saturating_sub(self.offset)
            .min(buffer.len() as u64) as usize;
        for (i, b) in buffer[..n].iter_mut().enumerate() {
            *b = ((self.offset + i as u64) % 251) as u8;
        }
        self.offset += n as u64;
        self.provider
            .counts
            .lock()
            .unwrap()
            .entry(self.name.clone())
            .or_default()
            .bytes += n;
        Ok(n)
    }
}

impl Seek for SyntheticReader {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        self.offset = match from {
            SeekFrom::Start(n) => n,
            _ => return Err(io::ErrorKind::Unsupported.into()),
        };
        Ok(self.offset)
    }
}

struct ProviderSource(Arc<RangeProvider>);
impl ResourceSource for ProviderSource {
    fn is_live(&self) -> bool {
        self.0.live.load(Ordering::Acquire)
    }
    fn read(&self, _: &Path) -> Option<Vec<u8>> {
        None
    }
    fn open(&self, relative: &Path) -> io::Result<Option<ResourceStream>> {
        let name = relative.to_str().ok_or(io::ErrorKind::NotFound)?;
        let length = match name {
            "range" => 2 * 1024 * 1024 * 1024,
            _ => return Err(io::ErrorKind::NotFound.into()),
        };
        Ok(Some(ResourceStream {
            length,
            reader: Box::new(SyntheticReader {
                provider: self.0.clone(),
                name: name.into(),
                length,
                offset: 0,
            }),
        }))
    }
}

/// Exercises real WebView2 custom protocol loading, byte-range `206` responses,
/// `HEAD` metadata, `416` unsatisfiable ranges, CORS/origin checks, and Wry IPC.
pub(super) fn run_probe() {
    let window = NativeWindow::new();
    let provider = RangeProvider::new();
    let (ipc_tx, ipc_rx) = async_channel::unbounded::<String>();
    let content = Content {
        root: None,
        source: Some(Source(Arc::new(ProviderSource(provider.clone())))),
        entry: Entry::Html(
            "<!doctype html><html><body>webview2 stream fixture</body></html>".into(),
        ),
        max_bytes: 2 * 1024 * 1024 * 1024,
        assets: vec![],
        ipc: Some(Ipc(ipc_tx)),
        policy: Some("default-src 'none'; connect-src puppyone-local:; script-src 'unsafe-inline'"),
        frames: None,
        disk_assets: None,
        locked: true,
    };
    let host = crate::web_host::WebHost::new_child(&window, 0, content, false)
        .expect("WebView2 child host");
    host.native()
        .view
        .set_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0., 0.).into(),
            size: wry::dpi::LogicalSize::new(640., 480.).into(),
        })
        .unwrap();
    host.native().view.set_visible(true).unwrap();

    wait("WebView2 entry load", || {
        eval(
            &host.native().view,
            "document.readyState === 'complete' && location.hostname === 'puppyone-preview.local'",
        ) == "1"
    });

    eval(
        &host.native().view,
        r#"window.result = {};
        (async () => { try {
          const range = await fetch('puppyone-local://local/range', {headers: {Range: 'bytes=123-126'}});
          const bytes = Array.from(new Uint8Array(await range.arrayBuffer()));
          result.range = range.status === 206 && bytes.join(',') === '123,124,125,126'
            && range.headers.get('Content-Range') === 'bytes 123-126/2147483648'
            && range.headers.get('Cache-Control') === 'no-store';
          const head = await fetch('puppyone-local://local/range', {method: 'HEAD', headers: {Range: 'bytes=1-2'}});
          result.head = head.status === 200 && head.headers.get('Content-Length') === '2147483648'
            && (await head.arrayBuffer()).byteLength === 0;
          const invalid = await fetch('puppyone-local://local/range', {headers: {Range: 'bytes=2147483648-'}});
          result.unsatisfiable = invalid.status === 416;
          window.ipc.postMessage(JSON.stringify({type: 'ping', value: 42}));
          result.done = true;
        } catch (e) { result.error = String(e); } })(); 'started'"#,
    );

    wait("WebView2 range, HEAD, 416, and IPC assertions", || {
        let result = eval(&host.native().view, "JSON.stringify(window.result)");
        assert!(!result.contains("\"error\""), "JS error: {result}");
        result.contains("\"done\":true")
    });
    let result: Value =
        serde_json::from_str(&eval(&host.native().view, "JSON.stringify(window.result)")).unwrap();
    for name in ["range", "head", "unsatisfiable"] {
        assert_eq!(result[name], true, "WebView2 probe failed {name}: {result}");
    }
    assert_eq!(provider.counts.lock().unwrap()["range"].bytes, 4);

    let mut got_ipc = false;
    wait("WebView2 IPC roundtrip", || {
        if let Ok(msg) = ipc_rx.try_recv() {
            let parsed: Value = serde_json::from_str(&msg).unwrap();
            assert_eq!(parsed["type"], "ping");
            assert_eq!(parsed["value"], 42);
            got_ipc = true;
        }
        got_ipc
    });

    drop(host);
    drop(window);
    println!(
        "{}",
        json!({
            "passed": true,
            "engine": "webview2",
            "ephemeral": true,
            "range": true,
            "head": true,
            "unsatisfiable": true,
            "ipc": true
        })
    );
}

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
    fn marker_of(self, text: &str) -> Option<&'static str> {
        let document: Value = serde_json::from_str(text).ok()?;
        let value = match self {
            Self::ContextMap => &document["layout"]["expanded"][0],
            Self::PuppyFlow => &document["steps"][0]["prompt"],
        };
        MARKERS.into_iter().find(|marker| value == marker)
    }
    fn steps(self) -> usize {
        match self {
            Self::ContextMap => 2,
            Self::PuppyFlow => 1,
        }
    }
}

struct DocumentFixture {
    kind: Kind,
    host: crate::web_host::WebHost,
    _window: NativeWindow,
    received: async_channel::Receiver<String>,
    messages: Vec<Value>,
}

impl DocumentFixture {
    fn new(kind: Kind, marker: &str) -> Self {
        let window = NativeWindow::new();
        let (tx, received) = async_channel::unbounded();
        let content = crate::editor::viewers::structured::probe_content(
            kind.id(),
            kind.name(),
            &kind.text(marker),
            Ipc(tx),
        );
        let host = crate::web_host::WebHost::new_child(&window, 0, content, false).unwrap();
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
        fixture.until("WebView2 page reports ready over real IPC", |f| {
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
        eval(&self.host.native().view, source)
    }
    fn until(&mut self, label: &str, mut predicate: impl FnMut(&mut Self) -> bool) {
        wait(label, || predicate(self));
    }
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
        let label = format!("WebView2 page shows {marker}");
        self.until(&label, |f| {
            f.drain();
            f.shown() == marker
        });
    }
    fn settle(&mut self) {
        for _ in 0..2 {
            self.js("window.__settled=false; requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__settled=true})); 'waiting'");
            self.until("two painted frames", |f| f.js("window.__settled") == "1");
            for _ in 0..5 {
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
    let mut page = DocumentFixture::new(kind, "alpha");
    page.settle();
    assert!(page.edits().is_empty(), "opening rewrote the document");
    page.reset("agent", 2);
    page.edit(2);
    page.reset("agent", 3);
    page.edit(3);
    page.history("undo", "agent", 3);
    page.history("redo", "human", 3);
    page.host.native().view.set_visible(false).unwrap();
    for _ in 0..20 {
        tick();
    }
    page.host.native().view.set_visible(true).unwrap();
    page.settle();
    page.history("undo", "agent", 3);
    page.history("redo", "human", 3);
    page.command(json!({"type": "enabled", "value": false}));
    page.settle();
    page.messages.clear();
    page.js(kind.edit_script());
    page.command(json!({"type": "history", "direction": "undo"}));
    page.settle();
    assert!(page.edits().is_empty(), "read-only page reported an edit");
    page.command(json!({"type": "enabled", "value": true}));
    page.settle();
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
    let mut again = DocumentFixture::new(kind, "agent");
    again.settle();
    assert!(again.edits().is_empty());
    json!({
        "cleanReset": true,
        "editGeneration": true,
        "dirtyReset": true,
        "editAfterAdoption": true,
        "undoRedo": true,
        "hiddenAndShown": true,
        "readOnly": true,
        "resetClearsHistory": true,
        "recreated": true
    })
}

fn run_html_preview() -> Value {
    let heading = |marker: &str| {
        let window = NativeWindow::new();
        let (tx, received) = async_channel::unbounded::<String>();
        let text = format!("<!doctype html><h1>{marker}</h1>");
        let content = crate::editor::viewers::html_interact::probe_content(&text, Ipc(tx));
        let host = crate::web_host::WebHost::new_child(&window, 0, content, false).unwrap();
        host.native()
            .view
            .set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0., 0.).into(),
                size: wry::dpi::LogicalSize::new(1100., 800.).into(),
            })
            .unwrap();
        host.native().view.set_visible(true).unwrap();
        wait("WebView2 HTML preview shows document", || {
            eval(
                &host.native().view,
                "document.querySelector('h1')?.textContent ?? 'none'",
            ) == marker
        });
        assert_eq!(
            eval(
                &host.native().view,
                "!!document.getElementById('puppyone-html-preview-interaction')"
            ),
            "1",
            "the HTML preview lost its interaction stylesheet"
        );
        while let Ok(body) = received.try_recv() {
            let message: Value = serde_json::from_str(&body).unwrap();
            assert_ne!(message["type"], "link", "loading followed a link");
        }
        drop(host);
        drop(window);
    };
    heading("alpha");
    heading("agent");
    json!({"shows": true, "replaced": true})
}

pub(super) fn run_document_pages_probe() {
    let context_map = run_kind(Kind::ContextMap);
    let puppyflow = run_kind(Kind::PuppyFlow);
    let html_preview = run_html_preview();
    println!(
        "{}",
        json!({
            "passed": true,
            "engine": "webview2",
            "contextMap": context_map,
            "puppyflow": puppyflow,
            "htmlPreview": html_preview
        })
    );
}

pub(super) fn run_whiteboard_probe(root: &Path) {
    let window = NativeWindow::new();
    let pack = viewer_packs::load_excalidraw_from(root).expect("verified installed SDK");
    let blank = "{\n  \"type\": \"excalidraw\", \"version\": 2, \"elements\": [], \"appState\": {}, \"files\": {}\n}\n";
    let (tx, received) = async_channel::unbounded::<String>();
    let content = crate::editor::viewers::whiteboard::probe_content(pack, blank.into(), Ipc(tx));
    let host = crate::web_host::WebHost::new_child(&window, 0, content, false).unwrap();
    host.native()
        .view
        .set_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0., 0.).into(),
            size: wry::dpi::LogicalSize::new(1100., 800.).into(),
        })
        .unwrap();
    host.native().view.set_visible(true).unwrap();

    let mut messages = Vec::<Value>::new();
    wait("WebView2 Excalidraw SDK mounted", || {
        while let Ok(body) = received.try_recv() {
            messages.push(serde_json::from_str(&body).unwrap());
        }
        messages
            .iter()
            .any(|m| m["type"] == "ready" && m["generation"] == 1)
            && eval(
                &host.native().view,
                "!!document.querySelector('.excalidraw canvas')",
            ) == "1"
    });
    for (dark, expected) in [(true, "1"), (false, "0")] {
        let cmd = json!({"type":"theme", "dark":dark, "css":format!("html {{color-scheme:{}}}", if dark {"dark"} else {"light"})});
        eval(
            &host.native().view,
            &format!("window.__puppyoneWhiteboard({cmd}); 'sent'"),
        );
        wait("WebView2 whiteboard theme toggle", || {
            eval(
                &host.native().view,
                "document.querySelector('.excalidraw').classList.contains('theme--dark')",
            ) == expected
        });
    }
    for (width, mobile) in [(440., true), (1100., false)] {
        window.resize(width as i32, 800);
        host.native()
            .view
            .set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0., 0.).into(),
                size: wry::dpi::LogicalSize::new(width, 800.).into(),
            })
            .unwrap();
        wait("WebView2 whiteboard resize", || {
            eval(
                &host.native().view,
                &format!(
                    "document.querySelector('.excalidraw').classList.contains('excalidraw--mobile') === {mobile}"
                ),
            ) == "1"
        });
    }
    let invalid_cmd = json!({"type":"reset", "text":"{broken", "generation":2});
    eval(
        &host.native().view,
        &format!("window.__puppyoneWhiteboard({invalid_cmd}); 'sent'"),
    );
    wait("WebView2 invalid whiteboard alert", || {
        eval(
            &host.native().view,
            "!!document.querySelector('.whiteboard-editor [role=alert]')",
        ) == "1"
    });
    drop(host);
    drop(window);
    println!(
        "{}",
        json!({
            "passed": true,
            "engine": "webview2",
            "ephemeral": true,
            "theme": true,
            "resize": true,
            "invalidPreserved": true
        })
    );
}
