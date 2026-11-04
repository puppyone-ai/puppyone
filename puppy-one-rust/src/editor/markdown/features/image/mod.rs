//! Images (product features/image and media): `![alt](src "title")`,
//! reference images and Obsidian `![[image|size]]` embeds show the image
//! in a line made only of images (or images wrapped in links). An image
//! alone on its line is a block (`is-block`: natural size within the
//! column); otherwise each sits inline (at most 320px tall). `alt|300` or
//! `alt|300x200` (an embed's alias) sets the size. A double click reveals
//! the source; a linked image follows its link. Images beside text stay
//! source: one shaped text run has no room for a picture.
pub mod cache;
mod embed;
pub mod source;

use crate::editor::{
    markdown::core::{
        decorations::LineDecoration,
        feature::MarkdownFeature,
        state::PreviewState,
        syntax::{Element, Kind},
    },
    text::{
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, style::Embed},
};
use embed::{ImageEmbed, Item};
use std::{
    hash::{Hash, Hasher},
    ops::Range,
    path::Path,
    rc::Rc,
};

pub struct ImageFeature;
pub static FEATURE: ImageFeature = ImageFeature;
pub const ID: &str = "image";

/// Reveal an image line's source (double click), the caret after `![`.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShowSource {
    pub line: Range<usize>,
    pub caret: usize,
}

/// `parseMarkdownImageSize`: `100` sets the width, `100x50` both.
fn size(value: &str) -> Option<(f32, Option<f32>)> {
    let value = value.trim();
    let (w, h) = match value.split_once(['x', 'X']) {
        Some((w, h)) => (w, Some(h)),
        None => (value, None),
    };
    let number = |s: &str| {
        (!s.is_empty() && s.len() <= 4 && s.chars().all(|c| c.is_ascii_digit()))
            .then(|| s.parse::<f32>().ok())
            .flatten()
    };
    Some((
        number(w)?,
        match h {
            Some(h) => Some(number(h)?),
            None => None,
        },
    ))
}

/// `splitMarkdownImageAlt`: a trailing `|size` is the size, not the text.
fn split_alt(alt: &str) -> (String, Option<(f32, Option<f32>)>) {
    match alt
        .rsplit_once('|')
        .and_then(|(text, s)| Some((text, size(s)?)))
    {
        Some((text, size)) => (text.trim().to_owned(), Some(size)),
        None => (alt.to_owned(), None),
    }
}

/// The image an element shows, if it is one (a link around exactly one
/// image is that image, linked).
fn item(cx: &LineDecoration, e: &Element, document: &Path) -> Option<Item> {
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
        let size = alias.as_deref().and_then(size);
        let alt = alias
            .filter(|_| size.is_none())
            .unwrap_or_else(|| href.clone());
        (alt, size, source::embed(document, &href, cx.references))
    } else {
        let alt = image_el
            .content
            .clone()
            .map(|c| cx.doc.slice(c).to_owned())
            .unwrap_or_default();
        let (alt, size) = split_alt(&alt);
        (alt, size, source::markdown(document, &href))
    };
    Some(Item {
        range: e.range.clone(),
        label: if alt.is_empty() { href.clone() } else { alt },
        size,
        key: source.as_ref().map(|s| s.key(cx.assets)),
        source,
        link,
    })
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

    /// A line of images shows them in place of its text.
    fn decorate_line(&self, cx: &mut LineDecoration) {
        let range = cx.range.clone();
        let text = cx.doc.slice(range.clone());
        if !text.contains('!') {
            return;
        }
        // After the block markers (quote, list) and indentation.
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
        // Outermost elements of the content, in order.
        let mut items = Vec::new();
        let mut at = start;
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
                return;
            }
            let Some(item) = item(cx, e, &document) else {
                return;
            };
            at = e.range.end;
            items.push(item);
        }
        if items.is_empty() || !cx.doc.slice(at..range.end).trim().is_empty() {
            return;
        }
        // `getImageDisplayModeOnLine`: alone on the raw line, unlinked.
        let block = items.len() == 1
            && items[0].link.is_none()
            && cx
                .doc
                .slice(range.start..items[0].range.start)
                .trim()
                .is_empty();
        let shown = items[0].range.start..items.last().map_or(at, |i| i.range.end);
        cx.hidden.push(shown);
        let mut h = std::hash::DefaultHasher::new();
        (range.start, block).hash(&mut h);
        for i in &items {
            (
                &i.range,
                &i.key,
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
        assert_eq!(split_alt("Logo|300"), ("Logo".into(), Some((300., None))));
        assert_eq!(
            split_alt("Logo | 300x200"),
            ("Logo".into(), Some((300., Some(200.))))
        );
        assert_eq!(split_alt("a|b"), ("a|b".into(), None));
        assert_eq!(size("12345"), None);
    }
}
