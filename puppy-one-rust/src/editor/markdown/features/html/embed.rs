//! External web embeds (`compileExternalWebEmbedIntent`,
//! markdown-web-embed-policy / -service): an HTML block that is exactly
//! `<iframe src="https://…"></iframe>` asks to show that page. It loads
//! only on a click ("Load content from …"), never from a private or
//! loopback host — by its name, and by every address it resolves to — in
//! an ephemeral engine without credentials, cut to the editor's view. The
//! page may move within its own origin; other navigations are refused
//! (a new window, a link's own choice, opens in the browser). A loaded page sits in a 16:9 panel of the column, at most 480px
//! tall (the product sizes it to its one-line wrapper).
use crate::{
    editor::{markdown::style::MarkdownTheme, view::editor::EditorView},
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
    net::{IpAddr, Ipv4Addr, ToSocketAddrs},
    rc::Rc,
    sync::LazyLock,
    time::{Duration, Instant},
};

/// A loaded page's panel: 16:9 of the column, at most this tall.
const MAX_HEIGHT: f32 = 480.;
/// `.cm-md-html-web-embed-load`: a control-height button.
const BUTTON_HEIGHT: f32 = 28.;
/// `DEFAULT_MAX_EMBEDS_PER_OWNER`, here per window.
const MAX_LOADED: usize = 8;
/// An embed no longer drawn is dropped (with its page) after this.
const IDLE: Duration = Duration::from_secs(3);
/// `LOCAL_HOST_SUFFIXES`.
const LOCAL_SUFFIXES: &[&str] = &[".localhost", ".local", ".home.arpa"];

/// `compileExternalWebEmbedIntent`: the `https:` page a block that is only
/// an `<iframe>` with a `src` (and nothing else) asks for.
pub fn external_href(source: &str) -> Option<String> {
    static IFRAME: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r#"(?is)^\s*<iframe\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))\s*(?:/>|>\s*</iframe\s*>)\s*$"#,
        )
        .unwrap()
    });
    let c = IFRAME.captures(source)?;
    let raw = c.get(1).or(c.get(2)).or(c.get(3))?.as_str();
    let href = crate::editor::markdown::navigation::safe_href(raw)?;
    href.starts_with("https://").then_some(href)
}

/// `assertMarkdownWebEmbedHref`: the canonical URL, if it may load at all.
pub fn allowed(href: &str) -> Option<String> {
    let url = url::Url::parse(href).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = match url.host()? {
        url::Host::Domain(name) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            if name.is_empty()
                || name == "localhost"
                || LOCAL_SUFFIXES.iter().any(|s| name.ends_with(s))
            {
                return None;
            }
            None
        }
        url::Host::Ipv4(ip) => Some(IpAddr::V4(ip)),
        url::Host::Ipv6(ip) => Some(IpAddr::V6(ip)),
    };
    if host.is_some_and(|ip| !is_public(ip)) {
        return None;
    }
    Some(url.to_string())
}

/// `isPublicIpAddress`.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_v4(ip),
        IpAddr::V6(ip) => {
            let w = ip.segments();
            // Mapped and compatible forms are their IPv4 address.
            if w[..5].iter().all(|w| *w == 0) && (w[5] == 0xffff || w[5] == 0) {
                let [a, b] = w[6].to_be_bytes();
                let [c, d] = w[7].to_be_bytes();
                return public_v4(Ipv4Addr::new(a, b, c, d));
            }
            (w[0] & 0xe000) == 0x2000
                && !(w[0] == 0x2001 && matches!(w[1], 0x0db8 | 0x0000 | 0x0002))
                && w[0] != 0x2002
        }
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || (a == 100 && (64..=127).contains(&b))
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && (c == 0 || c == 2))
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

/// `assertMarkdownWebEmbedNetworkTarget`: every address the host resolves
/// to is public (blocking; off the foreground thread).
fn resolves_publicly(href: &str) -> bool {
    let Ok(url) = url::Url::parse(href) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    match (host, url.port_or_known_default().unwrap_or(443)).to_socket_addrs() {
        Ok(addresses) => {
            let addresses: Vec<_> = addresses.collect();
            !addresses.is_empty() && addresses.iter().all(|a| is_public(a.ip()))
        }
        Err(_) => false,
    }
}

/// The page that hands the engine to the embed (the entry document leaves
/// for it at once).
fn page(href: &str) -> String {
    let target = serde_json::to_string(href).unwrap_or_default();
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"></head><body><script>location.replace({target});</script></body></html>"#
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    ClickToLoad,
    Loading,
    Loaded,
}

struct Embed {
    state: Cell<State>,
    host: RefCell<Option<WebHost>>,
    used: Cell<Instant>,
    window: AnyWindowHandle,
}

type Key = (EntityId, usize, String);

thread_local! {
    static EMBEDS: RefCell<HashMap<Key, Rc<Embed>>> = RefCell::new(HashMap::new());
    static SWEEPING: Cell<bool> = const { Cell::new(false) };
}

fn loaded_in(window: AnyWindowHandle) -> usize {
    EMBEDS.with(|e| {
        e.borrow()
            .values()
            .filter(|e| e.window == window && e.host.borrow().is_some())
            .count()
    })
}

/// Load `href` into `embed` once its host is known to be public.
fn activate(embed: Rc<Embed>, href: String, dark: bool, cx: &mut App) {
    if embed.state.get() != State::ClickToLoad || loaded_in(embed.window) >= MAX_LOADED {
        return;
    }
    embed.state.set(State::Loading);
    cx.refresh_windows();
    let check = href.clone();
    let task = cx
        .background_executor()
        .spawn(async move { resolves_publicly(&check) });
    cx.spawn(async move |cx| {
        let public = task.await;
        let origin = url::Url::parse(&href)
            .map(|u| u.origin().ascii_serialization())
            .unwrap_or_default();
        let _ = cx.update_window(embed.window, |_, window, cx| {
            let host = public
                .then(|| {
                    let frames = Frames::default();
                    frames.allow(&origin);
                    WebHost::new(
                        window,
                        Content {
                            root: None,
                            source: None,
                            entry: Entry::Html(page(&href)),
                            max_bytes: 0,
                            assets: vec![],
                            ipc: None,
                            policy: None,
                            frames: Some(frames),
                            disk_assets: None,
                            // A redirect or link elsewhere is refused
                            // (`will-redirect`), never opened for it.
                            locked: true,
                        },
                        dark,
                    )
                    .ok()
                })
                .flatten();

            // A refused or unreachable target is clickable again.
            embed.state.set(if host.is_some() {
                State::Loaded
            } else {
                State::ClickToLoad
            });
            *embed.host.borrow_mut() = host;
            embed.used.set(Instant::now());
            cx.refresh_windows();
        });
    })
    .detach();
}

/// Drops loaded embeds no longer drawn, while there are any.
fn sweep(cx: &mut App) {
    if SWEEPING.with(|s| s.replace(true)) {
        return;
    }
    cx.spawn(async move |cx| {
        loop {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            let empty = EMBEDS.with(|e| {
                let mut embeds = e.borrow_mut();
                embeds.retain(|_, embed| {
                    embed.used.get().elapsed() < IDLE
                        || embed
                            .host
                            .borrow()
                            .as_ref()
                            .is_some_and(WebHost::is_visible)
                });
                embeds.is_empty()
            });
            if empty {
                SWEEPING.with(|s| s.set(false));
                break;
            }
        }
    })
    .detach();
}

/// The embed of the block at `block` in `view`'s pane, `width` wide.
pub fn render(
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
    let Some(canonical) = allowed(href) else {
        return div()
            .py(px(8.))
            .text_size(px(meta))
            .text_color(app.muted)
            .child(t("editor.markdown.html.embedBlocked"))
            .into_any_element();
    };
    let key = (view.entity_id(), block, canonical.clone());
    let embed = EMBEDS.with(|e| {
        e.borrow_mut()
            .entry(key)
            .or_insert_with(|| {
                Rc::new(Embed {
                    state: Cell::new(State::ClickToLoad),
                    host: RefCell::new(None),
                    used: Cell::new(Instant::now()),
                    window: window.window_handle(),
                })
            })
            .clone()
    });
    embed.used.set(Instant::now());
    sweep(cx);
    let label = |key| {
        tf(
            key,
            &[("href", crate::localization::bidi_isolate(&canonical).into())],
        )
    };
    match embed.state.get() {
        State::Loaded => {
            let height = (width * 9. / 16.).min(MAX_HEIGHT);
            let placed = embed.clone();
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
        state => {
            let loading = state == State::Loading;
            let text = if loading {
                t("shared-ui.loading").to_owned()
            } else {
                label("editor.markdown.html.loadEmbed")
            };
            div()
                .flex()
                .py(px(4.))
                .child(
                    div()
                        .id(ElementId::NamedInteger("md-web-embed".into(), block as u64))
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
                                // The editor would take the press as a caret.
                                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                                .on_click(move |_, _, cx| {
                                    cx.stop_propagation();
                                    activate(embed.clone(), canonical.clone(), dark, cx);
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
    fn only_a_lone_https_iframe_is_an_embed() {
        let embed = |s: &str| external_href(s);
        assert_eq!(
            embed(r#"<iframe src="https://www.youtube.com/embed/x"></iframe>"#).as_deref(),
            Some("https://www.youtube.com/embed/x")
        );
        assert_eq!(
            embed("<IFRAME SRC='https://a.test/p?a=1&amp;b=2' />").as_deref(),
            Some("https://a.test/p?a=1&b=2")
        );
        assert_eq!(embed(r#"<iframe src="http://a.test"></iframe>"#), None);
        assert_eq!(
            embed(r#"<iframe src="https://a.test" width="5"></iframe>"#),
            None,
            "one attribute only"
        );
        assert_eq!(embed(r#"<iframe src="https://a.test">"#), None, "unclosed");
        assert_eq!(embed(r#"x <iframe src="https://a.test"></iframe>"#), None);
    }

    #[test]
    fn private_and_local_targets_never_load() {
        assert!(allowed("https://example.com/a").is_some());
        for href in [
            "https://localhost/",
            "https://printer.local/",
            "https://router.home.arpa/",
            "https://127.0.0.1/",
            "https://10.1.2.3/",
            "https://192.168.1.1/",
            "https://[::1]/",
            "https://[::ffff:127.0.0.1]/",
            "https://user:pw@example.com/",
            "http://example.com/",
        ] {
            assert!(allowed(href).is_none(), "{href}");
        }
        assert!(is_public("8.8.8.8".parse().unwrap()));
        assert!(!is_public("100.64.0.1".parse().unwrap()));
        assert!(!is_public("169.254.1.1".parse().unwrap()));
        assert!(!is_public("224.0.0.1".parse().unwrap()));
        assert!(is_public("2606:4700::1111".parse().unwrap()));
        assert!(!is_public("2001:db8::1".parse().unwrap()));
        assert!(!is_public("fe80::1".parse().unwrap()));
        assert!(!is_public("2002::1".parse().unwrap()));
    }

    #[test]
    fn the_entry_page_leaves_for_the_embed() {
        assert!(page("https://a.test/\"x").contains(r#"location.replace("https://a.test/\"x")"#));
    }
}
