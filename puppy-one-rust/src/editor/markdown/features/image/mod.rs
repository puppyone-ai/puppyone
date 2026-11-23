//! Images (product features/image and media): `![alt](src "title")`,
//! reference images and Obsidian `![[image|size]]` embeds show the image
//! in a line made only of images (or images wrapped in links). An image
//! alone on its line is a block (`is-block`: natural size within the
//! column); otherwise each sits inline (at most 320px tall). `alt|300` or
//! `alt|300x200` (an embed's alias) sets the size. A double click reveals
//! the source; a linked image follows its link. An image beside text sits
//! in the text (`vertical-align: middle`, at most 320px tall), its alt text
//! standing in until it decodes or when it cannot load.
pub mod cache;
mod embed;
pub mod source;

#[cfg(test)]
pub(crate) use embed::fit as fit_for_tests;

use crate::editor::{
    markdown::{
        core::{
            decorations::{InlineDecoration, LineDecoration},
            features::MarkdownFeature,
            state::PreviewState,
            syntax::{Element, Kind},
        },
        shared::media::{parse_image_size, split_image_alt},
    },
    text::{
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, decoration::InlineImage, style::Embed},
};
use crate::render_service::Rendered;
use embed::{ImageEmbed, Item};
use gpui::SharedString;
use std::{
    hash::{Hash, Hasher},
    ops::Range,
    path::Path,
    rc::Rc,
};

pub struct ImageFeature;
pub static FEATURE: ImageFeature = ImageFeature;
pub const ID: &str = "image";

/// Reveal an image line's source (double click / fallback Source action), the caret after `![`.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShowSource {
    pub line: Range<usize>,
    pub caret: usize,
}

/// The image an element shows, if it is one (a link around exactly one
/// image is that image, linked).
fn item(cx: &InlineDecoration, e: &Element, document: &Path) -> Option<Item> {
    let image = |e: &Element| matches!(e.kind, Kind::Image | Kind::ImageEmbed);
    let (image_el, link) = if image(e) {
        (e, None)
    } else if e.kind == Kind::Link {
        let content = e.content.clone()?;
        let inner = cx
            .syntax
            .elements_in(content.clone())
            .find(|i| image(i) && i.range == content)?;
        let href = e.href.clone().or_else(|| {
            let source = cx.doc.slice(e.range.clone());
            crate::editor::markdown::core::links::find_links(source)
                .first()
                .map(|l| l.href.clone())
        })?;
        (inner, Some(href))
    } else {
        return None;
    };
    let href = image_el.href.clone().unwrap_or_default();
    let (alt, size, source) = if image_el.kind == Kind::ImageEmbed {
        let alias = image_el.text.clone();
        let size = alias.as_deref().and_then(parse_image_size);
        let alt = alias
            .filter(|_| size.is_none())
            .unwrap_or_else(|| href.clone());
        (
            alt,
            size,
            source::embed_checked(document, &href, cx.references),
        )
    } else {
        let alt = image_el
            .content
            .clone()
            .map(|c| cx.doc.slice(c).to_owned())
            .unwrap_or_default();
        let (alt, size) = split_image_alt(&alt);
        (alt, size, source::markdown_checked(document, &href))
    };
    Some(Item {
        range: e.range.clone(),
        label: if alt.is_empty() { href.clone() } else { alt },
        size,
        source,
        link,
        image: image_el.range.clone(),
    })
}

/// `.cm-md-image-widget` in a line with text: each image drawn where its
/// source is, its alt text (or failure summary) standing in until it decodes.
fn inline(cx: &mut InlineDecoration, items: Vec<Item>) {
    let radius = cx.theme.block.radius;
    for item in items {
        if cx.preview.reveal.as_ref() == Some(&item.image) {
            continue;
        }
        let source = match item.source {
            Ok(source) => source,
            Err(failure) => {
                let summary = embed::describe_failure(&item.label, &failure);
                cx.replaced.push((
                    item.image.clone(),
                    SharedString::from(format!("[{} — {}]", summary.title, summary.reason)),
                ));
                continue;
            }
        };
        let assets = cx.assets.cloned();
        let size = item.size;
        cx.replaced
            .push((item.image.clone(), SharedString::from(item.label)));
        cx.inline_images.push(InlineImage {
            range: item.image,
            pad: 0.,
            radius,
            draw: Rc::new(move |_, column, font, _, app| {
                let cache::State::Ready {
                    image,
                    width,
                    height,
                } = cache::get(&source, assets.as_ref(), app)
                else {
                    return None;
                };
                let (width, height) = embed::fit(size, false, (width, height), column);
                Some(Rendered {
                    image,
                    width,
                    height,
                    baseline: height / 2. + X_HEIGHT / 2. * font,
                })
            }),
        });
    }
}

/// The x-height of the body face, in ems.
const X_HEIGHT: f32 = 0.5;

/// Collect complete image elements inside one inline range, preserving linked images.
fn items(cx: &InlineDecoration) -> (Vec<Item>, bool) {
    let range = cx.range.clone();
    let text = cx.doc.slice(range.clone());
    if !text.contains('!') {
        return (Vec::new(), false);
    }
    let start = cx
        .syntax
        .elements_in(range.clone())
        .filter(|e| {
            e.kind.block_marker() && e.line.as_ref().is_some_and(|l| l.start == range.start)
        })
        .map(Element::visible_start)
        .max()
        .unwrap_or(range.start)
        .max(range.start);
    let document = cx.assets.map(|a| a.document.clone()).unwrap_or_default();
    let mut items = Vec::new();
    let mut at = start;
    let mut mixed = false;
    let mut candidates: Vec<&Element> = cx
        .syntax
        .elements_in(start..range.end)
        .filter(|e| {
            matches!(e.kind, Kind::Image | Kind::ImageEmbed | Kind::Link)
                && e.range.start >= start
                && e.range.end <= range.end
        })
        .collect();
    candidates.sort_by_key(|e| (e.range.start, std::cmp::Reverse(e.range.end)));
    for e in candidates {
        if e.range.start < at {
            continue;
        }
        if !cx.doc.slice(at..e.range.start).trim().is_empty() {
            mixed = true;
        }
        let Some(item) = item(cx, e, &document) else {
            mixed = true;
            continue;
        };
        at = e.range.end;
        items.push(item);
    }
    mixed |= !cx.doc.slice(at..range.end).trim().is_empty();
    (items, mixed)
}

impl MarkdownFeature for ImageFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn view_command(
        &self,
        command: &Command,
        preview: &mut PreviewState,
        state: &EditorState,
    ) -> Option<Transaction> {
        let show = command.payload::<ShowSource>()?;
        let len = state.doc.len();
        preview.revealed_source = Some(show.line.start.min(len)..show.line.end.min(len));
        Some(Transaction::select(Selection::cursor(show.caret.min(len))))
    }

    fn decorate_inline_content(&self, cx: &mut InlineDecoration) {
        let (items, _) = items(cx);
        inline(cx, items);
    }

    /// A line of images shows them in place of its text.
    fn decorate_line(&self, cx: &mut LineDecoration) {
        let range = cx.range.clone();
        let mut content = cx.inline_content();
        let (items, mixed) = items(&content);
        if items.is_empty() {
            return;
        }
        if mixed {
            inline(&mut content, items);
            return;
        }
        let block = items.len() == 1
            && items[0].link.is_none()
            && cx
                .doc
                .slice(range.start..items[0].range.start)
                .trim()
                .is_empty();
        let shown = items[0].range.start..items.last().map_or(range.end, |i| i.range.end);
        cx.hidden.push(shown);
        let mut h = std::hash::DefaultHasher::new();
        (range.start, block).hash(&mut h);
        for i in &items {
            let source_key = i.source.as_ref().ok().map(|s| s.key(cx.assets));
            (
                &i.range,
                &source_key,
                &i.source.is_ok(),
                &i.link,
                &i.label,
                i.size.map(|(w, h)| (w.to_bits(), h.map(f32::to_bits))),
            )
                .hash(&mut h);
        }
        cx.style.embed = Some(Embed {
            key: h.finish(),
            content: Rc::new(ImageEmbed {
                items,
                block,
                line: range,
                assets: cx.assets.cloned(),
                radius: cx.theme.block.radius,
                hover_ring: cx.theme.block.hover_ring,
                selected_ring: cx.theme.block.selected_ring,
                ring_width: cx.theme.block.ring_width,
                text: cx.style.text.clone(),
                dark: cx.theme.dark,
            }),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn sizes_follow_the_alt_text() {
        assert_eq!(
            split_image_alt("Logo|300"),
            ("Logo".into(), Some((300., None)))
        );
        assert_eq!(
            split_image_alt("Logo | 300x200"),
            ("Logo".into(), Some((300., Some(200.))))
        );
        assert_eq!(split_image_alt("a|b"), ("a|b".into(), None));
    }
}
