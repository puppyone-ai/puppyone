//! HTML media (`<img>`, `<picture>`, `<svg>`, `<video>`, `<audio>`) rendered
//! directly through `platform::assets` and `platform::embed` (`MA-09`, `MA-14`).
use super::{Inherit, Surface};
use crate::editor::{
    markdown::{
        features::html::sanitize::{Element, MAX_HTML_DEPTH, Node},
        platform::{assets, embed},
        shared::media::{self, MediaKind, MediaSource, MediaSourceError},
    },
    tokens::Tokens,
};
use gpui::{prelude::*, *};
use std::path::Path;

impl Surface<'_, '_, '_> {
    fn render_media_player(
        &mut self,
        kind: MediaKind,
        path: Option<&Path>,
        title: Option<&str>,
        dims: (Option<f32>, Option<f32>),
        index: usize,
        available: f32,
    ) -> Option<AnyElement> {
        let (path, doc_assets, view) = (path?, self.assets?, self.view.upgrade()?);
        let t = Tokens::get(self.theme.dark, self.theme.scale);
        let background = match kind {
            MediaKind::Video => t.color("--po-md-media-background"),
            MediaKind::Audio => t.color("--po-editor-bg"),
        };
        let player = embed::get_media_player(
            embed::MediaRequest {
                key: (view.entity_id(), self.block, index, path.to_path_buf()),
                kind,
                title,
                background,
                assets: doc_assets,
                dark: self.theme.dark,
            },
            self.render.window,
            self.render.app,
        );
        if player.failure().is_some() {
            return None;
        }
        let (width, height, radius) = match kind {
            MediaKind::Audio => (embed::AUDIO_SIZE.0.min(available), embed::AUDIO_SIZE.1, 0.),
            MediaKind::Video => {
                let (nw, nh) = player.size.get().unwrap_or((300., 150.));
                let (mut w, mut h) = match dims {
                    (Some(w), Some(h)) => (w, h),
                    (Some(w), None) => (w, w * nh / nw),
                    (None, Some(h)) => (h * nw / nh, h),
                    (None, None) => (nw, nh),
                };
                if w > available {
                    h *= available / w;
                    w = available;
                }
                let viewport = f32::from(self.render.window.viewport_size().height);
                let cap = (viewport * 0.7).min(720.);
                if h > cap {
                    w *= cap / h;
                    h = cap;
                }
                (w, h, self.theme.block.radius)
            }
        };
        let ready = player.size.get().is_some();
        Some(
            div()
                .w(px(width))
                .h(px(height))
                .rounded(px(radius))
                .bg(background)
                .child(
                    canvas(
                        |_, _, _| {},
                        move |bounds, _, window, _| {
                            if ready {
                                player.place(bounds, window.content_mask().bounds, radius);
                            }
                        },
                    )
                    .size_full(),
                )
                .into_any_element(),
        )
    }

    pub(super) fn media(&mut self, e: &Element, inherit: &Inherit, available: f32) -> AnyElement {
        let src = e.attribute("src").map(str::to_owned).or_else(|| {
            e.children.iter().find_map(|c| match c {
                Node::Element(s) if s.tag == "source" => s.attribute("src").map(str::to_owned),
                _ => None,
            })
        });
        let index = self.media;
        self.media += 1;
        let path = match src
            .as_deref()
            .and_then(|s| media::markdown(self.document, s))
        {
            Some(MediaSource::Workspace(path)) => Some(path),
            _ => None,
        };
        let kind = if e.tag == "video" {
            MediaKind::Video
        } else {
            MediaKind::Audio
        };
        let number = |name: &str| e.attribute(name).and_then(dimension);
        if let Some(rendered) = self.render_media_player(
            kind,
            path.as_deref(),
            e.attribute("title"),
            (number("width"), number("height")),
            index,
            available,
        ) {
            return rendered;
        }
        let name = src
            .as_deref()
            .and_then(|s| s.rsplit('/').next())
            .unwrap_or(&e.tag)
            .to_owned();
        self.chip(
            &format!("{} · {name}", if e.tag == "video" { "▶" } else { "♪" }),
            inherit,
        )
    }

    pub(super) fn image(&mut self, e: &Element, inherit: &Inherit, available: f32) -> AnyElement {
        let (src, attrs) = match e.tag.as_str() {
            "picture" => {
                let img = e.children.iter().find_map(|c| match c {
                    Node::Element(i) if i.tag == "img" => Some(i),
                    _ => None,
                });
                let source = e.children.iter().find_map(|c| match c {
                    Node::Element(s) if s.tag == "source" => {
                        s.attribute("srcset").map(str::to_owned)
                    }
                    _ => None,
                });
                (
                    img.and_then(|i| i.attribute("src").map(str::to_owned))
                        .or_else(|| source.as_deref().and_then(best_candidate)),
                    img.unwrap_or(e),
                )
            }
            _ => (
                e.attribute("src")
                    .map(str::to_owned)
                    .or_else(|| e.attribute("srcset").and_then(best_candidate)),
                e,
            ),
        };
        let number = |name: &str| attrs.attribute(name).and_then(dimension);
        let resolved = if e.tag == "svg" {
            Ok(MediaSource::Data(serialize(e).into_bytes()))
        } else {
            match src.as_deref() {
                Some(s) => media::resolve_markdown_media(self.document, s),
                None => Err(MediaSourceError::Empty),
            }
        };
        let label = attrs
            .attribute("alt")
            .map(str::to_owned)
            .or(src)
            .unwrap_or_else(|| e.tag.clone());
        match &resolved {
            Ok(source) => match assets::get(source, self.assets, self.render.app) {
                assets::AssetState::Ready {
                    image,
                    width,
                    height,
                } => {
                    let (w, h) = html_image_dimensions(
                        (width, height),
                        (number("width"), number("height")),
                        available,
                    );
                    img(ImageSource::Render(image))
                        .debug_selector(|| "md-html-img".into())
                        .w(px(w))
                        .h(px(h))
                        .max_w_full()
                        .into_any_element()
                }
                assets::AssetState::Loading => div()
                    .w(px(number("width").unwrap_or(96.)))
                    .h(px(number("height").unwrap_or(54.)))
                    .into_any_element(),
                assets::AssetState::Failed(reason) => {
                    let msg = reason.user_reason("editor.resource.kind.image");
                    self.chip(&format!("{label} · {msg}"), inherit)
                }
            },
            Err(MediaSourceError::DataTooLarge { limit_bytes }) => self.chip(
                &format!(
                    "{label} · Exceeds {}",
                    crate::editor::registry::format_byte_limit(*limit_bytes)
                ),
                inherit,
            ),
            Err(_) => self.chip(&label, inherit),
        }
    }
}

/// Computes rendered `(width, height)` for an HTML `<img>` inside `available`,
/// preserving authored pixel sizes while capping oversized images to the
/// reading column without distorting aspect ratio (`max-width: 100%`).
pub fn html_image_dimensions(
    natural: (f32, f32),
    authored: (Option<f32>, Option<f32>),
    available: f32,
) -> (f32, f32) {
    let (nw, nh) = (natural.0.max(1.), natural.1.max(1.));
    let (mut w, mut h) = match authored {
        (Some(w), Some(h)) => (w, h),
        (Some(w), None) => (w, nh * w / nw),
        (None, Some(h)) => (nw * h / nh, h),
        (None, None) => (nw, nh),
    };
    if available > 0. && w > available {
        if authored.1.is_none() {
            h *= available / w;
        }
        w = available;
    }
    (w, h)
}

/// Picks the densest `srcset` candidate up to `2x` (else the smallest above `2x`).
pub fn best_candidate(srcset: &str) -> Option<String> {
    let mut best: Option<(f32, String)> = None;
    for candidate in srcset.split(',') {
        let mut parts = candidate.split_whitespace();
        let Some(url) = parts.next() else { continue };
        let density = parts
            .next()
            .and_then(|d| d.strip_suffix('x'))
            .and_then(|d| d.parse::<f32>().ok())
            .unwrap_or(1.);
        let better = best
            .as_ref()
            .is_none_or(|(b, _)| (density <= 2. && density > *b) || *b > 2. && density < *b);
        if better {
            best = Some((density, url.to_owned()));
        }
    }
    best.map(|(_, url)| url)
}

/// Serializes an inline `<svg>` subtree to XML markup with bounded depth (`MAX_HTML_DEPTH`).
/// An authored pixel dimension (`200` or `200px`); a percentage or an
/// expression is not one and is left out.
fn dimension(value: &str) -> Option<f32> {
    value
        .trim()
        .trim_end_matches("px")
        .parse::<f32>()
        .ok()
        .filter(|v| v.is_finite() && *v > 0.)
}

pub fn serialize(e: &Element) -> String {
    serialize_depth(e, 0)
}

fn serialize_depth(e: &Element, depth: usize) -> String {
    if depth > MAX_HTML_DEPTH {
        return String::new();
    }
    fn escape(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('"', "&quot;")
    }
    let mut out = format!("<{}", e.tag);
    if e.tag == "svg" && e.attribute("xmlns").is_none() {
        out.push_str(" xmlns=\"http://www.w3.org/2000/svg\"");
    }
    for (name, value) in &e.attributes {
        out.push_str(&format!(" {name}=\"{}\"", escape(value)));
    }
    out.push('>');
    for child in &e.children {
        match child {
            Node::Text(t) => out.push_str(&escape(t)),
            Node::Element(c) => out.push_str(&serialize_depth(c, depth + 1)),
        }
    }
    out.push_str(&format!("</{}>", e.tag));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `markdownHtmlRun.test.ts`: `keeps img width pixels`; `omits an
    /// invalid value for an img width expression`.
    #[test]
    fn pixel_dimensions_apply_and_expressions_are_left_out() {
        assert_eq!(dimension("200px"), Some(200.));
        assert_eq!(dimension(" 196 "), Some(196.));
        for invalid in ["calc(1px)", "50%", "-3", "0", "NaN", "inf"] {
            assert_eq!(dimension(invalid), None, "{invalid}");
        }
    }

    #[test]
    fn media_sources_pick_what_a_browser_shows() {
        assert_eq!(
            best_candidate("a.png 1x, b.png 2x, c.png 3x").as_deref(),
            Some("b.png")
        );
        assert_eq!(best_candidate("only.png").as_deref(), Some("only.png"));
        let svg = Element {
            tag: "svg".into(),
            attributes: vec![("width".into(), "10".into())],
            children: vec![],
        };
        assert_eq!(
            serialize(&svg),
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\"></svg>"
        );
    }
}
