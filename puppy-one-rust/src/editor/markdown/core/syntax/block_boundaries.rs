//! Narrow block-boundary port (`TA-60`, `R8` `ADDON_CORE_PORTS`) exposing
//! top-level block and list-item sibling ranges to add-ons (such as
//! `addons::block_drag`) without coupling add-ons to full `Syntax` internals.
use super::{Span, Syntax};
use crate::editor::text::buffer::Buffer;
use std::rc::Rc;

/// Lazy on-demand provider so `addons::block_drag` queries `BlockBoundaries`
/// only when block-drag UI/commands actually run (`O(0)` overhead on normal typing).
pub type BoundaryProvider = Rc<dyn Fn(&Buffer, u64) -> BlockBoundaries>;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ListBoundary {
    pub range: Span,
    pub ordered: bool,
    pub items: Vec<usize>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ItemBoundary {
    pub range: Span,
    pub list: usize,
    pub depth: usize,
    pub marker: String,
    pub marker_from: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BlockBoundaries {
    pub revision: u64,
    pub live: bool,
    pub top_blocks: Vec<Span>,
    pub lists: Vec<ListBoundary>,
    pub items: Vec<ItemBoundary>,
}

impl BlockBoundaries {
    pub fn of(syntax: &Syntax, revision: u64, live: bool) -> Self {
        Self {
            revision,
            live,
            top_blocks: syntax.top_blocks.clone(),
            lists: syntax
                .lists
                .iter()
                .map(|l| ListBoundary {
                    range: l.range.clone(),
                    ordered: l.ordered,
                    items: l.items.clone(),
                })
                .collect(),
            items: syntax
                .items
                .iter()
                .map(|i| ItemBoundary {
                    range: i.range.clone(),
                    list: i.list,
                    depth: i.parents.len(),
                    marker: i.marker.clone(),
                    marker_from: i.marker_from,
                })
                .collect(),
        }
    }
}
