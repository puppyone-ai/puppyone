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
//! when an image arrives. Requests run one at a time per page; a page that
//! does not answer within the product's render timeout is closed and a new
//! one takes the next request.
use crate::platform::webview::{Content, Entry, Ipc};
use crate::web_host::WebHost;
use gpui::{App, ImageFormat, RenderImage, SharedString, Window, WindowId};
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    hash::{Hash, Hasher},
    sync::Arc,
    time::Duration,
};

const SCRIPT: &[u8] = include_bytes!("../../assets/web/render-service.js");
const STYLE: &[u8] = include_bytes!("../../assets/web/render-service.css");
const GEIST: &[u8] = include_bytes!("../../assets/web/html-visual-geist.woff2");
/// `MERMAID_MAX_SOURCE_BYTES`.
pub const MAX_SOURCE_BYTES: usize = 128 * 1024;
/// `MERMAID_RENDER_TIMEOUT_MS`.
const RENDER_TIMEOUT: Duration = Duration::from_secs(15);
/// The cache's bounds: entries, and the images' decoded bytes.
const MAX_ENTRIES: usize = 96;
const MAX_BYTES: usize = 96 * 1024 * 1024;
/// The largest drawing edge, in logical pixels (`MERMAID_MAX_INTRINSIC_EDGE_PX`).
const MAX_EDGE: f32 = 4096.;
/// No page script runs but the bundled one; nothing is fetched.
const POLICY: &str = "default-src 'none'; script-src puppyone-preview:; \
     style-src puppyone-preview: 'unsafe-inline'; font-src puppyone-preview: data:; \
     img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

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
    /// caller keeps its own rendering.
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
}
struct Host {
    view: WebHost,
    /// The page has loaded its script (it says so once).
    ready: bool,
    queue: VecDeque<Job>,
    busy: Option<Job>,
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

/// The drawing for `request`, starting it the first time it is asked for.
pub fn get(request: &Request, window: &mut Window, cx: &mut App) -> State {
    let key = key(request);
    let cached = SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        s.clock += 1;
        let clock = s.clock;
        s.cache.get_mut(&key).map(|c| {
            c.used = clock;
            c.state.clone()
        })
    });
    if let Some(state) = cached {
        return state;
    }
    if request.source.len() > MAX_SOURCE_BYTES {
        let failed = State::Failed("The source exceeds the render limit.".into());
        settle(key, failed.clone(), 0);
        return failed;
    }
    let window_id = window.window_handle().window_id();
    let needs_host = SERVICE.with(|s| !s.borrow().hosts.contains_key(&window_id));
    if needs_host && !open_host(window, cx) {
        settle(key, State::Unavailable, 0);
        return State::Unavailable;
    }
    SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        s.next_id += 1;
        let id = s.next_id;
        s.cache.insert(
            key,
            Cached {
                state: State::Pending,
                used: u64::MAX,
                bytes: 0,
            },
        );
        if let Some(host) = s.hosts.get_mut(&window_id) {
            host.queue.push_back(Job {
                id,
                key,
                payload: payload(id, request),
                scale: request.scale,
            });
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
        assets: vec![
            ("render-service.js", SCRIPT),
            ("render-service.css", STYLE),
            ("fonts/geist/Geist-Variable.woff2", GEIST),
        ],
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
    // Hosts of windows that have closed go with them.
    let live: Vec<WindowId> = cx.windows().iter().map(|w| w.window_id()).collect();
    SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        s.hosts.retain(|id, _| live.contains(id));
        s.hosts.insert(
            window_id,
            Host {
                view,
                ready: false,
                queue: VecDeque::new(),
                busy: None,
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
    SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        s.clock += 1;
        let used = s.clock;
        s.cache.insert(key, Cached { state, used, bytes });
        // Least recently used first, never one still being drawn.
        while s.cache.len() > MAX_ENTRIES
            || s.cache.values().map(|c| c.bytes).sum::<usize>() > MAX_BYTES
        {
            let Some(oldest) = s
                .cache
                .iter()
                .filter(|(_, c)| !matches!(c.state, State::Pending))
                .min_by_key(|(_, c)| c.used)
                .map(|(k, _)| *k)
            else {
                break;
            };
            s.cache.remove(&oldest);
        }
    });
}

/// The page's next request, when it is free.
fn pump(window_id: WindowId, cx: &mut App) {
    let started = SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        let host = s.hosts.get_mut(&window_id)?;
        if host.busy.is_some() || !host.ready {
            return None;
        }
        let job = host.queue.pop_front()?;
        host.view.evaluate(&format!(
            "window.__puppyoneRender&&window.__puppyoneRender({})",
            job.payload
        ));
        let id = job.id;
        host.busy = Some(job);
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

/// The page never answered: it is closed with what it was asked, and its
/// requests are asked again of a new page.
fn timed_out(window_id: WindowId, id: u64, cx: &mut App) {
    let stale = SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        let busy = s.hosts.get(&window_id)?.busy.as_ref()?.id;
        (busy == id).then(|| s.hosts.remove(&window_id)).flatten()
    });
    let Some(host) = stale else {
        return;
    };
    if let Some(job) = &host.busy {
        settle(job.key, State::Unavailable, 0);
    }
    SERVICE.with(|s| {
        let mut s = s.borrow_mut();
        for job in &host.queue {
            s.cache.remove(&job.key);
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
        let job = host.busy.as_ref()?;
        (job.id == reply.id).then_some((job.key, job.scale))
    });
    let Some((key, scale)) = busy else {
        return;
    };
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
            finish(window_id, key, state, 0, cx);
        });
    })
    .detach();
}

fn finish(window_id: WindowId, key: u64, state: State, bytes: usize, cx: &mut App) {
    settle(key, state, bytes);
    SERVICE.with(|s| {
        if let Some(host) = s.borrow_mut().hosts.get_mut(&window_id) {
            host.busy = None;
        }
    });
    cx.refresh_windows();
    pump(window_id, cx);
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

    /// The Markdown profile's roles, light or dark.
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
            font.starts_with("\"Geist Sans\", ") && !font.contains('\n'),
            "{font}"
        );
        let variables = &config["themeVariables"];
        assert_eq!(variables["primaryBorderColor"], hex(light.border));
        assert_eq!(variables["fontSize"], "15px");
        assert_eq!(variables["pie2"], hex(light.success));
        // A translucent colour keeps its RGB (`resolveMermaidColor`).
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
        for n in 0..(MAX_ENTRIES as u64 + 5) {
            settle(n, State::Failed("x".into()), 0);
        }
        SERVICE.with(|s| {
            let s = s.borrow();
            assert_eq!(s.cache.len(), MAX_ENTRIES);
            assert!(!s.cache.contains_key(&0));
            assert!(s.cache.contains_key(&(MAX_ENTRIES as u64 + 4)));
        });
    }
}
