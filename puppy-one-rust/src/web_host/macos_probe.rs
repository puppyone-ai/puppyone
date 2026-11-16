//! Real WebKit integration fixture. Runs on the main thread in its own
//! executable with an ephemeral website store and no user window/profile.
use super::*;
use crate::platform::webview::{Content, Entry, ResourceSource, ResourceStream, Source};
use objc2::{class, msg_send, rc::autoreleasepool, runtime::AnyObject};
use objc2_foundation::{NSDate, NSPoint, NSRect, NSRunLoop, NSSize, NSURL, NSURLRequest};
use std::{
    io::{self, Seek, SeekFrom},
    path::Path,
    sync::{Condvar, Mutex},
    time::{Duration, Instant},
};

#[derive(Default)]
struct Counts {
    reads: usize,
    bytes: usize,
    drops: usize,
    max_request: usize,
}
struct Provider {
    counts: Mutex<HashMap<String, Counts>>,
    released: Mutex<bool>,
    ready: Condvar,
    live: AtomicBool,
}
impl Provider {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            counts: Mutex::default(),
            released: Mutex::new(false),
            ready: Condvar::new(),
            live: AtomicBool::new(true),
        })
    }
    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.ready.notify_all();
    }
}
struct Reader {
    provider: Arc<Provider>,
    name: String,
    length: u64,
    offset: u64,
}
impl Read for Reader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.name == "stream" && self.offset >= CHUNK_BYTES as u64 {
            let (released, timeout) = self
                .provider
                .ready
                .wait_timeout_while(
                    self.provider.released.lock().unwrap(),
                    Duration::from_secs(20),
                    |released| !*released,
                )
                .unwrap();
            if timeout.timed_out() && !*released {
                return Err(io::ErrorKind::TimedOut.into());
            }
        }
        let physical = if self.name == "short" { 3 } else { self.length };
        let n = physical
            .saturating_sub(self.offset)
            .min(buffer.len() as u64) as usize;
        for (i, b) in buffer[..n].iter_mut().enumerate() {
            *b = ((self.offset + i as u64) % 251) as u8;
        }
        self.offset += n as u64;
        let mut counts = self.provider.counts.lock().unwrap();
        let count = counts.entry(self.name.clone()).or_default();
        count.reads += 1;
        count.bytes += n;
        count.max_request = count.max_request.max(buffer.len());
        Ok(n)
    }
}
impl Seek for Reader {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        self.offset = match from {
            SeekFrom::Start(n) => n,
            _ => return Err(io::ErrorKind::Unsupported.into()),
        };
        Ok(self.offset)
    }
}
impl Drop for Reader {
    fn drop(&mut self) {
        self.provider
            .counts
            .lock()
            .unwrap()
            .entry(self.name.clone())
            .or_default()
            .drops += 1;
    }
}
struct ProviderSource(Arc<Provider>);
impl ResourceSource for ProviderSource {
    fn is_live(&self) -> bool {
        self.0.live.load(Ordering::Acquire)
    }
    fn read(&self, _: &Path) -> Option<Vec<u8>> {
        panic!("native stream used whole-body fallback")
    }
    fn open(&self, relative: &Path) -> io::Result<Option<ResourceStream>> {
        let name = relative.to_str().ok_or(io::ErrorKind::NotFound)?;
        let length = match name {
            "stream" => 8 * CHUNK_BYTES as u64,
            "range" => 2 * 1024 * 1024 * 1024,
            "short" => 10,
            _ => return Err(io::ErrorKind::NotFound.into()),
        };
        Ok(Some(ResourceStream {
            length,
            reader: Box::new(Reader {
                provider: self.0.clone(),
                name: name.into(),
                length,
                offset: 0,
            }),
        }))
    }
}
struct Fixture {
    view: Retained<WKWebView>,
    owner: Owner,
    source: Arc<Provider>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.owner.retire();
        self.source.release();
        // SAFETY: still-live, main-thread WebView; all callbacks were invalidated first.
        unsafe {
            self.view.stopLoading();
        }
    }
}
impl Fixture {
    fn new() -> Self {
        let mtm = MainThreadMarker::new().expect("main-thread probe");
        let source = Provider::new();
        let content = Content {
            root: None,
            source: Some(Source(Arc::new(ProviderSource(source.clone())))),
            entry: Entry::Html("<!doctype html><html><body>stream fixture</body></html>".into()),
            max_bytes: 2 * 1024 * 1024 * 1024,
            assets: vec![],
            ipc: None,
            policy: None,
            frames: None,
            disk_assets: None,
            locked: true,
        }
        .prepare();
        let (config, owner) = configuration(content).unwrap();
        // SAFETY: configuration and WebView are created and used only on the process main thread.
        let view = unsafe {
            assert!(!config.websiteDataStore().isPersistent());
            let view = WKWebView::initWithFrame_configuration(
                WKWebView::alloc(mtm),
                NSRect::new(NSPoint::new(0., 0.), NSSize::new(640., 480.)),
                &config,
            );
            let url =
                NSURL::URLWithString(&NSString::from_str(&crate::platform::webview::entry_url()))
                    .unwrap();
            view.loadRequest(&NSURLRequest::requestWithURL(&url));
            view
        };
        let fixture = Self {
            view,
            owner,
            source,
        };
        wait("entry load", || {
            eval(
                &fixture.view,
                "document.readyState === 'complete' && location.protocol === 'puppyone-preview:'",
            ) == "1"
        });
        fixture
    }
    fn start_stream(&self) {
        eval(
            &self.view,
            r#"window.probe = {}; window.abort = new AbortController();
        (async () => { try {
          const response = await fetch('puppyone-local://local/stream', {signal: abort.signal});
          window.reader = response.body.getReader();
          const first = await reader.read(); probe.first = first.value.length;
          while (!(await reader.read()).done) {} probe.finished = true;
        } catch (e) { probe.failed = true; } })(); 'started'"#,
        );
        wait("first streamed chunk before producer EOF", || {
            eval(&self.view, "JSON.stringify(window.probe)").contains("first")
        });
        let counts = self.source.counts.lock().unwrap();
        let count = counts.get("stream").unwrap();
        assert_eq!(count.bytes, CHUNK_BYTES);
        assert_eq!(count.max_request, CHUNK_BYTES);
        assert_eq!(count.drops, 0);
    }
}
pub(super) fn tick() {
    autoreleasepool(|_| {
        NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.005))
    });
}
pub(super) fn wait(label: &str, mut condition: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(15);
    while !condition() {
        assert!(Instant::now() < until, "native probe timed out: {label}");
        tick();
    }
}
pub(super) fn eval(view: &WKWebView, script: &str) -> String {
    let result = Rc::new(RefCell::new(None));
    let complete = result.clone();
    let callback = block2::RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
        // SAFETY: WebKit supplies live objects for the duration of its callback.
        let text = unsafe {
            if !error.is_null() {
                format!("error:{}", (*error).localizedDescription())
            } else if value.is_null() {
                "null".into()
            } else {
                let description: Retained<NSString> = msg_send![value, description];
                description.to_string()
            }
        };
        *complete.borrow_mut() = Some(text);
    });
    // SAFETY: the live WebView and the retained completion block remain on the main thread.
    unsafe {
        view.evaluateJavaScript_completionHandler(&NSString::from_str(script), Some(&callback));
    }
    wait("JavaScript completion", || result.borrow().is_some());
    let output = result.borrow_mut().take().unwrap();
    assert!(
        !output.starts_with("error:"),
        "JavaScript failed: {output}: {script}"
    );
    output
}

pub(super) fn run() {
    let _mtm = MainThreadMarker::new().expect("main-thread probe");
    // SAFETY: initialize AppKit without a window or activation/Dock presence.
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let _: bool = msg_send![app, setActivationPolicy: 2_isize];
    }
    let fixture = Fixture::new();
    eval(
        &fixture.view,
        r#"window.result = {};
    (async () => { try {
      const range = await fetch('puppyone-local://local/range', {headers: {Range: 'bytes=123-126'}});
      const bytes = Array.from(new Uint8Array(await range.arrayBuffer()));
      result.range = range.status === 206 && bytes.join(',') === '123,124,125,126'
        && range.headers.get('Content-Range') === 'bytes 123-126/2147483648'
        && range.headers.get('Cache-Control') === 'no-store';
      const head = await fetch('puppyone-local://local/range', {method: 'HEAD', headers: {Range: 'bytes=1-2'}});
      result.head = head.status === 200 && head.headers.get('Content-Length') === '2147483648' && (await head.arrayBuffer()).byteLength === 0;
      const invalid = await fetch('puppyone-local://local/range', {headers: {Range: 'bytes=2147483648-'}});
      result.unsatisfiable = invalid.status === 416;
      try { await (await fetch('puppyone-local://local/short')).arrayBuffer(); result.shortReadFails = false; }
      catch (e) { result.shortReadFails = true; }
      result.done = true;
    } catch (e) { result.error = String(e); } })(); 'started'"#,
    );
    wait("range, HEAD and short-read browser assertions", || {
        let result = eval(&fixture.view, "JSON.stringify(window.result)");
        assert!(!result.contains("error"), "{result}");
        result.contains("done")
    });
    let result: serde_json::Value =
        serde_json::from_str(&eval(&fixture.view, "JSON.stringify(window.result)")).unwrap();
    for name in ["range", "head", "unsatisfiable", "shortReadFails"] {
        assert_eq!(result[name], true, "{result}");
    }
    assert_eq!(fixture.source.counts.lock().unwrap()["range"].bytes, 4);
    fixture.start_stream();
    eval(&fixture.view, "abort.abort(); 'cancelled'");
    wait("WebKit stop task", || {
        fixture.owner.0.tasks.borrow().is_empty()
    });
    fixture.source.release();
    wait("cancelled reader drop", || {
        fixture.source.counts.lock().unwrap()["stream"].drops == 1
    });
    assert!(fixture.source.counts.lock().unwrap()["stream"].bytes <= CHUNK_BYTES * 2);
    assert!(!eval(&fixture.view, "JSON.stringify(window.probe)").contains("finished"));
    drop(fixture);

    let fixture = Fixture::new();
    fixture.start_stream();
    fixture.source.live.store(false, Ordering::Release);
    fixture.source.release();
    wait("revocation failure reaches browser", || {
        eval(&fixture.view, "JSON.stringify(window.probe)").contains("failed")
    });
    assert!(fixture.owner.0.tasks.borrow().is_empty());
    assert!(!eval(&fixture.view, "JSON.stringify(window.probe)").contains("finished"));
    drop(fixture);

    let fixture = Fixture::new();
    fixture.start_stream();
    let source = fixture.source.clone();
    drop(fixture);
    wait("closed WebView reader drop", || {
        source.counts.lock().unwrap()["stream"].drops == 1
    });
    assert!(source.counts.lock().unwrap()["stream"].bytes <= CHUNK_BYTES * 2);

    let fixture = Fixture::new();
    fixture.start_stream();
    let (key, old_generation) = {
        let mut tasks = fixture.owner.0.tasks.borrow_mut();
        assert_eq!(tasks.len(), 1);
        let (key, task) = tasks.iter_mut().next().unwrap();
        let old = task.generation;
        task.generation += 1;
        (*key, old)
    };
    assert!(
        !fixture
            .owner
            .0
            .deliver(key, old_generation, Packet::Data(vec![255]))
    );
    assert!(!fixture.owner.0.deliver(key, old_generation, Packet::Finish));
    assert_eq!(fixture.owner.0.tasks.borrow().len(), 1);
    fixture
        .owner
        .0
        .deliver(key, old_generation + 1, Packet::Fail);
    assert!(fixture.owner.0.tasks.borrow().is_empty());
    drop(fixture);
    println!(
        "{}",
        serde_json::json!({"passed": true, "ephemeral": true, "range": true, "head": true,
        "firstChunkBeforeEof": true, "cancel": true, "revoke": true, "close": true,
        "generationFence": true, "shortReadFails": true})
    );
}
