//! The render service (`render-service.mjs` and `mermaidRenderService.ts`,
//! natively): diagrams and formulas drawn by the product's own Mermaid and
//! KaTeX in a hidden page (`assets/web/render-service.*`), and handed to
//! GPUI as images.
//!
//! Each window keeps one hidden WebView for the page. A request is drawn,
//! the page reports its size, and the view's snapshot of exactly that area,
//! at the scale it will be shown, becomes the image. Results are cached app
//! wide by what was drawn (source, settings, background and scale), so a
//! diagram is drawn once however many panes show it, and the windows redraw
//! when an image arrives. Identical in-flight keys share one queued job,
//! superseded slot requests are cancelled before drawing, and `Unavailable`
//! is never permanently cached so subsequent retries succeed (`TA-50`).
use crate::platform::webview::{Content, Entry, Ipc};
use crate::web_host::WebHost;
use gpui::{App, ImageFormat, RenderImage, SharedString, Window, WindowId};
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    hash::{Hash, Hasher},
    sync::Arc,
    time::{Duration, Instant},
};

const SCRIPT: &[u8] = include_bytes!("../../assets/web/render-service.js");
const STYLE: &[u8] = include_bytes!("../../assets/web/render-service.css");
/// `MERMAID_MAX_SOURCE_BYTES`.
pub const MAX_SOURCE_BYTES: usize = 128 * 1024;
/// `MERMAID_RENDER_TIMEOUT_MS`.
const RENDER_TIMEOUT: Duration = Duration::from_secs(15);
/// Transient backoff preventing a tight redraw spin loop after a host snapshot
/// failure while ensuring `Unavailable` is never permanently cached.
const UNAVAILABLE_COOLDOWN: Duration = Duration::from_secs(2);
/// The cache's bounds: entries, and the images' decoded bytes.
const MAX_ENTRIES: usize = 96;
const MAX_BYTES: usize = 96 * 1024 * 1024;
/// The largest drawing edge, in logical pixels (`MERMAID_MAX_INTRINSIC_EDGE_PX`).
const MAX_EDGE: f32 = 4096.;
/// No page script runs but the bundled one; nothing is fetched.
const POLICY: &str = "default-src 'none'; script-src puppyone-preview:; \
     style-src puppyone-preview: 'unsafe-inline'; font-src puppyone-preview: data:; \
     img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/// Logical caller slot `(owner_id, block_offset)` used to cancel superseded
/// render requests when a block's source or zoom advances.
pub type RenderSlot = (u64, usize);

/// What is drawn.
#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    /// A Mermaid diagram with its `MermaidConfig` (theme variables, font).
    Mermaid { config: serde_json::Value },
    /// A KaTeX formula: display or inline, in a colour and size.
    Math {
        display: bool,
        color: String,
        font_size: f32,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub kind: Kind,
    pub source: String,
    /// The colour behind the drawing (its antialiasing is blended onto it).
    pub background: String,
    /// Device-independent zoom the image is shown at (1 = its own size).
    pub scale: f32,
}
#[derive(Clone)]
pub struct Rendered {
    pub image: Arc<RenderImage>,
    /// The drawing's own size and baseline, in logical pixels at scale 1.
    pub width: f32,
    pub height: f32,
    pub baseline: f32,
}
#[derive(Clone)]
pub enum State {
    Pending,
    Ready(Rendered),
    /// Mermaid or KaTeX refused the source, saying why.
    Failed(SharedString),
    /// No drawing could be made (no page, no answer, no snapshot); the
    /// caller keeps its own rendering and may retry later.
    Unavailable,
}

/// The colours and type a diagram is drawn in (`getMermaidThemeSnapshot`'s
/// roles, read from the Markdown profile or the application's tokens).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MermaidTheme<'a> {
    pub background: gpui::Rgba,
    pub panel: gpui::Rgba,
    pub text: gpui::Rgba,
    pub muted: gpui::Rgba,
    pub accent: gpui::Rgba,
    pub border: gpui::Rgba,
    pub success: gpui::Rgba,
    pub warning: gpui::Rgba,
    pub danger: gpui::Rgba,
    pub font_family: &'a str,
    pub font_size: f32,
}

/// `resolveMermaidColor`: Mermaid's palette maths takes hex; a translucent
/// colour keeps its RGB, as the product's canvas readback does.
pub fn hex(color: gpui::Rgba) -> String {
    let channel = |c: f32| (c.clamp(0., 1.) * 255.).round() as u8;
    format!(
        "#{:02x}{:02x}{:02x}",
        channel(color.r),
        channel(color.g),
        channel(color.b)
    )
}

/// `isDarkColor`: luminance under 0.45.
fn dark(color: gpui::Rgba) -> bool {
    0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b < 0.45
}

/// `getMermaidThemeSnapshot`'s `MermaidConfig`, field for field.
pub fn mermaid_config(theme: &MermaidTheme) -> serde_json::Value {
    let [
        background,
        panel,
        text,
        muted,
        accent,
        divider,
        success,
        warning,
        danger,
    ] = [
        theme.background,
        theme.panel,
        theme.text,
        theme.muted,
        theme.accent,
        theme.border,
        theme.success,
        theme.warning,
        theme.danger,
    ]
    .map(hex);
    let font = theme
        .font_family
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let size = format!("{}px", theme.font_size);
    let variables: serde_json::Map<String, serde_json::Value> = [
        ("background", &background),
        ("mainBkg", &panel),
        ("secondBkg", &background),
        ("tertiaryColor", &panel),
        ("primaryColor", &panel),
        ("primaryTextColor", &text),
        ("primaryBorderColor", &divider),
        ("secondaryColor", &background),
        ("secondaryTextColor", &text),
        ("secondaryBorderColor", &divider),
        ("tertiaryTextColor", &text),
        ("tertiaryBorderColor", &divider),
        ("lineColor", &muted),
        ("textColor", &text),
        ("noteTextColor", &text),
        ("noteBkgColor", &panel),
        ("noteBorderColor", &divider),
        ("edgeLabelBackground", &background),
        ("clusterBkg", &panel),
        ("clusterBorder", &divider),
        ("defaultLinkColor", &muted),
        ("nodeBorder", &divider),
        ("actorBkg", &panel),
        ("actorBorder", &divider),
        ("actorTextColor", &text),
        ("signalColor", &muted),
        ("signalTextColor", &text),
        ("labelBoxBkgColor", &panel),
        ("labelBoxBorderColor", &divider),
        ("labelTextColor", &text),
        ("loopTextColor", &text),
        ("activationBkgColor", &panel),
        ("activationBorderColor", &divider),
        ("sequenceNumberColor", &background),
        ("pie1", &accent),
        ("pie2", &success),
        ("pie3", &warning),
        ("pie4", &danger),
        ("git0", &accent),
        ("git1", &success),
        ("git2", &warning),
        ("git3", &danger),
        ("fontFamily", &font),
        ("fontSize", &size),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), serde_json::Value::from(v.as_str())))
    .collect();
    serde_json::json!({
        "startOnLoad": false,
        "securityLevel": "strict",
        "suppressErrorRendering": true,
        "theme": "base",
        "darkMode": dark(theme.background),
        "htmlLabels": false,
        "fontFamily": font,
        "fontSize": theme.font_size,
        "themeVariables": variables,
    })
}

struct Job {
    id: u64,
    key: u64,
    payload: String,
    scale: f32,
    cancelled: bool,
}

struct HostQueue {
    queue: VecDeque<Job>,
    busy: Option<Job>,
}

impl HostQueue {
    fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            busy: None,
        }
    }

    fn has_active_key(&self, key: u64) -> bool {
        self.busy
            .as_ref()
            .is_some_and(|j| !j.cancelled && j.key == key)
            || self.queue.iter().any(|j| !j.cancelled && j.key == key)
    }

    fn cancel_queued_key(&mut self, key: u64) -> bool {
        let mut any = false;
        for job in &mut self.queue {
            if job.key == key && !job.cancelled {
                job.cancelled = true;
                any = true;
            }
        }
        any
    }

    fn pop_next_valid(&mut self, cache: &HashMap<u64, Cached>) -> Option<Job> {
        while let Some(job) = self.queue.pop_front() {
            if job.cancelled {
                continue;
            }
            // Skip jobs whose key was cancelled or already settled by another host.
            if !matches!(cache.get(&job.key).map(|c| &c.state), Some(State::Pending)) {
                continue;
            }
            return Some(job);
        }
        None
    }
}

struct Host {
    view: WebHost,
    /// The page has loaded its script (it says so once).
    ready: bool,
    jobs: HostQueue,
}

struct Cached {
    state: State,
    used: u64,
    bytes: usize,
}

#[derive(Default)]
struct Service {
    cache: HashMap<u64, Cached>,
    clock: u64,
    next_id: u64,
    hosts: HashMap<WindowId, Host>,
    /// Active key awaited by each logical slot `(owner, block_offset)`.
    slots: HashMap<RenderSlot, u64>,
    /// Short-lived cooldown per `(window, key)` after an async host timeout or
    /// snapshot failure; never stored in `cache` so retries succeed.
    cooldowns: HashMap<(WindowId, u64), Instant>,
}

impl Service {
    fn lookup_cached(&mut self, key: u64) -> Option<State> {
        self.clock += 1;
        let clock = self.clock;
        let entry = self.cache.get_mut(&key)?;
        if !matches!(entry.state, State::Pending) {
            entry.used = clock;
        }
        Some(entry.state.clone())
    }

    fn in_cooldown(&mut self, window_id: WindowId, key: u64) -> bool {
        self.cooldowns
            .retain(|_, until| until.saturating_duration_since(Instant::now()) > Duration::ZERO);
        self.cooldowns.contains_key(&(window_id, key))
    }

    fn has_in_flight(&self, key: u64) -> bool {
        self.hosts.values().any(|h| h.jobs.has_active_key(key))
    }

    fn bind_slot(&mut self, slot: RenderSlot, key: u64) {
        if let Some(previous) = self.slots.insert(slot, key)
            && previous != key
        {
            self.cancel_unreferenced_key(previous);
        }
    }

    fn release_slot(&mut self, slot: RenderSlot) {
        if let Some(previous) = self.slots.remove(&slot) {
            self.cancel_unreferenced_key(previous);
        }
    }

    fn cancel_unreferenced_key(&mut self, key: u64) {
        if self.slots.values().any(|&k| k == key) {
            return;
        }
        let busy_somewhere = self
            .hosts
            .values()
            .any(|h| h.jobs.busy.as_ref().is_some_and(|b| b.key == key));
        for host in self.hosts.values_mut() {
            host.jobs.cancel_queued_key(key);
        }
        if !busy_somewhere && matches!(self.cache.get(&key).map(|c| &c.state), Some(State::Pending))
        {
            self.cache.remove(&key);
        }
    }

    fn invalidate_key(&mut self, key: u64) {
        self.cache.remove(&key);
        self.cooldowns.retain(|&(_, k), _| k != key);
        for host in self.hosts.values_mut() {
            host.jobs.cancel_queued_key(key);
            if let Some(busy) = &mut host.jobs.busy
                && busy.key == key
            {
                busy.cancelled = true;
            }
        }
    }

    fn settle_key(&mut self, key: u64, state: State, bytes: usize) {
        // Never permanently cache `Unavailable` (`TA-50`, `TODO-34`).
        if matches!(state, State::Unavailable) {
            self.cache.remove(&key);
            return;
        }
        self.clock += 1;
        let used = self.clock;
        self.cache.insert(key, Cached { state, used, bytes });
        // Evict least-recently-used settled entries, never one still drawing.
        while self.cache.len() > MAX_ENTRIES
            || self.cache.values().map(|c| c.bytes).sum::<usize>() > MAX_BYTES
        {
            let Some(oldest) = self
                .cache
                .iter()
                .filter(|(_, c)| !matches!(c.state, State::Pending))
                .min_by_key(|(_, c)| c.used)
                .map(|(k, _)| *k)
            else {
                break;
            };
            self.cache.remove(&oldest);
        }
    }
}

thread_local! {
    static SERVICE: RefCell<Service> = RefCell::new(Service::default());
}

#[derive(serde::Deserialize)]
struct Reply {
    #[serde(default)]
    ready: bool,
    #[serde(default)]
    id: u64,
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    width: f32,
    #[serde(default)]
    height: f32,
    #[serde(default)]
    baseline: f32,
    #[serde(default)]
    error: String,
}

/// Stable cache key of `request` across panes and windows.
pub fn cache_key(request: &Request) -> u64 {
    key(request)
}

fn key(request: &Request) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    match &request.kind {
        Kind::Mermaid { config } => ("mermaid", config.to_string()).hash(&mut hasher),
        Kind::Math {
            display,
            color,
            font_size,
        } => ("math", display, color, font_size.to_bits()).hash(&mut hasher),
    }
    (
        &request.source,
        &request.background,
        request.scale.to_bits(),
    )
        .hash(&mut hasher);
    hasher.finish()
}

fn payload(id: u64, request: &Request) -> String {
    let mut job = match &request.kind {
        Kind::Mermaid { config } => serde_json::json!({ "kind": "mermaid", "config": config }),
        Kind::Math {
            display,
            color,
            font_size,
        } => serde_json::json!({
            "kind": "math", "display": display, "color": color, "fontSize": font_size,
        }),
    };
    job["id"] = id.into();
    job["source"] = request.source.clone().into();
    job["background"] = request.background.clone().into();
    job.to_string()
}

/// Cancels any pending queued request previously bound to `slot`.
pub fn cancel_slot(slot: RenderSlot) {
    SERVICE.with(|s| s.borrow_mut().release_slot(slot));
}

/// Clears any cached `Failed` state or transient cooldown for `request` so the
/// next call re-renders afresh.
pub fn invalidate(request: &Request) {
    let k = key(request);
    SERVICE.with(|s| s.borrow_mut().invalidate_key(k));
}

/// Slot-aware entry point: cancels any superseded queued job from `slot` before
/// requesting `request`.
pub fn get_for_slot(
    slot: RenderSlot,
    request: &Request,
    window: &mut Window,
    cx: &mut App,
) -> State {
    let k = key(request);
    SERVICE.with(|s| s.borrow_mut().bind_slot(slot, k));
    get(request, window, cx)
}

/// The drawing for `request`, starting it the first time it is asked for.
pub fn get(request: &Request, window: &mut Window, cx: &mut App) -> State {
    let key = key(request);
    let window_id = window.window_handle().window_id();
    let cached = SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        if let Some(state) = s.lookup_cached(key) {
            if matches!(state, State::Pending) && !s.has_in_flight(key) {
                s.cache.remove(&key);
            } else {
                return Some(state);
            }
        }
        if s.in_cooldown(window_id, key) {
            return Some(State::Unavailable);
        }
        None
    });
    if let Some(state) = cached {
        return state;
    }
    if request.source.len() > MAX_SOURCE_BYTES {
        let failed = State::Failed("The source exceeds the render limit.".into());
        settle(key, failed.clone(), 0);
        return failed;
    }
    let needs_host = SERVICE.with(|s| !s.borrow().hosts.contains_key(&window_id));
    if needs_host && !open_host(window, cx) {
        // Never cache `Unavailable` when a render host is not yet available.
        return State::Unavailable;
    }
    SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        // Deduplicate by `key`: if another caller already enqueued `key`, share it.
        let already_queued = s.has_in_flight(key);
        s.cache.entry(key).or_insert(Cached {
            state: State::Pending,
            used: u64::MAX,
            bytes: 0,
        });
        if !already_queued {
            s.next_id += 1;
            let id = s.next_id;
            if let Some(host) = s.hosts.get_mut(&window_id) {
                host.jobs.queue.push_back(Job {
                    id,
                    key,
                    payload: payload(id, request),
                    scale: request.scale,
                    cancelled: false,
                });
            }
        }
    });
    pump(window_id, cx);
    State::Pending
}

fn page() -> String {
    "<!doctype html><html><head><meta charset=\"utf-8\">\
     <link rel=\"stylesheet\" href=\"__assets__/render-service.css\">\
     <style>html,body{margin:0;padding:0}#stage{position:absolute;left:0;top:0;display:inline-block;width:max-content}</style>\
     </head><body><div id=\"stage\"></div>\
     <script src=\"__assets__/render-service.js\"></script></body></html>"
        .into()
}

fn open_host(window: &mut Window, cx: &mut App) -> bool {
    let (tx, rx) = async_channel::unbounded::<String>();
    let content = Content {
        root: None,
        source: None,
        entry: Entry::Html(page()),
        max_bytes: 8 * 1024 * 1024,
        assets: vec![("render-service.js", SCRIPT), ("render-service.css", STYLE)],
        ipc: Some(Ipc(tx)),
        policy: Some(POLICY),
        frames: None,
        disk_assets: None,
        locked: true,
    };
    let Ok(view) = WebHost::new(window, content, false) else {
        return false;
    };
    let window_id = window.window_handle().window_id();
    let live: Vec<WindowId> = cx.windows().iter().map(|w| w.window_id()).collect();
    SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        s.hosts.retain(|id, _| live.contains(id));
        s.hosts.insert(
            window_id,
            Host {
                view,
                ready: false,
                jobs: HostQueue::new(),
            },
        );
    });
    cx.spawn(async move |cx| {
        while let Ok(message) = rx.recv().await {
            let Ok(reply) = serde_json::from_str::<Reply>(&message) else {
                continue;
            };
            cx.update(|cx| answered(window_id, reply, cx));
        }
    })
    .detach();
    true
}

fn settle(key: u64, state: State, bytes: usize) {
    SERVICE.with(|s| s.borrow_mut().settle_key(key, state, bytes));
}

/// Runs the page's next non-cancelled request when it is free.
fn pump(window_id: WindowId, cx: &mut App) {
    let started = SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        let Service { cache, hosts, .. } = &mut *s;
        let host = hosts.get_mut(&window_id)?;
        if host.jobs.busy.is_some() || !host.ready {
            return None;
        }
        let job = host.jobs.pop_next_valid(cache)?;
        host.view.evaluate(&format!(
            "window.__puppyoneRender&&window.__puppyoneRender({})",
            job.payload
        ));
        let id = job.id;
        host.jobs.busy = Some(job);
        Some(id)
    });
    let Some(id) = started else {
        return;
    };
    cx.spawn(async move |cx| {
        cx.background_executor().timer(RENDER_TIMEOUT).await;
        cx.update(|cx| timed_out(window_id, id, cx));
    })
    .detach();
}

/// The page never answered: close it, clear `Pending` entries without caching
/// `Unavailable` permanently, and apply a brief cooldown before re-queuing.
fn timed_out(window_id: WindowId, id: u64, cx: &mut App) {
    let stale = SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        let busy = s.hosts.get(&window_id)?.jobs.busy.as_ref()?.id;
        (busy == id).then(|| s.hosts.remove(&window_id)).flatten()
    });
    let Some(host) = stale else {
        return;
    };
    SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        if let Some(job) = &host.jobs.busy {
            s.settle_key(job.key, State::Unavailable, 0);
            s.cooldowns
                .insert((window_id, job.key), Instant::now() + UNAVAILABLE_COOLDOWN);
        }
        for job in &host.jobs.queue {
            if !s.has_in_flight(job.key) {
                s.cache.remove(&job.key);
            }
        }
    });
    drop(host);
    cx.refresh_windows();
}

fn answered(window_id: WindowId, reply: Reply, cx: &mut App) {
    if reply.ready {
        SERVICE.with(|s| {
            if let Some(host) = s.borrow_mut().hosts.get_mut(&window_id) {
                host.ready = true;
            }
        });
        pump(window_id, cx);
        return;
    }
    let busy = SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        let host = s.hosts.get_mut(&window_id)?;
        let job = host.jobs.busy.as_ref()?;
        (job.id == reply.id).then_some((job.key, job.scale, job.cancelled))
    });
    let Some((key, scale, cancelled)) = busy else {
        return;
    };
    if cancelled {
        SERVICE.with(|s| {
            let mut s = s.borrow_mut();
            if let Some(host) = s.hosts.get_mut(&window_id) {
                host.jobs.busy = None;
            }
            if !s.has_in_flight(key)
                && matches!(s.cache.get(&key).map(|c| &c.state), Some(State::Pending))
            {
                s.cache.remove(&key);
            }
        });
        pump(window_id, cx);
        return;
    }
    if !reply.ok || reply.width <= 0. || reply.height <= 0. {
        let error = if reply.error.is_empty() {
            "Unable to render.".to_owned()
        } else {
            reply.error
        };
        finish(window_id, key, State::Failed(error.into()), 0, cx);
        return;
    }
    let (width, height) = (reply.width.min(MAX_EDGE), reply.height.min(MAX_EDGE));
    let (tx, rx) = async_channel::bounded::<Option<Vec<u8>>>(1);
    SERVICE.with(|s| {
        let s = s.borrow();
        if let Some(host) = s.hosts.get(&window_id) {
            host.view.resize_hidden(width, height);
            host.view
                .snapshot((0., 0., width, height), width * scale, move |png| {
                    let _ = tx.try_send(png);
                });
        }
    });
    let baseline = reply.baseline;
    let svg = cx.svg_renderer();
    cx.spawn(async move |cx| {
        let png = rx.recv().await.ok().flatten();
        let decoded = cx
            .background_executor()
            .spawn(async move {
                let png = png?;
                gpui::Image::from_bytes(ImageFormat::Png, png)
                    .to_image_data(svg)
                    .ok()
            })
            .await;
        cx.update(|cx| {
            let state = match decoded {
                Some(image) => {
                    let size = image.size(0);
                    let bytes = size.width.0 as usize * size.height.0 as usize * 4;
                    let rendered = Rendered {
                        image,
                        width,
                        height,
                        baseline,
                    };
                    finish(window_id, key, State::Ready(rendered), bytes, cx);
                    return;
                }
                None => State::Unavailable,
            };
            SERVICE.with(|s| {
                s.borrow_mut()
                    .cooldowns
                    .insert((window_id, key), Instant::now() + UNAVAILABLE_COOLDOWN);
            });
            finish(window_id, key, state, 0, cx);
        });
    })
    .detach();
}

fn finish(window_id: WindowId, key: u64, state: State, bytes: usize, cx: &mut App) {
    settle(key, state, bytes);
    SERVICE.with(|s| {
        if let Some(host) = s.borrow_mut().hosts.get_mut(&window_id) {
            host.jobs.busy = None;
        }
    });
    cx.refresh_windows();
    pump(window_id, cx);
}

#[cfg(test)]
pub(crate) fn payload_for_tests(request: &Request) -> String {
    payload(1, request)
}

#[cfg(test)]
pub(crate) fn seed_ready_for_tests(request: &Request, rendered: Rendered) {
    let k = key(request);
    let size = rendered.image.size(0);
    let bytes = (size.width.0.max(1) as usize) * (size.height.0.max(1) as usize) * 4;
    SERVICE.with(|s| s.borrow_mut().settle_key(k, State::Ready(rendered), bytes));
}

#[cfg(test)]
pub(crate) fn has_in_flight_for_tests(request: &Request) -> bool {
    let k = key(request);
    SERVICE.with(|s| {
        let s = s.borrow();
        s.has_in_flight(k) || matches!(s.cache.get(&k).map(|c| &c.state), Some(State::Pending))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn mermaid(source: &str, scale: f32) -> Request {
        Request {
            kind: Kind::Mermaid {
                config: serde_json::json!({"theme": "base"}),
            },
            source: source.into(),
            background: hex(theme(false).panel),
            scale,
        }
    }

    fn theme(dark: bool) -> MermaidTheme<'static> {
        let t = crate::editor::tokens::Tokens::get(dark, Default::default());
        MermaidTheme {
            background: t.color("--po-md-mermaid-background"),
            panel: t.color("--po-md-mermaid-panel"),
            text: t.color("--po-md-mermaid-text"),
            muted: t.color("--po-md-mermaid-muted"),
            accent: t.color("--po-md-mermaid-accent"),
            border: t.color("--po-md-mermaid-border"),
            success: t.color("--po-md-mermaid-success"),
            warning: t.color("--po-md-mermaid-warning"),
            danger: t.color("--po-md-mermaid-danger"),
            font_family: t.raw("--po-md-mermaid-font"),
            font_size: 15.,
        }
    }

    #[test]
    fn the_diagram_theme_follows_the_product_snapshot() {
        let light = theme(false);
        let config = mermaid_config(&light);
        assert_eq!(config["darkMode"], false);
        assert_eq!(mermaid_config(&theme(true))["darkMode"], true);
        let font = config["fontFamily"].as_str().unwrap();
        assert!(
            font.starts_with("system-ui, ") && !font.contains('\n'),
            "{font}"
        );
        let variables = &config["themeVariables"];
        assert_eq!(variables["primaryBorderColor"], hex(light.border));
        assert_eq!(variables["fontSize"], "15px");
        assert_eq!(variables["pie2"], hex(light.success));
        assert!(light.border.a < 1.);
        let border = hex(light.border);
        assert_eq!(
            hex(gpui::Rgba {
                a: 1.,
                ..light.border
            }),
            border
        );
        assert!(border.len() == 7 && border.starts_with('#'));
    }

    #[test]
    fn what_is_drawn_names_the_cache_entry() {
        assert_eq!(key(&mermaid("graph TD", 1.)), key(&mermaid("graph TD", 1.)));
        assert_ne!(key(&mermaid("graph TD", 1.)), key(&mermaid("graph TD", 2.)));
        assert_ne!(key(&mermaid("graph TD", 1.)), key(&mermaid("graph LR", 1.)));
        let math = Request {
            kind: Kind::Math {
                display: true,
                color: hex(theme(false).text),
                font_size: 19.,
            },
            ..mermaid("graph TD", 1.)
        };
        assert_ne!(key(&math), key(&mermaid("graph TD", 1.)));
        let job: serde_json::Value = serde_json::from_str(&payload(7, &math)).unwrap();
        assert_eq!(job["kind"], "math");
        assert_eq!(job["id"], 7);
        assert_eq!(job["fontSize"], 19.);
    }

    #[test]
    fn the_cache_forgets_the_least_recently_used_drawing() {
        let mut service = Service::default();
        for n in 0..(MAX_ENTRIES as u64 + 5) {
            service.settle_key(n, State::Failed("x".into()), 0);
        }
        assert_eq!(service.cache.len(), MAX_ENTRIES);
        assert!(!service.cache.contains_key(&0));
        assert!(service.cache.contains_key(&(MAX_ENTRIES as u64 + 4)));
    }

    #[test]
    fn the_page_loads_only_its_bundled_assets_and_fetches_nothing() {
        // `Mermaid host request boundary`: the page's only script, style
        // and font are the bundled ones it is served with.
        let page = page();
        let sources: Vec<&str> = page
            .split(['"', '\''])
            .filter(|s| s.contains("__assets__") || s.contains("://"))
            .collect();
        assert_eq!(
            sources,
            [
                "__assets__/render-service.css",
                "__assets__/render-service.js"
            ]
        );
        let directive = |name: &str| {
            POLICY
                .split(';')
                .map(str::trim)
                .find(|d| d.starts_with(name))
                .unwrap()
        };
        assert_eq!(directive("default-src"), "default-src 'none'");
        assert_eq!(directive("script-src"), "script-src puppyone-preview:");
        assert_eq!(directive("connect-src"), "connect-src 'none'");
        assert_eq!(directive("img-src"), "img-src data:");
        for blocked in ["file:", "https:", "http:"] {
            assert!(!POLICY.contains(blocked), "{blocked}");
        }
    }

    #[test]
    fn unavailable_is_never_permanently_cached_and_superseded_jobs_skip() {
        let mut service = Service::default();
        service.cache.insert(
            42,
            Cached {
                state: State::Pending,
                used: u64::MAX,
                bytes: 0,
            },
        );
        service.settle_key(42, State::Unavailable, 0);
        assert!(
            !service.cache.contains_key(&42),
            "Unavailable must never remain cached"
        );

        let mut host_q = HostQueue::new();
        for (id, k) in [(1, 100u64), (2, 200u64)] {
            service.cache.insert(
                k,
                Cached {
                    state: State::Pending,
                    used: u64::MAX,
                    bytes: 0,
                },
            );
            host_q.queue.push_back(Job {
                id,
                key: k,
                payload: String::new(),
                scale: 1.,
                cancelled: false,
            });
        }
        assert!(host_q.has_active_key(100));
        assert!(host_q.cancel_queued_key(100));
        assert!(!host_q.has_active_key(100));
        let next = host_q.pop_next_valid(&service.cache).expect("job 200");
        assert_eq!(
            next.key, 200,
            "cancelled job 100 skipped when queue advances"
        );
    }
}
