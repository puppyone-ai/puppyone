//! Image line item extraction and block-vs-inline classification
//! (`imagePlan.ts`, `MA-04`: zero `gpui`).
use super::model::{Item, resolve_embed, resolve_markdown};
use crate::editor::{
    markdown::{
        core::{
            links::find_links,
            syntax::{Element, Kind, Syntax},
        },
        shared::media::{Base, parse_image_size, split_image_alt},
    },
    navigation::ReferenceContext,
    text::buffer::Buffer,
};
use std::ops::Range;

/// The image an element shows, if it is one (a link around exactly one
/// image is that image, linked).
pub fn resolve_item(
    doc: &Buffer,
    syntax: &Syntax,
    references: Option<&ReferenceContext>,
    e: &Element,
    base: Base<'_>,
) -> Option<Item> {
    let is_image = |e: &Element| matches!(e.kind, Kind::Image | Kind::ImageEmbed);
    let (image_el, link) = if is_image(e) {
        (e, None)
    } else if e.kind == Kind::Link {
        let content = e.content.clone()?;
        let inner = syntax
            .elements_in(content.clone())
            .find(|i| is_image(i) && i.range == content)?;
        let href = e.href.clone().or_else(|| {
            let source = doc.slice(e.range.clone());
            find_links(source).first().map(|l| l.href.clone())
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
        (alt, size, resolve_embed(base.document, &href, references))
    } else {
        let alt = image_el
            .content
            .clone()
            .map(|c| doc.slice(c).to_owned())
            .unwrap_or_default();
        let (alt, size) = split_image_alt(&alt);
        (alt, size, resolve_markdown(base, &href))
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

/// Collect complete image elements inside one inline range, preserving linked images.
pub fn collect_items(
    doc: &Buffer,
    syntax: &Syntax,
    range: Range<usize>,
    base: Base<'_>,
    references: Option<&ReferenceContext>,
) -> (Vec<Item>, bool) {
    let text = doc.slice(range.clone());
    if !text.contains('!') {
        return (Vec::new(), false);
    }
    let start = syntax
        .elements_in(range.clone())
        .filter(|e| {
            e.kind.block_marker() && e.line.as_ref().is_some_and(|l| l.start == range.start)
        })
        .map(Element::visible_start)
        .max()
        .unwrap_or(range.start)
        .max(range.start);
    let mut items = Vec::new();
    let mut at = start;
    let mut mixed = false;
    let mut candidates: Vec<&Element> = syntax
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
        if !doc.slice(at..e.range.start).trim().is_empty() {
            mixed = true;
        }
        let Some(item) = resolve_item(doc, syntax, references, e, base) else {
            mixed = true;
            continue;
        };
        at = e.range.end;
        items.push(item);
    }
    mixed |= !doc.slice(at..range.end).trim().is_empty();
    (items, mixed)
}

/// True when a single unlinked image owns the entire line with no prefix.
pub fn is_block_line(doc: &Buffer, line_start: usize, items: &[Item]) -> bool {
    items.len() == 1
        && items[0].link.is_none()
        && doc
            .slice(line_start..items[0].range.start)
            .trim()
            .is_empty()
}
