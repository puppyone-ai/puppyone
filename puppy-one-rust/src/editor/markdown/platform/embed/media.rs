//! Workspace media (`<video>`, `<audio>`, `![[clip.mp4]]`) `WebHost` lifecycle
//! managed by [`super::WindowHostPool`] (`TA-42`, `TA-51`, `TA-52`, `TODO-35`).
use super::{
    super::{
        assets,
        policy::{self, AssetFailure, MAX_WORKSPACE_ASSET_BYTES},
    },
    WindowHostPool,
};
use crate::{
    editor::{
        markdown::shared::html_surface::MediaKind,
        registry::{AssetReader, DocumentAssets},
    },
    platform::webview::{Content, Entry, Ipc, ResourceSource, Source, SourceError, url_for},
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

/// Default `<audio controls>` dimensions (`300 × 54`).
pub const AUDIO_SIZE: (f32, f32) = (300., 54.);
/// Maximum live workspace media `WebHost` instances per window.
pub const MAX_MEDIA_PER_WINDOW: usize = 8;
const IDLE: Duration = Duration::from_secs(3);
const LOADING_IDLE: Duration = Duration::from_secs(30);

/// Workspace media player key: `(editor_id, block_start, media_index, workspace_path)`.
pub type MediaKey = (EntityId, usize, usize, PathBuf);

pub struct MediaPlayer {
    host: Option<WebHost>,
    pub size: Cell<Option<(f32, f32)>>,
    failure: RefCell<Option<AssetFailure>>,
    used: Cell<Instant>,
    origin: Cell<Point<Pixels>>,
}

impl MediaPlayer {
    pub fn place(&self, bounds: Bounds<Pixels>, clip: Bounds<Pixels>, radius: f32) {
        self.origin.set(bounds.origin);
        if let Some(host) = &self.host {
            host.place_clipped(bounds, clip, radius);
        }
    }

    pub fn failure(&self) -> Option<AssetFailure> {
        self.failure.borrow().clone()
    }

    fn keep(&self) -> bool {
        let idle = self.used.get().elapsed();
        let visible = self.host.as_ref().is_some_and(WebHost::is_visible);
        visible
            || idle < IDLE
            || (self.size.get().is_none() && self.failure.borrow().is_none() && idle < LOADING_IDLE)
    }
}

/// Single-file workspace resource wrapper enforcing single-file containment and
/// `32 MiB` budget (`TA-50`, `TA-51`).
struct Clip {
    name: PathBuf,
    path: PathBuf,
    workspace: String,
    read: AssetReader,
}

impl ResourceSource for Clip {
    fn read(&self, relative: &Path) -> Option<Vec<u8>> {
        self.read_checked(relative, MAX_WORKSPACE_ASSET_BYTES).ok()
    }

    fn size(&self, relative: &Path) -> Option<u64> {
        if relative != self.name {
            return None;
        }
        let root = policy::local_workspace_root(&self.workspace)?;
        let (_, policy::ContentStamp::File { len, .. }) =
            policy::verify_workspace_file(&root, &self.path, u64::MAX).ok()?
        else {
            return None;
        };
        Some(len)
    }

    fn read_checked(&self, relative: &Path, max_bytes: u64) -> Result<Vec<u8>, SourceError> {
        if relative != self.name {
            return Err(SourceError::NotFound);
        }
        let budget = max_bytes.min(MAX_WORKSPACE_ASSET_BYTES);
        if let Some(root) = policy::local_workspace_root(&self.workspace) {
            match policy::verify_workspace_file(&root, &self.path, budget) {
                Ok(_) => {}
                Err(AssetFailure::ExceedsLimit { .. }) => return Err(SourceError::TooLarge),
                Err(_) => return Err(SourceError::NotFound),
            }
        }
        match (self.read)(&self.path) {
            Some(bytes) if bytes.len() as u64 <= budget => Ok(bytes),
            Some(_) => Err(SourceError::TooLarge),
            None => Err(SourceError::NotFound),
        }
    }
}

/// Inline HTML player page for `<video>` or `<audio>`.
pub fn media_page(kind: MediaKind, src: &str, title: Option<&str>, background: &str) -> String {
    let label = title
        .map(|t| format!(r#" aria-label="{}""#, escape_attr(t)))
        .unwrap_or_default();
    let (tag, size) = match kind {
        MediaKind::Video => (
            "video",
            "video.videoWidth+\":\"+video.videoHeight".to_owned(),
        ),
        MediaKind::Audio => ("audio", format!("\"{}:{}\"", AUDIO_SIZE.0, AUDIO_SIZE.1)),
    };
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%;background:{background};overflow:hidden}}
video,audio{{display:block;width:100%;height:100%;background:{background}}}
</style></head><body><{tag} controls preload="metadata" playsinline src="{src}"{label}></{tag}><script>
const video=document.querySelector("{tag}");
const post=(m)=>window.ipc&&window.ipc.postMessage(m);
video.addEventListener("loadedmetadata",()=>post("size:"+{size}),{{once:true}});
video.addEventListener("error",()=>post("failed"),{{once:true}});
addEventListener("wheel",(e)=>{{e.preventDefault();const k=e.deltaMode===1?16:1;post("wheel:"+e.deltaX*k+":"+e.deltaY*k+":"+e.clientX+":"+e.clientY);}},{{passive:false}});
</script></body></html>"#
    )
}

fn escape_attr(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[derive(Debug, PartialEq)]
enum IpcMessage {
    Size(f32, f32),
    Failed,
    Wheel(f32, f32, f32, f32),
}

fn parse_ipc(message: &str) -> Option<IpcMessage> {
    let mut parts = message.split(':');
    let kind = parts.next()?;
    let numbers: Vec<f32> = parts.map(|p| p.parse().ok()).collect::<Option<_>>()?;
    match (kind, numbers.as_slice()) {
        ("failed", []) => Some(IpcMessage::Failed),
        ("size", &[w, h]) if w > 0. && h > 0. => Some(IpcMessage::Size(w, h)),
        ("wheel", &[dx, dy, x, y]) => Some(IpcMessage::Wheel(dx, dy, x, y)),
        _ => None,
    }
}

pub struct MediaRequest<'a> {
    pub key: MediaKey,
    pub kind: MediaKind,
    pub title: Option<&'a str>,
    pub background: Rgba,
    pub assets: &'a DocumentAssets,
    pub dark: bool,
}

thread_local! {
    static MEDIA_PLAYERS: RefCell<HashMap<MediaKey, Rc<MediaPlayer>>> = RefCell::new(HashMap::new());
    static MEDIA_POOL: RefCell<WindowHostPool<MediaKey>> =
        RefCell::new(WindowHostPool::new(MAX_MEDIA_PER_WINDOW));
    static MEDIA_SWEEPING: Cell<bool> = const { Cell::new(false) };
}

/// Acquires or creates a bounded per-window media `WebHost` player (`TODO-35`).
pub fn get_media_player(
    request: MediaRequest,
    window: &mut Window,
    cx: &mut App,
) -> Rc<MediaPlayer> {
    let MediaRequest {
        key,
        kind,
        title,
        background,
        assets,
        dark,
    } = request;
    let window_id = window.window_handle().window_id().as_u64();
    if let Some(existing) = MEDIA_PLAYERS.with(|p| p.borrow().get(&key).cloned()) {
        existing.used.set(Instant::now());
        if existing.host.is_some() {
            MEDIA_POOL.with(|pool| {
                let _ = pool.borrow_mut().acquire(key, window_id, |_| true);
            });
        }
        return existing;
    }
    if let Err(reason) = assets::probe_workspace_media(&key.3, Some(assets)) {
        let failed = Rc::new(MediaPlayer {
            host: None,
            size: Cell::new(None),
            failure: RefCell::new(Some(reason)),
            used: Cell::new(Instant::now()),
            origin: Cell::new(Point::default()),
        });
        MEDIA_PLAYERS.with(|p| p.borrow_mut().insert(key, failed.clone()));
        sweep_media(cx);
        return failed;
    }
    let Some(file_name) = key.3.file_name().map(PathBuf::from) else {
        return Rc::new(MediaPlayer {
            host: None,
            size: Cell::new(None),
            failure: RefCell::new(Some(AssetFailure::Blocked)),
            used: Cell::new(Instant::now()),
            origin: Cell::new(Point::default()),
        });
    };
    let evicted = MEDIA_POOL.with(|pool| {
        MEDIA_PLAYERS.with(|players| {
            let map = players.borrow();
            pool.borrow_mut().acquire(key.clone(), window_id, |k| {
                map.get(k)
                    .and_then(|p| p.host.as_ref())
                    .is_none_or(|h| !h.is_visible())
            })
        })
    });
    MEDIA_PLAYERS.with(|players| {
        let mut map = players.borrow_mut();
        for victim in evicted {
            map.remove(&victim);
        }
    });

    let (tx, rx) = async_channel::unbounded::<String>();
    let content = Content {
        root: None,
        source: Some(Source(Arc::new(Clip {
            name: file_name.clone(),
            path: key.3.clone(),
            workspace: assets.workspace.clone(),
            read: assets.read.clone(),
        }))),
        entry: Entry::Html(media_page(
            kind,
            &format!("{}#t=0.001", url_for(&file_name.to_string_lossy())),
            title,
            &theme::css_hex(background),
        )),
        max_bytes: MAX_WORKSPACE_ASSET_BYTES,
        assets: vec![],
        ipc: Some(Ipc(tx)),
        policy: None,
        frames: None,
        disk_assets: None,
        locked: true,
    };
    let host = WebHost::new(window, content, dark).ok();
    let initial_failure = if host.is_some() {
        None
    } else {
        MEDIA_POOL.with(|pool| pool.borrow_mut().remove(&key));
        Some(AssetFailure::Network("Web engine unavailable".into()))
    };
    let player = Rc::new(MediaPlayer {
        host,
        size: Cell::new(None),
        failure: RefCell::new(initial_failure),
        used: Cell::new(Instant::now()),
        origin: Cell::new(Point::default()),
    });
    MEDIA_PLAYERS.with(|p| p.borrow_mut().insert(key.clone(), player.clone()));
    if player.host.is_some() {
        let weak = Rc::downgrade(&player);
        let handle = window.window_handle();
        let workspace = assets.workspace.clone();
        let rel_path = key.3.clone();
        cx.spawn(async move |cx| {
            while let Ok(message) = rx.recv().await {
                let Some(player) = weak.upgrade() else { break };
                match parse_ipc(&message) {
                    Some(IpcMessage::Size(w, h)) => {
                        player.size.set(Some((w, h)));
                        cx.update(|cx| cx.refresh_windows());
                    }
                    Some(IpcMessage::Failed) => {
                        let classified = policy::local_workspace_root(&workspace)
                            .and_then(|root| {
                                policy::verify_workspace_file(
                                    &root,
                                    &rel_path,
                                    MAX_WORKSPACE_ASSET_BYTES,
                                )
                                .err()
                            })
                            .unwrap_or(AssetFailure::InvalidFormat);
                        *player.failure.borrow_mut() = Some(classified);
                        cx.update(|cx| cx.refresh_windows());
                    }
                    Some(IpcMessage::Wheel(dx, dy, x, y)) => {
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
    }
    sweep_media(cx);
    player
}

/// Drops a failed/cached media player for `key` so the next frame retries (`TA-52`).
pub fn retry_media(key: &MediaKey, cx: &mut App) {
    MEDIA_PLAYERS.with(|p| {
        p.borrow_mut().remove(key);
    });
    MEDIA_POOL.with(|pool| pool.borrow_mut().remove(key));
    cx.refresh_windows();
}

fn sweep_media(cx: &mut App) {
    if MEDIA_SWEEPING.with(|s| s.replace(true)) {
        return;
    }
    cx.spawn(async move |cx| {
        loop {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            let empty = MEDIA_PLAYERS.with(|p| {
                let mut players = p.borrow_mut();
                let mut removed = Vec::new();
                players.retain(|k, player| {
                    let keep = player.keep();
                    if !keep {
                        removed.push(k.clone());
                    }
                    keep
                });
                if !removed.is_empty() {
                    MEDIA_POOL.with(|pool| {
                        let mut pool = pool.borrow_mut();
                        for k in &removed {
                            pool.remove(k);
                        }
                    });
                }
                players.is_empty()
            });
            if empty {
                MEDIA_SWEEPING.with(|s| s.set(false));
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
    fn media_page_and_clip_enforce_single_file_and_protocol() {
        let html = media_page(
            MediaKind::Video,
            "puppyone-preview://local/a%20b.mp4",
            Some("A \"clip\""),
            "BLACK",
        );
        assert!(html.contains(
            r#"<video controls preload="metadata" playsinline src="puppyone-preview://local/a%20b.mp4""#
        ));
        assert!(html.contains(r#"aria-label="A &quot;clip&quot;""#));
        assert!(!html.contains("autoplay"));
        let audio = media_page(MediaKind::Audio, "x.mp3", None, "BG");
        assert!(audio.contains(r#"<audio controls preload="metadata""#));
        assert_eq!(
            parse_ipc("size:1920:1080"),
            Some(IpcMessage::Size(1920., 1080.))
        );
        assert_eq!(parse_ipc("size:0:0"), None);
        assert_eq!(parse_ipc("failed"), Some(IpcMessage::Failed));

        let read: AssetReader =
            Arc::new(|path: &Path| Some(path.to_string_lossy().into_owned().into_bytes()));
        let clip = Clip {
            name: "a.mp4".into(),
            path: "media/a.mp4".into(),
            workspace: String::new(),
            read,
        };
        assert_eq!(clip.read(Path::new("a.mp4")), Some(b"media/a.mp4".to_vec()));
        assert_eq!(clip.read(Path::new("b.mp4")), None);
    }
}
