//! A run sharing its line with Markdown, drawn in the text: tags hide,
//! images and players draw in rooms, elements style the text between tags.
use super::{
    super::{
        inline::model::{Tag, tag_at},
        render::{best_candidate, html_image_dimensions},
        tokenizer::VOID_TAGS,
    },
    Sink, X_HEIGHT,
};
use crate::{
    editor::{
        markdown::{
            core::{decorations::ClassSpan, presentation::classes::Class, syntax::Element},
            platform::{
                brokers::{assets as asset_broker, link::safe_href},
                policy::html_profiles::{BLOCKED_TAGS, DROPPED_WITH_CONTENT},
            },
            shared::media::{self, MediaKind, MediaSource},
            style::MarkdownTheme,
        },
        registry::DocumentAssets,
        text::buffer::Buffer,
        tokens::parse_css_color,
        view::decoration::{InlineImage, packed},
    },
    render_service::Rendered,
};
use gpui::{prelude::*, *};
use std::{ops::Range, path::PathBuf, rc::Rc};

/// One element of a run: its opening tag (or only tag) and closing tag.
struct Part {
    open: Tag,
    close: Option<Tag>,
}

impl Part {
    fn range(&self) -> Range<usize> {
        self.open.range.start
            ..self
                .close
                .as_ref()
                .map_or(self.open.range.end, |c| c.range.end)
    }
    fn content(&self) -> Option<Range<usize>> {
        Some(self.open.range.end..self.close.as_ref()?.range.start)
    }
}

/// The elements of a run, outermost first.
fn parts(doc: &Buffer, run: &Element) -> Vec<Part> {
    let tags: Vec<Tag> = run
        .markers
        .iter()
        .filter_map(|r| tag_at(doc, r.clone()))
        .collect();
    let mut out: Vec<Part> = Vec::new();
    let mut stack: Vec<Tag> = Vec::new();
    for t in tags {
        if t.closing {
            if let Some(open) = stack.pop() {
                out.push(Part {
                    open,
                    close: Some(t),
                });
            }
        } else if t.void || VOID_TAGS.contains(&t.name.as_str()) {
            out.push(Part {
                open: t,
                close: None,
            });
        } else {
            stack.push(t);
        }
    }
    out.sort_by_key(|p| (p.range().start, std::cmp::Reverse(p.range().end)));
    out
}

/// The classes an element sets on its content (the inline-editable marks).
fn classes(tag: &str) -> Class {
    match tag {
        "b" | "strong" => Class::SYNTAX_STRONG,
        "i" | "em" | "cite" | "var" | "dfn" => Class::SYNTAX_EMPHASIS,
        "s" | "del" | "strike" => Class::SYNTAX_STRIKE,
        "u" | "ins" => Class::HTML_UNDERLINE,
        "code" | "kbd" | "samp" | "tt" => Class::SYNTAX_MONOSPACE,
        "mark" => Class::HTML_MARK,
        _ => Class::NONE,
    }
}

/// A `style` declaration's colour.
fn style_color(tag: &Tag, property: &str) -> Option<u32> {
    let style = tag.attribute("style")?;
    style.split(';').find_map(|d| {
        let (name, value) = d.split_once(':')?;
        if !name.trim().eq_ignore_ascii_case(property) || value.contains(['\\', '<', '>']) {
            return None;
        }
        parse_css_color(value.trim()).map(packed)
    })
}

/// The image a `<picture>` shows in the editor's colour mode: the first
/// `<source>` whose `prefers-color-scheme` matches (or that has no media
/// query), else its `<img>`.
pub fn picture_source<'t>(
    sources: impl Iterator<Item = (Option<&'t str>, Option<&'t str>)>,
    img: Option<&'t str>,
    dark: bool,
) -> Option<String> {
    picture_candidates(sources, img, dark).into_iter().next()
}

/// Every image a `<picture>` may show in the editor's colour mode, in the
/// order a browser tries them: the `<source>`s whose `prefers-color-scheme`
/// matches (or that have no media query), then its `<img>`. A candidate the
/// document's media policy refuses gives way to the next (`removes an
/// unauthorized candidate so the fallback image still shows`).
pub fn picture_candidates<'t>(
    sources: impl Iterator<Item = (Option<&'t str>, Option<&'t str>)>,
    img: Option<&'t str>,
    dark: bool,
) -> Vec<String> {
    let scheme = if dark { "dark" } else { "light" };
    let mut out: Vec<String> = sources
        .filter_map(|(media, srcset)| {
            let matches = match media {
                None => true,
                Some(m) => m
                    .to_ascii_lowercase()
                    .replace(' ', "")
                    .contains(&format!("prefers-color-scheme:{scheme}")),
            };
            matches.then(|| best_candidate(srcset?)).flatten()
        })
        .collect();
    out.extend(img.map(str::to_owned));
    out
}

/// Draws `run`'s part of `within` into `sink`: tags hide, images draw in the
/// text, and elements style the text between them.
pub(super) fn decompose(
    doc: &Buffer,
    run: &Element,
    within: Range<usize>,
    theme: &MarkdownTheme,
    assets: Option<&DocumentAssets>,
    sink: &mut Sink,
) {
    let inside = |r: &Range<usize>| within.start <= r.start && r.end <= within.end;
    let document: PathBuf = assets.map(|a| a.document.clone()).unwrap_or_default();
    let parts = parts(doc, run);
    // Ranges drawn as one piece (an image, a dropped element): their tags
    // and text do not decorate separately.
    let mut taken: Vec<Range<usize>> = Vec::new();
    let mut links: Vec<(Range<usize>, SharedString)> = Vec::new();
    for part in &parts {
        let range = part.range();
        if taken
            .iter()
            .any(|t| t.start <= range.start && range.end <= t.end)
        {
            continue;
        }
        let name = part.open.name.as_str();
        if DROPPED_WITH_CONTENT.contains(&name) || BLOCKED_TAGS.contains(&name) {
            if inside(&range) {
                sink.hidden.push(range.clone());
                taken.push(range);
            }
            continue;
        }
        match name {
            "img" | "picture" if inside(&range) => {
                let (src, img) = if name == "picture" {
                    let inner: Vec<&Part> = parts
                        .iter()
                        .filter(|p| range.start < p.open.range.start && p.range().end <= range.end)
                        .collect();
                    let img = inner.iter().find(|p| p.open.name == "img").map(|p| &p.open);
                    let sources = inner
                        .iter()
                        .filter(|p| p.open.name == "source")
                        .map(|p| (p.open.attribute("media"), p.open.attribute("srcset")));
                    let candidates = picture_candidates(
                        sources,
                        img.and_then(|i| i.attribute("src")),
                        theme.dark,
                    );
                    (
                        candidates
                            .iter()
                            .find(|c| media::resolve_markdown_media(&document, c).is_ok())
                            .or(candidates.first())
                            .cloned(),
                        img,
                    )
                } else {
                    (
                        part.open
                            .attribute("src")
                            .map(str::to_owned)
                            .or_else(|| part.open.attribute("srcset").and_then(best_candidate)),
                        Some(&part.open),
                    )
                };
                let attr = |n: &str| img.and_then(|i| i.attribute(n));
                let label = attr("alt").unwrap_or_default().to_owned();
                let source = src
                    .as_deref()
                    .ok_or(())
                    .and_then(|s| media::resolve_markdown_media(&document, s).map_err(|_| ()));
                sink.replaced
                    .push((range.clone(), SharedString::from(label)));
                if let Ok(source) = source {
                    let number = |n: &str| {
                        attr(n).and_then(|v| v.trim().trim_end_matches("px").parse::<f32>().ok())
                    };
                    let authored = (number("width"), number("height"));
                    let middle = attr("align").is_some_and(|a| {
                        matches!(
                            a.to_ascii_lowercase().as_str(),
                            "middle" | "absmiddle" | "center"
                        )
                    });
                    let assets = assets.cloned();
                    sink.images.push(InlineImage {
                        range: range.clone(),
                        pad: 0.,
                        radius: 0.,
                        element: None,
                        draw: Rc::new(move |_, column, font, _, app| {
                            let asset_broker::AssetState::Ready {
                                image,
                                width,
                                height,
                            } = asset_broker::get(&source, assets.as_ref(), app)
                            else {
                                return None;
                            };
                            let (width, height) =
                                html_image_dimensions((width, height), authored, column);
                            Some(Rendered {
                                image,
                                width,
                                height,
                                baseline: if middle {
                                    height / 2. + X_HEIGHT / 2. * font
                                } else {
                                    height
                                },
                            })
                        }),
                    });
                }
                taken.push(range);
            }
            "meter" | "progress" if inside(&range) => {
                let number = |n: &str| {
                    part.open
                        .attribute(n)
                        .and_then(|v| v.trim().parse::<f32>().ok())
                };
                let (value, max) = (number("value").unwrap_or(0.), number("max").unwrap_or(1.));
                let fraction = if max > 0. {
                    (value / max).clamp(0., 1.)
                } else {
                    0.
                };
                sink.replaced.push((
                    range.clone(),
                    SharedString::from(format!("{:.0}%", fraction * 100.)),
                ));
                sink.images.push(InlineImage {
                    range: range.clone(),
                    pad: 0.1,
                    radius: 3.,
                    element: None,
                    draw: Rc::new(move |_, _, font, _, _| Some(meter(fraction, font))),
                });
                taken.push(range);
            }
            "audio" | "video" if inside(&range) => {
                let src = part.open.attribute("src").map(str::to_owned).or_else(|| {
                    parts
                        .iter()
                        .find(|p| {
                            p.open.name == "source"
                                && range.start < p.open.range.start
                                && p.range().end <= range.end
                        })
                        .and_then(|p| p.open.attribute("src").map(str::to_owned))
                });
                let video = name == "video";
                let label = src
                    .as_deref()
                    .and_then(|s| s.rsplit('/').next())
                    .unwrap_or(name);
                let mark = if video { "▶" } else { "♪" };
                sink.replaced
                    .push((range.clone(), SharedString::from(format!("{mark} {label}"))));
                let path = match src.as_deref().and_then(|s| media::markdown(&document, s)) {
                    Some(MediaSource::Workspace(path)) => path,
                    _ => {
                        taken.push(range);
                        continue;
                    }
                };
                if let Some(assets) = assets.cloned() {
                    sink.images.push(player(
                        range.clone(),
                        path,
                        video,
                        part.open.attribute("title").map(str::to_owned),
                        assets,
                        theme.dark,
                    ));
                }
                taken.push(range);
            }
            _ => {
                if let Some(content) = part.content().filter(|c| !c.is_empty()) {
                    let content = content.start.max(within.start)..content.end.min(within.end);
                    if !content.is_empty() {
                        let class = classes(name);
                        if class != Class::NONE {
                            sink.spans.push(ClassSpan {
                                range: content.clone(),
                                classes: class,
                                href: None,
                            });
                        }
                        let color = style_color(&part.open, "color").or_else(|| {
                            (name == "font")
                                .then(|| part.open.attribute("color"))
                                .flatten()
                                .and_then(parse_css_color)
                                .map(packed)
                        });
                        let background = style_color(&part.open, "background-color");
                        if color.is_some() || background.is_some() {
                            sink.colors.push((content.clone(), color, background));
                        }
                        if name == "a"
                            && let Some(href) = part.open.attribute("href").and_then(safe_href)
                        {
                            links.push((content, SharedString::from(href)));
                        }
                    }
                }
            }
        }
    }
    for (content, href) in links {
        let mut classes = Class::SYNTAX_LINK | Class::LINK_LABEL;
        if href.contains("://") || href.starts_with("mailto:") {
            classes |= Class::IS_EXTERNAL;
        }
        sink.spans.push(ClassSpan {
            range: content,
            classes,
            href: Some(href),
        });
    }
    for part in &parts {
        for tag in std::iter::once(&part.open).chain(part.close.as_ref()) {
            let r = &tag.range;
            if inside(r) && !taken.iter().any(|t| t.start <= r.start && r.end <= t.end) {
                sink.hidden.push(r.clone());
            }
        }
    }
}

/// An `<audio>` or `<video>` in a sentence: the workspace media player in a
/// room of its own size in the text (its label stands in until the player
/// mounts, and when it cannot).
fn player(
    range: Range<usize>,
    path: PathBuf,
    video: bool,
    title: Option<String>,
    assets: DocumentAssets,
    dark: bool,
) -> InlineImage {
    use crate::editor::markdown::platform::brokers::embed::{self as embed_broker, AUDIO_SIZE};
    let (width, height) = if video { (320., 180.) } else { AUDIO_SIZE };
    let start = range.start;
    InlineImage {
        range,
        pad: 0.,
        radius: 0.,
        draw: Rc::new(move |_, column, _, _, _| {
            let width = width.min(column.max(1.));
            Some(Rendered {
                image: std::sync::Arc::new(RenderImage::new(vec![image::Frame::new(
                    image::RgbaImage::new(1, 1),
                )])),
                width,
                height,
                baseline: height,
            })
        }),
        element: Some(Rc::new(move |view, width, height, window, app| {
            let Some(entity) = view.upgrade() else {
                return div().into_any_element();
            };
            let t = crate::editor::tokens::Tokens::get(dark, crate::typography::Scale::Medium);
            let player = embed_broker::get_media_player(
                embed_broker::MediaRequest {
                    key: (entity.entity_id(), start, 0, path.clone()),
                    kind: if video {
                        MediaKind::Video
                    } else {
                        MediaKind::Audio
                    },
                    title: title.as_deref(),
                    background: t.color("--po-editor-bg"),
                    assets: &assets,
                    dark,
                },
                window,
                app,
            );
            if player.failure().is_some() {
                return div().into_any_element();
            }
            let ready = player.size.get().is_some();
            div()
                .w(px(width))
                .h(px(height))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .child(
                    canvas(
                        |_, _, _| {},
                        move |bounds, _, window, _| {
                            if ready {
                                player.place(bounds, window.content_mask().bounds, 0.);
                            }
                        },
                    )
                    .size_full(),
                )
                .into_any_element()
        })),
    }
}

/// A `<meter>` / `<progress>` bar `fraction` full, a line's x-height tall.
fn meter(fraction: f32, font: f32) -> Rendered {
    let (w, h) = ((font * 4.).round().max(8.), (font * 0.5).round().max(4.));
    let scale = 2.;
    let (pw, ph) = ((w * scale) as u32, (h * scale) as u32);
    let filled = (pw as f32 * fraction).round() as u32;
    let mut pixels = image::RgbaImage::new(pw, ph);
    for (x, _, px) in pixels.enumerate_pixels_mut() {
        // BGRA, as `RenderImage` holds it.
        *px = if x < filled {
            image::Rgba([0x66, 0xa3, 0x2d, 0xff])
        } else {
            image::Rgba([0xd9, 0xd9, 0xd9, 0xff])
        };
    }
    Rendered {
        image: std::sync::Arc::new(RenderImage::new(vec![image::Frame::new(pixels)])),
        width: w,
        height: h,
        baseline: h / 2. + X_HEIGHT / 2. * font,
    }
}
