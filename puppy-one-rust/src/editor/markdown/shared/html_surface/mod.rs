//! `.cm-md-html-rendered-surface` (`markdown-content.css`): renders sanitized
//! HTML DOM subtrees into GPUI elements with the product's prose roles, shared
//! by HTML blocks (`features/html`) and MDX `<Tabs>` panels (`features/mdx`)
//! without cross-feature imports (`TA-41`, `R5`, `R6`).
mod blocks;
mod inline;
mod media;

pub use media::{best_candidate, serialize};

use super::{
    dom::{Element, MAX_HTML_DEPTH, Node},
    media_source::MediaSource,
};
use crate::editor::{
    markdown::style::MarkdownTheme,
    tokens::{Tokens, parse_css_color},
    view::{editor::EditorView, render::RenderCx, style::TextStyle},
};
use gpui::{prelude::*, *};
use std::{cell::RefCell, collections::HashMap, path::Path, sync::Arc};

/// Maximum `<details>` toggle entries kept in session view state (`TODO-31`).
pub const MAX_OPEN_DETAILS: usize = 512;
/// Maximum measured HTML/MDX surface heights cached in memory (`TODO-31`).
pub const MAX_MEASURED_HEIGHTS: usize = 512;

/// Image decoding result supplied by a platform bridge to [`Surface`].
#[derive(Clone)]
pub enum ImageLoad {
    Loading,
    Ready {
        image: Arc<RenderImage>,
        width: f32,
        height: f32,
    },
    Failed(Option<SharedString>),
}

/// Media element kind inside an HTML block (`<video>` or `<audio>`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MediaKind {
    Video,
    Audio,
}

/// Platform port injected into [`Surface`] so `markdown/shared/` stays free of
/// `platform` and `features` dependencies (`R6`, `TA-41`, `TA-42`).
pub trait HtmlMediaPort {
    fn load_image(&mut self, source: &MediaSource, app: &mut App) -> ImageLoad;

    #[allow(clippy::too_many_arguments)]
    fn render_media(
        &mut self,
        kind: MediaKind,
        path: Option<&Path>,
        title: Option<&str>,
        dims: (Option<f32>, Option<f32>),
        index: usize,
        available: f32,
        render: &mut RenderCx,
    ) -> Option<AnyElement>;
}

/// Bounded LRU map used for session `<details>` toggles and measured heights.
pub struct BoundedMap<K, V> {
    entries: HashMap<K, (V, u64)>,
    clock: u64,
    cap: usize,
}

impl<K: Eq + std::hash::Hash + Copy, V: Copy> BoundedMap<K, V> {
    pub fn new(cap: usize) -> Self {
        Self {
            entries: HashMap::new(),
            clock: 0,
            cap: cap.max(1),
        }
    }

    pub fn get(&mut self, key: &K) -> Option<V> {
        self.clock += 1;
        let now = self.clock;
        let entry = self.entries.get_mut(key)?;
        entry.1 = now;
        Some(entry.0)
    }

    pub fn contains(&mut self, key: &K) -> bool {
        self.get(key).is_some()
    }

    pub fn remove(&mut self, key: &K) -> Option<V> {
        self.entries.remove(key).map(|(v, _)| v)
    }

    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.clock += 1;
        let now = self.clock;
        let previous = self.entries.insert(key, (value, now)).map(|(v, _)| v);
        while self.entries.len() > self.cap {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (_, used))| *used)
                .map(|(k, _)| *k)
            else {
                break;
            };
            self.entries.remove(&oldest);
        }
        previous
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

thread_local! {
    /// `<details>` opened/closed overrides in this session, bounded by LRU.
    static OPEN_DETAILS: RefCell<BoundedMap<(usize, usize), ()>> =
        RefCell::new(BoundedMap::new(MAX_OPEN_DETAILS));
    /// Measured HTML/MDX surface heights keyed by content/width hash, bounded by LRU.
    static MEASURED_HEIGHTS: RefCell<BoundedMap<u64, f32>> =
        RefCell::new(BoundedMap::new(MAX_MEASURED_HEIGHTS));
}

pub(super) fn is_details_toggled(key: (usize, usize)) -> bool {
    OPEN_DETAILS.with(|o| o.borrow_mut().contains(&key))
}

pub(super) fn toggle_details_state(key: (usize, usize)) {
    OPEN_DETAILS.with(|o| {
        let mut o = o.borrow_mut();
        if o.remove(&key).is_none() {
            o.insert(key, ());
        }
    });
}

/// Reads a previously measured block/panel height from the bounded store.
pub fn measured_height(key: u64) -> Option<f32> {
    MEASURED_HEIGHTS.with(|m| m.borrow_mut().get(&key))
}

/// Records a measured height, returning `true` when it changed by `> 0.25px`.
pub fn record_measured_height(key: u64, height: f32) -> bool {
    MEASURED_HEIGHTS.with(|m| {
        let old = m.borrow_mut().insert(key, height);
        old.is_none_or(|o| (o - height).abs() > 0.25)
    })
}

/// Inherited text and inline decoration attributes of a DOM subtree.
#[derive(Clone)]
pub(super) struct Inherit {
    pub text: TextStyle,
    pub align: TextAlign,
    pub link: Option<String>,
    pub mono: bool,
    pub background: Option<Rgba>,
    pub underline: bool,
    pub strike: bool,
}

/// Inline formatting run or atom inside an inline formatting context.
pub(super) enum Piece {
    Text(String, Inherit),
    Break,
    Atom(AnyElement),
}

pub struct Surface<'s, 'r, 'a, 'p> {
    pub theme: &'s MarkdownTheme,
    pub document: &'s Path,
    pub view: WeakEntity<EditorView>,
    /// Block identity (source start offset) for element IDs and `<details>` state.
    pub block: usize,
    pub render: &'r mut RenderCx<'a>,
    pub port: &'p mut dyn HtmlMediaPort,
    pub(super) details: usize,
    pub(super) ids: usize,
    pub(super) media: usize,
}

pub(super) fn heading_level(tag: &str) -> Option<usize> {
    let b = tag.as_bytes();
    (b.len() == 2 && b[0] == b'h' && (b'1'..=b'6').contains(&b[1])).then(|| (b[1] - b'0') as usize)
}

pub(super) fn is_block(tag: &str) -> bool {
    heading_level(tag).is_some()
        || matches!(
            tag,
            "address"
                | "article"
                | "aside"
                | "blockquote"
                | "center"
                | "dd"
                | "details"
                | "div"
                | "dl"
                | "dt"
                | "fieldset"
                | "figcaption"
                | "figure"
                | "footer"
                | "header"
                | "hgroup"
                | "hr"
                | "li"
                | "main"
                | "nav"
                | "ol"
                | "p"
                | "pre"
                | "section"
                | "summary"
                | "table"
                | "ul"
                | "video"
                | "audio"
        )
}

pub(super) fn align_of(e: &Element, inherited: TextAlign) -> TextAlign {
    let style_align = e.attribute("style").and_then(|s| {
        s.split(';').find_map(|d| {
            let (k, v) = d.split_once(':')?;
            (k.trim().eq_ignore_ascii_case("text-align")).then(|| v.trim().to_ascii_lowercase())
        })
    });
    let value = style_align.or_else(|| e.attribute("align").map(str::to_ascii_lowercase));
    match value.as_deref() {
        Some("center") => TextAlign::Center,
        Some("right") => TextAlign::Right,
        Some("left") => TextAlign::Left,
        _ if e.tag == "center" => TextAlign::Center,
        _ => inherited,
    }
}

pub(super) fn style_color(e: &Element, property: &str) -> Option<Rgba> {
    let style = e.attribute("style")?;
    style.split(';').find_map(|d| {
        let (k, v) = d.split_once(':')?;
        if k.trim().eq_ignore_ascii_case(property) {
            parse_css_color(v)
        } else {
            None
        }
    })
}

impl<'s, 'r, 'a, 'p> Surface<'s, 'r, 'a, 'p> {
    pub fn new(
        theme: &'s MarkdownTheme,
        document: &'s Path,
        view: WeakEntity<EditorView>,
        block: usize,
        render: &'r mut RenderCx<'a>,
        port: &'p mut dyn HtmlMediaPort,
    ) -> Self {
        Self {
            theme,
            document,
            view,
            block,
            render,
            port,
            details: 0,
            ids: 0,
            media: 0,
        }
    }

    pub(super) fn id(&mut self, part: &'static str) -> ElementId {
        self.ids += 1;
        ElementId::NamedInteger(part.into(), (self.block as u64) << 20 | self.ids as u64)
    }

    pub(super) fn tokens(&self) -> &'static Tokens {
        Tokens::get(self.theme.dark, self.theme.scale)
    }

    /// Renders `nodes` into a vertical column of `width`.
    pub fn render(&mut self, nodes: &[Node], width: f32) -> AnyElement {
        let base = Inherit {
            text: self.theme.body.text.clone(),
            align: TextAlign::Left,
            link: None,
            mono: false,
            background: None,
            underline: false,
            strike: false,
        };
        let children = self.flow(nodes, &base, width, 0);
        let mut root = div().w(px(width)).flex().flex_col();
        base.text.apply(root.style());
        root.children(children).into_any_element()
    }

    /// Renders block children in order, grouping runs of inline nodes into flows.
    /// Recursion is bounded by `MAX_HTML_DEPTH` (`TA-51`).
    pub(super) fn flow(
        &mut self,
        nodes: &[Node],
        inherit: &Inherit,
        width: f32,
        depth: usize,
    ) -> Vec<AnyElement> {
        if depth >= MAX_HTML_DEPTH {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut inline: Vec<Piece> = Vec::new();
        for node in nodes {
            match node {
                Node::Element(e) if is_block(&e.tag) => {
                    if !inline.is_empty() {
                        out.push(self.inline_flow(std::mem::take(&mut inline), inherit));
                    }
                    out.push(self.block_element(e, inherit, width, depth + 1));
                }
                _ => self.inline(node, inherit, &mut inline, depth + 1),
            }
        }
        if !inline.is_empty() {
            out.push(self.inline_flow(inline, inherit));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::BoundedMap;
    use core::prelude::v1::test;

    #[test]
    fn bounded_map_evicts_least_recently_used_entry() {
        let mut map = BoundedMap::new(3);
        map.insert(1u64, 10.0f32);
        map.insert(2, 20.0);
        map.insert(3, 30.0);
        assert_eq!(map.get(&1), Some(10.0));
        map.insert(4, 40.0);
        assert_eq!(map.len(), 3);
        assert_eq!(map.get(&2), None, "key 2 was least recently used");
        assert_eq!(map.get(&1), Some(10.0));
        assert_eq!(map.get(&4), Some(40.0));
    }
}
