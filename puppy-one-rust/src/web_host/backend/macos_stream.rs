//! WebKit's incremental scheme API. Only byte packets and numeric identities
//! cross threads; all Objective-C objects and callbacks stay on the main
//! thread. A worker waits for each main-thread callback before reading again.
//! This bounds our delivery queue, not WebKit's internal consumer buffers.
use super::{PreparedContent, ProtocolResponse};
use crate::platform::webview::{CHUNK_BYTES, LOCAL_SCHEME, SCHEME};
use objc2::{
    AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, Message, define_class,
    msg_send, rc::Retained, runtime::ProtocolObject,
};
use objc2_foundation::{
    NSData, NSDictionary, NSError, NSHTTPURLResponse, NSObject, NSObjectProtocol, NSString,
};
use objc2_web_kit::{
    WKURLSchemeHandler, WKURLSchemeTask, WKWebView, WKWebViewConfiguration, WKWebsiteDataStore,
};
use std::{
    cell::RefCell,
    collections::HashMap,
    io::Read,
    panic::AssertUnwindSafe,
    rc::{Rc, Weak},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
};

static NEXT: AtomicU64 = AtomicU64::new(1);
thread_local! {
    static OWNERS: RefCell<HashMap<u64, Weak<State>>> = RefCell::default();
}
struct Task {
    object: Retained<ProtocolObject<dyn WKURLSchemeTask>>,
    generation: u64,
    cancelled: Arc<AtomicBool>,
}
impl Drop for Task {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
    }
}
struct State {
    id: u64,
    content: PreparedContent,
    tasks: RefCell<HashMap<usize, Task>>,
    #[cfg(feature = "dev-capture")]
    request_observer: RefCell<Option<RequestObserver>>,
}
#[cfg(feature = "dev-capture")]
type RequestObserver = Rc<dyn Fn(&str)>;
impl Drop for State {
    fn drop(&mut self) {
        self.tasks.get_mut().clear();
        OWNERS.with(|owners| owners.borrow_mut().remove(&self.id));
    }
}
/// Kept by the host, separately from WebKit's retained handler. Destroying a
/// host invalidates its workers before destroying the native WebView.
pub(super) struct Owner(Rc<State>);
impl Owner {
    #[cfg(feature = "dev-capture")]
    fn observe_requests(&self, observer: RequestObserver) {
        *self.0.request_observer.borrow_mut() = Some(observer);
    }
    pub fn retire(&self) {
        self.0.content.revoke();
        self.0.tasks.borrow_mut().clear();
    }
}
impl Drop for Owner {
    fn drop(&mut self) {
        self.retire();
    }
}
struct Ivars {
    owner: Weak<State>,
    local: bool,
}
define_class!(
    // SAFETY: NSObject permits subclassing. Ivars contain only main-thread state.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[name = "PuppyOneStreamingSchemeHandler"]
    #[ivars = Ivars]
    struct Handler;
    // SAFETY: NSObjectProtocol has no additional requirements.
    unsafe impl NSObjectProtocol for Handler {}
    // SAFETY: signatures match WKURLSchemeHandler; callbacks stay on the main thread.
    unsafe impl WKURLSchemeHandler for Handler {
        #[unsafe(method(webView:startURLSchemeTask:))]
        fn start(&self, _view: &WKWebView, task: &ProtocolObject<dyn WKURLSchemeTask>) {
            if let Some(owner) = self.ivars().owner.upgrade() {
                owner.start(task, self.ivars().local);
            } else {
                fail(task);
            }
        }
        #[unsafe(method(webView:stopURLSchemeTask:))]
        fn stop(&self, _view: &WKWebView, task: &ProtocolObject<dyn WKURLSchemeTask>) {
            if let Some(owner) = self.ivars().owner.upgrade() {
                // Pointer identity, never NSObject's overridable hash/equality.
                owner.tasks.borrow_mut().remove(&identity(task));
            }
        }
    }
);
impl Handler {
    fn new(mtm: MainThreadMarker, owner: &Rc<State>, local: bool) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(Ivars {
            owner: Rc::downgrade(owner),
            local,
        });
        // SAFETY: NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    }
}
fn identity(task: &ProtocolObject<dyn WKURLSchemeTask>) -> usize {
    task as *const _ as usize
}

pub(super) fn configuration(
    content: PreparedContent,
) -> Result<(Retained<WKWebViewConfiguration>, Owner), String> {
    let mtm = MainThreadMarker::new().ok_or("WebView requires the main thread")?;
    let state = Rc::new(State {
        id: NEXT.fetch_add(1, Ordering::Relaxed),
        content,
        tasks: RefCell::default(),
        #[cfg(feature = "dev-capture")]
        request_observer: RefCell::default(),
    });
    OWNERS.with(|owners| owners.borrow_mut().insert(state.id, Rc::downgrade(&state)));
    // SAFETY: a fresh configuration is created on the main thread.
    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    // SAFETY: new configuration and main-thread-only handlers. Wry does not
    // apply incognito when given a configuration; set the ephemeral store here.
    unsafe {
        config.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(mtm));
        for (scheme, local) in [(SCHEME, false), (LOCAL_SCHEME, true)] {
            let handler = Handler::new(mtm, &state, local);
            config.setURLSchemeHandler_forURLScheme(
                Some(ProtocolObject::from_ref(&*handler)),
                &NSString::from_str(scheme),
            );
        }
    }
    Ok((config, Owner(state)))
}

enum Packet {
    Headers(ProtocolResponse),
    Data(Vec<u8>),
    Finish,
    Fail,
}
impl State {
    fn start(&self, object: &ProtocolObject<dyn WKURLSchemeTask>, local: bool) {
        if !self.content.is_live() {
            fail(object);
            return;
        }
        // SAFETY: the live WebKit task is borrowed on the main thread.
        let request = unsafe { object.request() };
        let Some(url) = request.URL().and_then(|url| url.absoluteString()) else {
            fail(object);
            return;
        };
        #[cfg(feature = "dev-capture")]
        if let Some(observer) = self.request_observer.borrow().as_ref() {
            observer(&url.to_string());
        }
        let method = request
            .HTTPMethod()
            .map(|m| m.to_string())
            .unwrap_or_else(|| "GET".into());
        let mut parsed = wry::http::Request::builder()
            .uri(url.to_string())
            .method(method.as_str());
        if let Some(headers) = request.allHTTPHeaderFields() {
            for key in headers.allKeys() {
                if let Some(value) = headers.objectForKey(&key) {
                    parsed = parsed.header(key.to_string(), value.to_string());
                }
            }
        }
        let Ok(request) = parsed.body(Vec::new()) else {
            fail(object);
            return;
        };
        let key = identity(object);
        let generation = NEXT.fetch_add(1, Ordering::Relaxed);
        let cancelled = Arc::new(AtomicBool::new(false));
        self.tasks.borrow_mut().insert(
            key,
            Task {
                object: object.retain(),
                generation,
                cancelled: cancelled.clone(),
            },
        );
        let content = self.content.clone();
        let owner_id = self.id;
        let worker = std::thread::Builder::new()
            .name("preview-stream".into())
            .spawn(move || {
                let send = |packet| send(owner_id, key, generation, &cancelled, packet);
                if cancelled.load(Ordering::Acquire) {
                    return;
                }
                let mut response = super::prepare_protocol_response(&content, local, &request);
                if !send(Packet::Headers(response.metadata)) {
                    return;
                }
                loop {
                    if cancelled.load(Ordering::Acquire) {
                        return;
                    }
                    let mut bytes = vec![0; CHUNK_BYTES];
                    match response.body.read(&mut bytes) {
                        Ok(0) => {
                            send(Packet::Finish);
                            return;
                        }
                        Ok(n) => {
                            bytes.truncate(n);
                            if !send(Packet::Data(bytes)) {
                                return;
                            }
                        }
                        Err(_) => {
                            send(Packet::Fail);
                            return;
                        }
                    }
                }
            });
        if worker.is_err() {
            self.deliver(key, generation, Packet::Fail);
        }
    }
    fn remove(&self, key: usize, generation: u64) {
        let mut tasks = self.tasks.borrow_mut();
        if tasks
            .get(&key)
            .is_some_and(|task| task.generation == generation)
        {
            tasks.remove(&key);
        }
    }
    fn deliver(&self, key: usize, generation: u64, packet: Packet) -> bool {
        // Release the map borrow before calling WebKit: it can synchronously
        // re-enter the stop handler. A reused pointer needs a matching generation.
        let task = self
            .tasks
            .borrow()
            .get(&key)
            .filter(|task| task.generation == generation && !task.cancelled.load(Ordering::Acquire))
            .map(|task| task.object.clone());
        let Some(task) = task else {
            return false;
        };
        if !self.content.is_live() {
            fail(&task);
            self.remove(key, generation);
            return false;
        }
        let terminal = matches!(packet, Packet::Finish | Packet::Fail);
        let delivered = objc2::exception::catch(AssertUnwindSafe(|| {
            // SAFETY: all calls run on the main thread, only for the live
            // generation. Stop, completion and owner retirement remove it.
            unsafe {
                match packet {
                    Packet::Headers(metadata) => {
                        let response = super::response(metadata, self.content.policy);
                        let fields: Vec<_> = response
                            .headers()
                            .iter()
                            .map(|(k, v)| {
                                (
                                    NSString::from_str(k.as_str()),
                                    NSString::from_str(v.to_str().unwrap_or("")),
                                )
                            })
                            .collect();
                        let keys: Vec<_> = fields.iter().map(|(k, _)| &**k).collect();
                        let values: Vec<_> = fields.iter().map(|(_, v)| &**v).collect();
                        let headers = NSDictionary::from_slices(&keys, &values);
                        let Some(url) = task.request().URL() else {
                            return false;
                        };
                        let Some(response) =
                            NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(
                                NSHTTPURLResponse::alloc(),
                                &url,
                                response.status().as_u16() as isize,
                                Some(&NSString::from_str("HTTP/1.1")),
                                Some(&headers),
                            )
                        else {
                            return false;
                        };
                        task.didReceiveResponse(&response);
                    }
                    Packet::Data(bytes) => task.didReceiveData(&NSData::from_vec(bytes)),
                    Packet::Finish => task.didFinish(),
                    Packet::Fail => fail(&task),
                }
            }
            true
        }))
        .unwrap_or(false);
        if terminal || !delivered {
            self.remove(key, generation);
        }
        delivered
            && !terminal
            && self
                .tasks
                .borrow()
                .get(&key)
                .is_some_and(|task| task.generation == generation)
    }
}
fn fail(task: &ProtocolObject<dyn WKURLSchemeTask>) {
    let _ = objc2::exception::catch(AssertUnwindSafe(|| {
        // SAFETY: invoked only on the main thread for a live task. A WebKit
        // exception during its own teardown must not unwind through Rust.
        unsafe {
            task.didFailWithError(&NSError::errorWithDomain_code_userInfo(
                &NSString::from_str("PuppyOnePreview"),
                1,
                None,
            ));
        }
    }));
}
fn send(owner: u64, key: usize, generation: u64, cancelled: &AtomicBool, packet: Packet) -> bool {
    if cancelled.load(Ordering::Acquire) {
        return false;
    }
    let (ack, received) = mpsc::sync_channel(1);
    dispatch2::DispatchQueue::main().exec_async(move || {
        let state = OWNERS.with(|owners| owners.borrow().get(&owner).and_then(Weak::upgrade));
        let delivered = state.is_some_and(|state| state.deliver(key, generation, packet));
        let _ = ack.send(delivered);
    });
    // At most one packet is queued per worker; no next read until delivery.
    received.recv().unwrap_or(false) && !cancelled.load(Ordering::Acquire)
}

#[cfg(feature = "dev-capture")]
#[path = "macos_probe.rs"]
mod probe;
#[cfg(feature = "dev-capture")]
pub(crate) fn run_probe() {
    probe::run();
}

#[cfg(feature = "dev-capture")]
#[path = "macos_whiteboard_probe.rs"]
mod whiteboard_probe;
#[cfg(feature = "dev-capture")]
pub(crate) fn run_whiteboard_probe(root: &std::path::Path) {
    whiteboard_probe::run(root);
}

#[cfg(feature = "dev-capture")]
#[path = "macos_document_pages_probe.rs"]
mod document_pages_probe;
#[cfg(feature = "dev-capture")]
pub(crate) fn run_document_pages_probe() {
    document_pages_probe::run();
}
