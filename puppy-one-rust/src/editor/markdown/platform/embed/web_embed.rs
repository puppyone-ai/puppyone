//! External `https:` web embeds (`<iframe src="https://…"></iframe>`):
//! click-to-load, single DNS resolution + pinned HTTPS preflight (`TA-50`),
//! bounded per-window `WebHost` pool (`TODO-35`), and visible fallback + Retry
//! (`TA-52`).
use super::{
    super::{assets, link, policy},
    WindowHostPool,
};
use crate::{
    editor::{
        markdown::{shared::widgets::fallback::action_pill, style::MarkdownTheme},
        view::editor::EditorView,
    },
    localization::{t, tf},
    platform::webview::{Content, Entry, Frames},
    theme::{self, Theme},
    web_host::WebHost,
};
use gpui::{prelude::*, *};
use regex::Regex;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
    sync::LazyLock,
    time::{Duration, Instant},
};

/// Maximum loaded external web embeds per window (`DEFAULT_MAX_EMBEDS_PER_OWNER`).
pub const MAX_WEB_EMBEDS_PER_WINDOW: usize = 8;
const WEB_EMBED_MAX_HEIGHT: f32 = 480.;
const BUTTON_HEIGHT: f32 = 28.;
const PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(10);
const IDLE: Duration = Duration::from_secs(3);

type WebEmbedKey = (EntityId, usize, String);

/// `compileExternalWebEmbedIntent`: extracts the `https:` URL of a lone
/// `<iframe>` block with only a `src` attribute.
pub fn external_iframe_href(source: &str) -> Option<String> {
    static IFRAME: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r#"(?is)^\s*<iframe\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))\s*(?:/>|>\s*</iframe\s*>)\s*$"#,
        )
        .unwrap()
    });
    let c = IFRAME.captures(source)?;
    let raw = c.get(1).or(c.get(2)).or(c.get(3))?.as_str();
    let href = link::safe_href(raw)?;
    href.starts_with("https://").then_some(href)
}

pub fn web_embed_entry_page(href: &str) -> String {
    let target = serde_json::to_string(href).unwrap_or_default();
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"></head><body><script>location.replace({target});</script></body></html>"#
    )
}

#[derive(Clone, PartialEq, Eq)]
enum WebEmbedState {
    ClickToLoad,
    Loading,
    Loaded,
    Failed(SharedString),
}

struct WebEmbedSlot {
    state: RefCell<WebEmbedState>,
    host: RefCell<Option<WebHost>>,
    used: Cell<Instant>,
    window: AnyWindowHandle,
    window_id: u64,
}

thread_local! {
    static WEB_EMBEDS: RefCell<HashMap<WebEmbedKey, Rc<WebEmbedSlot>>> =
        RefCell::new(HashMap::new());
    static WEB_EMBED_POOL: RefCell<WindowHostPool<WebEmbedKey>> =
        RefCell::new(WindowHostPool::new(MAX_WEB_EMBEDS_PER_WINDOW));
    static WEB_EMBED_SWEEPING: Cell<bool> = const { Cell::new(false) };
}

/// Validates DNS once and performs a DNS-pinned HTTPS preflight check
/// (`ClientBuilder::resolve(host, validated_socket_addr)`), refusing
/// private/loopback targets and cross-origin redirects (`TA-50`).
fn preflight_pinned_embed(href: &str) -> Result<String, SharedString> {
    let endpoint = policy::resolve_public_endpoint(href)?;
    let client = policy::build_pinned_https_client(&endpoint, PREFLIGHT_TIMEOUT, true)?;
    let runtime =
        assets::shared_runtime().ok_or_else(|| SharedString::from("Runtime unavailable"))?;
    runtime.block_on(async {
        let response = client
            .get(endpoint.url.as_str())
            .send()
            .await
            .map_err(|e| SharedString::from(e.to_string()))?;
        let final_url = response.url();
        if !policy::redirect_allowed(&endpoint.url, final_url, true) {
            return Err("Embed redirect blocked by security policy".into());
        }
        if response.status().is_server_error()
            || response.status() == reqwest::StatusCode::NOT_FOUND
        {
            return Err(format!("HTTP {}", response.status().as_u16()).into());
        }
        Ok(endpoint.url.origin().ascii_serialization())
    })
}

fn activate_web_embed(
    key: WebEmbedKey,
    slot: Rc<WebEmbedSlot>,
    href: String,
    dark: bool,
    cx: &mut App,
) {
    if matches!(
        *slot.state.borrow(),
        WebEmbedState::Loading | WebEmbedState::Loaded
    ) {
        return;
    }
    *slot.state.borrow_mut() = WebEmbedState::Loading;
    cx.refresh_windows();
    let check_href = href.clone();
    let task = cx
        .background_executor()
        .spawn(async move { preflight_pinned_embed(&check_href) });
    cx.spawn(async move |cx| {
        let preflight = task.await;
        let _ = cx.update_window(slot.window, |_, window, cx| {
            match preflight {
                Ok(origin) => {
                    let evicted = WEB_EMBED_POOL.with(|pool| {
                        WEB_EMBEDS.with(|embeds| {
                            let map = embeds.borrow();
                            pool.borrow_mut().acquire(key.clone(), slot.window_id, |k| {
                                map.get(k)
                                    .and_then(|s| s.host.borrow().as_ref().map(WebHost::is_visible))
                                    .is_none_or(|vis| !vis)
                            })
                        })
                    });
                    WEB_EMBEDS.with(|embeds| {
                        let map = embeds.borrow();
                        for victim in evicted {
                            if let Some(old) = map.get(&victim) {
                                *old.host.borrow_mut() = None;
                                *old.state.borrow_mut() = WebEmbedState::ClickToLoad;
                            }
                        }
                    });
                    let frames = Frames::default();
                    frames.allow(&origin);
                    let host = WebHost::new(
                        window,
                        Content {
                            root: None,
                            source: None,
                            entry: Entry::Html(web_embed_entry_page(&href)),
                            max_bytes: 0,
                            assets: vec![],
                            ipc: None,
                            policy: None,
                            frames: Some(frames),
                            disk_assets: None,
                            locked: true,
                        },
                        dark,
                    );
                    match host {
                        Ok(host) => {
                            *slot.host.borrow_mut() = Some(host);
                            *slot.state.borrow_mut() = WebEmbedState::Loaded;
                        }
                        Err(err) => {
                            WEB_EMBED_POOL.with(|pool| pool.borrow_mut().remove(&key));
                            *slot.host.borrow_mut() = None;
                            *slot.state.borrow_mut() = WebEmbedState::Failed(err.into());
                        }
                    }
                }
                Err(reason) => {
                    *slot.host.borrow_mut() = None;
                    *slot.state.borrow_mut() = WebEmbedState::Failed(reason);
                }
            }
            slot.used.set(Instant::now());
            cx.refresh_windows();
        });
    })
    .detach();
}

fn sweep_web_embeds(cx: &mut App) {
    if WEB_EMBED_SWEEPING.with(|s| s.replace(true)) {
        return;
    }
    cx.spawn(async move |cx| {
        loop {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            let empty = WEB_EMBEDS.with(|e| {
                let mut embeds = e.borrow_mut();
                let mut removed = Vec::new();
                embeds.retain(|k, slot| {
                    let keep = slot.used.get().elapsed() < IDLE
                        || slot.host.borrow().as_ref().is_some_and(WebHost::is_visible);
                    if !keep {
                        removed.push(k.clone());
                    }
                    keep
                });
                if !removed.is_empty() {
                    WEB_EMBED_POOL.with(|pool| {
                        let mut pool = pool.borrow_mut();
                        for k in &removed {
                            pool.remove(k);
                        }
                    });
                }
                embeds.is_empty()
            });
            if empty {
                WEB_EMBED_SWEEPING.with(|s| s.set(false));
                break;
            }
        }
    })
    .detach();
}

/// Renders an external `<iframe>` embed slot with click-to-load, DNS-pinned
/// preflight, and visible fallback + Retry on failure (`TA-50`, `TA-52`).
#[allow(clippy::too_many_arguments)]
pub fn render_web_embed(
    view: &WeakEntity<EditorView>,
    block: usize,
    href: &str,
    width: f32,
    theme: &MarkdownTheme,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let (radius, dark) = (theme.block.radius, theme.dark);
    let app = Theme::new(dark);
    let meta = theme::ty().ui.meta;
    let Some(canonical) = policy::allowed_https_href(href) else {
        return div()
            .py(px(8.))
            .text_size(px(meta))
            .text_color(app.muted)
            .child(t("editor.markdown.html.embedBlocked"))
            .into_any_element();
    };
    let window_id = window.window_handle().window_id().as_u64();
    let key = (view.entity_id(), block, canonical.clone());
    let slot = WEB_EMBEDS.with(|e| {
        e.borrow_mut()
            .entry(key.clone())
            .or_insert_with(|| {
                Rc::new(WebEmbedSlot {
                    state: RefCell::new(WebEmbedState::ClickToLoad),
                    host: RefCell::new(None),
                    used: Cell::new(Instant::now()),
                    window: window.window_handle(),
                    window_id,
                })
            })
            .clone()
    });
    slot.used.set(Instant::now());
    sweep_web_embeds(cx);
    let state = slot.state.borrow().clone();
    match state {
        WebEmbedState::Loaded => {
            let height = (width * 9. / 16.).min(WEB_EMBED_MAX_HEIGHT);
            let placed = slot;
            div()
                .w(px(width))
                .h(px(height))
                .rounded(px(radius))
                .bg(app.inset)
                .child(
                    canvas(
                        |_, _, _| {},
                        move |bounds, _, window, _| {
                            if let Some(host) = placed.host.borrow().as_ref() {
                                host.place_clipped(bounds, window.content_mask().bounds, radius);
                            }
                        },
                    )
                    .size_full(),
                )
                .into_any_element()
        }
        WebEmbedState::Failed(reason) => {
            let retry_slot = slot;
            let retry_key = key;
            let retry_href = canonical;
            let detail = tf(
                "editor.resource.loadFailed",
                &[
                    ("kind", "embed".into()),
                    ("detail", crate::localization::bidi_isolate(&reason).into()),
                ],
            );
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .py(px(6.))
                .px(px(10.))
                .w(px(width))
                .rounded(px(radius))
                .border_1()
                .border_color(app.border_subtle)
                .bg(app.panel)
                .text_size(px(meta))
                .text_color(app.muted)
                .child(div().min_w_0().truncate().child(SharedString::from(detail)))
                .child(action_pill(
                    ElementId::NamedInteger("md-web-embed-retry".into(), block as u64),
                    t("common.action.retry"),
                    dark,
                    move |_, cx| {
                        activate_web_embed(
                            retry_key.clone(),
                            retry_slot.clone(),
                            retry_href.clone(),
                            dark,
                            cx,
                        );
                    },
                ))
                .into_any_element()
        }
        other => {
            let loading = other == WebEmbedState::Loading;
            let text = if loading {
                t("shared-ui.loading").to_owned()
            } else {
                tf(
                    "editor.markdown.html.loadEmbed",
                    &[("href", crate::localization::bidi_isolate(&canonical).into())],
                )
            };
            let click_key = key;
            div()
                .flex()
                .py(px(4.))
                .child(
                    div()
                        .id(ElementId::NamedInteger("md-web-embed".into(), block as u64))
                        .debug_selector(move || {
                            format!(
                                "md-web-embed:{}",
                                if loading { "loading" } else { "click-to-load" }
                            )
                        })
                        .flex()
                        .items_center()
                        .h(px(BUTTON_HEIGHT))
                        .max_w(px(width))
                        .px(px(10.))
                        .rounded(px(radius))
                        .border_1()
                        .border_color(app.border)
                        .bg(app.panel)
                        .text_size(px(meta))
                        .text_color(if loading { app.muted } else { app.text })
                        .overflow_hidden()
                        .child(div().truncate().child(SharedString::from(text)))
                        .when(!loading, |b| {
                            b.cursor(theme::clickable_cursor())
                                .hover(|s| s.bg(app.hover))
                                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                                .on_click(move |_, _, cx| {
                                    cx.stop_propagation();
                                    activate_web_embed(
                                        click_key.clone(),
                                        slot.clone(),
                                        canonical.clone(),
                                        dark,
                                        cx,
                                    );
                                })
                        }),
                )
                .into_any_element()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn lone_https_iframe_and_pinned_client_follow_policy() {
        assert_eq!(
            external_iframe_href(r#"<iframe src="https://www.youtube.com/embed/x"></iframe>"#)
                .as_deref(),
            Some("https://www.youtube.com/embed/x")
        );
        assert_eq!(
            external_iframe_href("<IFRAME SRC='https://a.test/p?a=1&amp;b=2' />").as_deref(),
            Some("https://a.test/p?a=1&b=2")
        );
        assert_eq!(
            external_iframe_href(r#"<iframe src="http://a.test"></iframe>"#),
            None
        );
        assert_eq!(
            external_iframe_href(r#"<iframe src="https://a.test" width="5"></iframe>"#),
            None
        );

        let endpoint = policy::ValidatedEndpoint {
            url: url::Url::parse("https://example.com/embed").unwrap(),
            host: "example.com".into(),
            addrs: vec!["93.184.216.34:443".parse().unwrap()],
        };
        assert!(policy::build_pinned_https_client(&endpoint, Duration::from_secs(5), true).is_ok());
    }
}
