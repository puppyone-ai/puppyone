//! The players of the windows' video blocks, kept across redraws: one web
//! engine per block of a pane, loading while its block shows a placeholder
//! and placed over the block once the video's metadata is in. A player no
//! longer drawn is dropped (with its playback) a few seconds later, as the
//! product's widget is when it leaves the viewport.
use crate::{
    editor::registry::{AssetReader, DocumentAssets},
    platform::webview::{Content, Entry, Ipc, ResourceSource, Source, url_for},
    theme,
    web_host::WebHost,
};
use gpui::*;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};

/// The video viewer's budget (`viewers/media`).
const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// A player not drawn this long is dropped; one still loading waits longer
/// (its window may not redraw until the metadata is in).
const IDLE: Duration = Duration::from_secs(3);
const LOADING_IDLE: Duration = Duration::from_secs(30);

/// A pane (its editor), the block's start and the video's workspace path.
pub type Key = (EntityId, usize, PathBuf);

pub struct Player {
    host: WebHost,
    /// The video's natural size, once its metadata loaded.
    pub size: Cell<Option<(f32, f32)>>,
    /// The engine could not play it.
    pub failed: Cell<bool>,
    used: Cell<Instant>,
    /// Where the player was last placed (window coordinates).
    origin: Cell<Point<Pixels>>,
}

impl Player {
    /// From the block's paint: over `bounds`, within the content mask.
    pub fn place(&self, bounds: Bounds<Pixels>, clip: Bounds<Pixels>, radius: f32) {
        self.origin.set(bounds.origin);
        self.host.place_clipped(bounds, clip, radius);
    }

    fn keep(&self) -> bool {
        let idle = self.used.get().elapsed();
        self.host.is_visible()
            || idle < IDLE
            || (self.size.get().is_none() && !self.failed.get() && idle < LOADING_IDLE)
    }
}

thread_local! {
    static PLAYERS: RefCell<HashMap<Key, Rc<Player>>> = RefCell::new(HashMap::new());
    static SWEEPING: Cell<bool> = const { Cell::new(false) };
}

/// The file the page plays, by its workspace path.
struct Clip {
    name: PathBuf,
    path: PathBuf,
    read: AssetReader,
}
impl ResourceSource for Clip {
    fn read(&self, relative: &Path) -> Option<Vec<u8>> {
        (relative == self.name)
            .then(|| (self.read)(&self.path))
            .flatten()
    }
}

/// The page: the video filling its frame with the engine's controls. It
/// reports its natural size (`loadedmetadata`) or `failed` (`error`), and
/// hands wheel scrolling to the document around it.
pub fn page(src: &str, title: Option<&str>, black: &str) -> String {
    let label = title
        .map(|t| format!(r#" aria-label="{}""#, escape(t)))
        .unwrap_or_default();
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%;background:{black};overflow:hidden}}
video{{display:block;width:100%;height:100%;background:{black}}}
</style></head><body><video controls preload="metadata" playsinline src="{src}"{label}></video><script>
const video=document.querySelector("video");
const post=(m)=>window.ipc&&window.ipc.postMessage(m);
video.addEventListener("loadedmetadata",()=>post("size:"+video.videoWidth+":"+video.videoHeight),{{once:true}});
video.addEventListener("error",()=>post("failed"),{{once:true}});
addEventListener("wheel",(e)=>{{e.preventDefault();const k=e.deltaMode===1?16:1;post("wheel:"+e.deltaX*k+":"+e.deltaY*k+":"+e.clientX+":"+e.clientY);}},{{passive:false}});
</script></body></html>"#
    )
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// What the page said.
#[derive(Debug, PartialEq)]
enum Message {
    Size(f32, f32),
    Failed,
    /// Wheel deltas (DOM: positive scrolls down) at a point in the page.
    Wheel(f32, f32, f32, f32),
}
fn parse(message: &str) -> Option<Message> {
    let mut parts = message.split(':');
    let kind = parts.next()?;
    let numbers: Vec<f32> = parts.map(|p| p.parse().ok()).collect::<Option<_>>()?;
    match (kind, numbers.as_slice()) {
        ("failed", []) => Some(Message::Failed),
        ("size", &[w, h]) if w > 0. && h > 0. => Some(Message::Size(w, h)),
        ("wheel", &[dx, dy, x, y]) => Some(Message::Wheel(dx, dy, x, y)),
        _ => None,
    }
}

/// The player of `key`, starting it the first time it is asked for;
/// `None` where the engine cannot run.
pub fn get(
    key: Key,
    title: Option<&str>,
    assets: &DocumentAssets,
    dark: bool,
    window: &mut Window,
    cx: &mut App,
) -> Option<Rc<Player>> {
    if let Some(player) = PLAYERS.with(|p| p.borrow().get(&key).cloned()) {
        player.used.set(Instant::now());
        return Some(player);
    }
    let name = PathBuf::from(key.2.file_name()?);
    let (tx, rx) = async_channel::unbounded::<String>();
    let content = Content {
        root: None,
        source: Some(Source(Arc::new(Clip {
            name: name.clone(),
            path: key.2.clone(),
            read: assets.read.clone(),
        }))),
        entry: Entry::Html(page(
            // A media fragment past zero: WebKit then draws the first
            // frame, as Chromium does for `preload="metadata"`.
            &format!("{}#t=0.001", url_for(&name.to_string_lossy())),
            title,
            &theme::css_hex(theme::video_black()),
        )),
        max_bytes: MAX_BYTES,
        assets: vec![],
        ipc: Some(Ipc(tx)),
        policy: None,
        frames: None,
        disk_assets: None,
        locked: true,
    };
    let host = WebHost::new(window, content, dark).ok()?;
    let player = Rc::new(Player {
        host,
        size: Cell::new(None),
        failed: Cell::new(false),
        used: Cell::new(Instant::now()),
        origin: Cell::new(Point::default()),
    });
    PLAYERS.with(|p| p.borrow_mut().insert(key, player.clone()));
    let weak = Rc::downgrade(&player);
    let handle = window.window_handle();
    cx.spawn(async move |cx| {
        while let Ok(message) = rx.recv().await {
            let Some(player) = weak.upgrade() else { break };
            match parse(&message) {
                Some(Message::Size(w, h)) => {
                    player.size.set(Some((w, h)));
                    cx.update(|cx| cx.refresh_windows());
                }
                Some(Message::Failed) => {
                    player.failed.set(true);
                    cx.update(|cx| cx.refresh_windows());
                }
                Some(Message::Wheel(dx, dy, x, y)) => {
                    let origin = player.origin.get();
                    let _ = cx.update_window(handle, |_, window, cx| {
                        window.dispatch_event(
                            PlatformInput::ScrollWheel(ScrollWheelEvent {
                                position: origin + point(px(x), px(y)),
                                delta: ScrollDelta::Pixels(point(px(-dx), px(-dy))),
                                modifiers: Modifiers::default(),
                                touch_phase: TouchPhase::Moved,
                            }),
                            cx,
                        );
                    });
                }
                None => {}
            }
        }
    })
    .detach();
    sweep(cx);
    Some(player)
}

/// Drops players no longer drawn, while there are any.
fn sweep(cx: &mut App) {
    if SWEEPING.with(|s| s.replace(true)) {
        return;
    }
    cx.spawn(async move |cx| {
        loop {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            let empty = PLAYERS.with(|p| {
                let mut players = p.borrow_mut();
                players.retain(|_, player| player.keep());
                players.is_empty()
            });
            if empty {
                SWEEPING.with(|s| s.set(false));
                break;
            }
        }
    })
    .detach();
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_page_plays_the_served_file_and_reports_back() {
        let html = page(
            "puppyone-preview://local/a%20b.mp4",
            Some("A \"clip\""),
            "BLACK",
        );
        assert!(html.contains(r#"<video controls preload="metadata" playsinline src="puppyone-preview://local/a%20b.mp4""#));
        assert!(html.contains(r#"aria-label="A &quot;clip&quot;""#));
        assert!(html.contains("background:BLACK"));
        assert_eq!(parse("size:1920:1080"), Some(Message::Size(1920., 1080.)));
        assert_eq!(parse("size:0:0"), None, "no picture, no size");
        assert_eq!(parse("failed"), Some(Message::Failed));
        assert_eq!(
            parse("wheel:0:-12.5:10:20"),
            Some(Message::Wheel(0., -12.5, 10., 20.))
        );
        assert_eq!(parse("wheel:x"), None);
    }

    #[test]
    fn a_clip_serves_only_its_own_file() {
        let read: AssetReader =
            Arc::new(|path: &Path| Some(path.to_string_lossy().into_owned().into_bytes()));
        let clip = Clip {
            name: "a.mp4".into(),
            path: "media/a.mp4".into(),
            read,
        };
        assert_eq!(clip.read(Path::new("a.mp4")), Some(b"media/a.mp4".to_vec()));
        assert_eq!(clip.read(Path::new("b.mp4")), None);
    }
}
