//! HTML media (`<img>`, `<picture>`, `<svg>`, `<video>`, `<audio>`) rendered
//! through the injected [`super::HtmlMediaPort`].
use super::{ImageLoad, Inherit, MediaKind, Surface};
use crate::editor::markdown::shared::{
    dom::{Element, MAX_HTML_DEPTH, Node},
    media_source::{self, MediaSource},
};
use gpui::{prelude::*, *};

impl Surface<'_, '_, '_, '_> {
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
            .and_then(|s| media_source::markdown(self.document, s))
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
        if let Some(rendered) = self.port.render_media(
            kind,
            path.as_deref(),
            e.attribute("title"),
            (number("width"), number("height")),
            index,
            available,
            self.render,
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

    pub(super) fn image(&mut self, e: &Element, inherit: &Inherit) -> AnyElement {
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
                Some(s) => media_source::resolve_markdown_media(self.document, s),
                None => Err(media_source::MediaSourceError::Empty),
            }
        };
        let label = attrs
            .attribute("alt")
            .map(str::to_owned)
            .or(src)
            .unwrap_or_else(|| e.tag.clone());
        let state = match &resolved {
            Ok(source) => self.port.load_image(source, self.render.app),
            Err(media_source::MediaSourceError::DataTooLarge { limit_bytes }) => {
                ImageLoad::Failed(Some(SharedString::from(format!(
                    "Exceeds {}",
                    crate::editor::registry::format_byte_limit(*limit_bytes)
                ))))
            }
            Err(_) => ImageLoad::Failed(None),
        };
        match state {
            ImageLoad::Ready {
                image,
                width,
                height,
            } => {
                let (w, h) = match (number("width"), number("height")) {
                    (Some(w), Some(h)) => (w, h),
                    (Some(w), None) => (w, height * w / width.max(1.)),
                    (None, Some(h)) => (width * h / height.max(1.), h),
                    (None, None) => (width, height),
                };
                img(ImageSource::Render(image))
                    .w(px(w))
                    .h(px(h))
                    .max_w_full()
                    .into_any_element()
            }
            ImageLoad::Loading => div()
                .w(px(number("width").unwrap_or(96.)))
                .h(px(number("height").unwrap_or(54.)))
                .into_any_element(),
            ImageLoad::Failed(Some(reason)) => self.chip(&format!("{label} · {reason}"), inherit),
            ImageLoad::Failed(None) => self.chip(&label, inherit),
        }
    }
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
