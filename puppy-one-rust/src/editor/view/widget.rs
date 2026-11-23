//! The block widget contract (CodeMirror `WidgetType` for
//! `Decoration.replace({ block: true })`): a widget replaces whole source
//! lines with its own boxes and text leaves; the document text inside stays
//! the one canonical source. Each frame the view tells a widget its state
//! (block-selected, focused, read-only) and gives it handlers back into the
//! editor: format commands and selecting the whole block.
//!
//! Block identity (`TA-14`) is backed by [`Anchor`]-tracked [`BlockId`]s:
//! element IDs and transient UI state in [`WidgetStateStore`] follow the
//! semantic block across edits above it and are evicted automatically when a
//! block unmounts.
use super::{command::Command, render::RenderCx};
use crate::editor::text::{
    anchor::Anchor,
    buffer::Buffer,
    change::{Assoc, ChangeSet},
};
use gpui::*;
use std::{
    any::{Any, TypeId},
    collections::{HashMap, HashSet},
    hash::{Hash, Hasher},
    ops::Range,
    rc::Rc,
};

/// Runs a format command through the editor, for handlers that only know
/// their command when they fire (a drop target, a menu choice).
pub type CommandSender = Rc<dyn Fn(Command, &mut Window, &mut App)>;

/// Returns keyboard focus to the editor.
pub type Focuser = Rc<dyn Fn(&mut Window, &mut App)>;

/// Stable identity of a block widget (`TA-03`, `TA-14`), carrying a monotonic
/// view/extension-assigned ID and an [`Anchor`] tracking its start offset
/// across document edits.
///
/// Equality and hashing compare the stable `id` so `ElementId`s and
/// [`WidgetStateStore`] entries survive edits above the block.
#[derive(Clone, Copy, Debug)]
pub struct BlockId {
    id: u64,
    anchor: Anchor,
}

impl PartialEq for BlockId {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for BlockId {}

impl Hash for BlockId {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

impl BlockId {
    const LINE_EMBED_TAG: u64 = 1u64 << 63;

    pub const fn new(id: u64, anchor: Anchor) -> Self {
        Self { id, anchor }
    }

    /// Ephemeral fallback ID for a line-level embed when no block registry ID
    /// was assigned.
    pub const fn for_line_embed(offset: usize, revision: u64) -> Self {
        Self {
            id: Self::LINE_EMBED_TAG | (offset as u64),
            anchor: Anchor::new(offset, Assoc::After, revision),
        }
    }

    pub const fn raw(&self) -> u64 {
        self.id
    }

    pub const fn anchor(&self) -> Anchor {
        self.anchor
    }

    pub fn map(&mut self, changes: &ChangeSet, new_revision: u64) {
        // Pure insertions right at the block's start push the block down
        // (`Assoc::After`), while an in-place replacement starting at the
        // block's start (such as a table structure rewrite) keeps the block
        // anchored at its start offset (`Assoc::Before`).
        let starts_replaced = changes
            .changes()
            .iter()
            .any(|c| c.range.start == self.anchor.offset && !c.range.is_empty());
        if starts_replaced {
            self.anchor.offset = changes.map(self.anchor.offset, Assoc::Before);
            self.anchor.revision = new_revision;
        } else {
            self.anchor.map(changes, new_revision);
        }
    }

    pub fn shift(&mut self, byte_delta: isize, new_revision: u64) {
        self.anchor.offset = ((self.anchor.offset as isize) + byte_delta) as usize;
        self.anchor.revision = new_revision;
    }

    pub fn mapped(mut self, changes: &ChangeSet, new_revision: u64) -> Self {
        self.map(changes, new_revision);
        self
    }

    pub fn resolve(&self, doc: &Buffer) -> usize {
        self.anchor.resolve(doc)
    }
}

/// Tracks active [`BlockId`]s across revisions via [`Anchor`] mapping (`TA-14`).
#[derive(Clone, Debug)]
pub struct BlockIdRegistry {
    next_id: u64,
    entries: Vec<(BlockId, &'static str)>,
}

impl Default for BlockIdRegistry {
    fn default() -> Self {
        Self {
            next_id: 1,
            entries: Vec::new(),
        }
    }
}

impl BlockIdRegistry {
    pub fn map(&mut self, changes: &ChangeSet, new_revision: u64) {
        for (id, _) in &mut self.entries {
            id.map(changes, new_revision);
        }
    }

    /// Reuse the existing [`BlockId`] whose mapped anchor sits at `offset`
    /// with matching `kind`, or mint a new stable ID.
    pub fn resolve_or_insert(
        &mut self,
        offset: usize,
        kind: &'static str,
        revision: u64,
    ) -> BlockId {
        if let Some((existing, _)) = self
            .entries
            .iter_mut()
            .find(|(id, k)| *k == kind && id.anchor.offset == offset)
        {
            existing.anchor.revision = revision;
            return *existing;
        }
        let id = BlockId::new(self.next_id, Anchor::after(offset, revision));
        self.next_id += 1;
        self.entries.push((id, kind));
        id
    }

    pub fn retain_live(&mut self, live: &HashSet<BlockId>) {
        self.entries.retain(|(id, _)| live.contains(id));
    }

    pub fn remove_ids(&mut self, dead: &[BlockId]) {
        if !dead.is_empty() {
            self.entries.retain(|(id, _)| !dead.contains(id));
        }
    }
}

/// View-scoped transient UI state indexed by [`BlockId`], automatically evicted
/// when blocks leave the document (`TA-14`).
#[derive(Default)]
pub struct WidgetStateStore {
    states: HashMap<(u64, TypeId), Box<dyn Any>>,
}

impl WidgetStateStore {
    pub fn get<T: 'static>(&self, id: BlockId) -> Option<&T> {
        self.states
            .get(&(id.raw(), TypeId::of::<T>()))
            .and_then(|v| v.downcast_ref::<T>())
    }

    pub fn get_mut<T: 'static>(&mut self, id: BlockId) -> Option<&mut T> {
        self.states
            .get_mut(&(id.raw(), TypeId::of::<T>()))
            .and_then(|v| v.downcast_mut::<T>())
    }

    pub fn get_or_default<T: Default + 'static>(&mut self, id: BlockId) -> &mut T {
        self.states
            .entry((id.raw(), TypeId::of::<T>()))
            .or_insert_with(|| Box::new(T::default()))
            .downcast_mut::<T>()
            .expect("WidgetStateStore type key matches value")
    }

    pub fn insert<T: 'static>(&mut self, id: BlockId, value: T) {
        self.states
            .insert((id.raw(), TypeId::of::<T>()), Box::new(value));
    }

    pub fn retain_live(&mut self, live: &HashSet<BlockId>) {
        let live_raw: HashSet<u64> = live.iter().map(BlockId::raw).collect();
        self.states.retain(|(raw, _), _| live_raw.contains(raw));
    }

    pub fn remove_ids(&mut self, dead: &[BlockId]) {
        if !dead.is_empty() {
            self.states
                .retain(|(raw, _), _| !dead.iter().any(|id| id.raw() == *raw));
        }
    }

    pub fn len(&self) -> usize {
        self.states.len()
    }

    pub fn is_empty(&self) -> bool {
        self.states.is_empty()
    }
}

/// What the view knows about a widget this frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WidgetState {
    /// The document selection covers the widget's whole source (the
    /// product's `is-doc-selected`).
    pub selected: bool,
    /// The caret or selection touches the widget's source.
    pub caret_inside: bool,
    /// The editor has keyboard focus.
    pub editor_focused: bool,
    pub read_only: bool,
    /// The document selection (`from`, `to`).
    pub selection: (usize, usize),
}

impl WidgetState {
    /// The state of a widget over `source` for a selection `from..to`.
    pub fn of(
        source: &Range<usize>,
        from: usize,
        to: usize,
        editor_focused: bool,
        read_only: bool,
    ) -> Self {
        let selected = from < to && from <= source.start && to >= source.end;
        let caret_inside = from <= source.end && to >= source.start;
        Self {
            selected,
            caret_inside,
            editor_focused,
            read_only,
            selection: (from, to),
        }
    }

    /// `:focus-within`: the editor is focused with the caret inside.
    pub fn focus_within(&self) -> bool {
        self.editor_focused && self.caret_inside
    }
}

/// One widget's frame: its stable identity, document geometry, state, and the
/// render context.
pub struct WidgetCx<'r, 'a> {
    pub block_id: BlockId,
    pub source: Range<usize>,
    /// Document top, column left and width of the block.
    pub top: f32,
    pub left: f32,
    pub width: f32,
    pub state: WidgetState,
    pub render: &'r mut RenderCx<'a>,
}

impl WidgetCx<'_, '_> {
    /// The block's positioned box of `height`.
    pub fn block_box(&self, height: f32) -> Div {
        self.render
            .block_box(self.top, self.left, self.width, height)
    }

    /// A stable element id for a part of this widget, keyed by [`BlockId`]
    /// rather than raw `source.start` (`TA-14`).
    pub fn id(&self, part: &'static str) -> ElementId {
        ElementId::NamedInteger(part.into(), self.block_id.raw())
    }

    /// Access or initialise transient UI state scoped to this widget's
    /// [`BlockId`] (`TA-14`).
    pub fn with_widget_state<T: Default + 'static, R>(&mut self, f: impl FnOnce(&mut T) -> R) -> R {
        let mut store = self.render.widget_states.borrow_mut();
        f(store.get_or_default::<T>(self.block_id))
    }

    pub fn sender(&self) -> CommandSender {
        let view = self.render.view.clone();
        Rc::new(move |command, window, cx| {
            let _ = view.update(cx, |v, cx| v.run_command(&command, window, cx));
        })
    }

    /// A handler returning keyboard focus to the editor.
    pub fn focuser(&self) -> Focuser {
        let view = self.render.view.clone();
        Rc::new(move |window, cx| {
            let _ = view.update(cx, |v, cx| v.focus(window, cx));
        })
    }
}

/// A line's content in place of its text (`LineStyle::embed`). `cx.top`
/// is the content box's document top, `cx.left` 0 and `cx.width` its
/// width; the element is placed at the content box's origin.
pub trait LineEmbed {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32);
}

pub trait BlockWidget: Any {
    /// The widget's box (at `cx.top` in a column of `cx.width`), with text
    /// leaves registered through `cx.render`. Returns the element and its
    /// height.
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32);

    /// Semantic equality check (`TA-14`): when `true`, the view/decorator can
    /// reuse the existing `Rc<dyn BlockWidget>` instance across rebuilds.
    fn eq_widget(&self, _other: &dyn BlockWidget) -> bool {
        false
    }

    /// Optional in-place update (`TA-14`) when the block keeps its [`BlockId`].
    fn update(&mut self, _next: &dyn BlockWidget) -> bool {
        false
    }

    /// Initial height estimate before the widget has been laid out.
    fn estimate_height(&self, lines: Range<usize>, _width: f32) -> f32 {
        lines.len() as f32 * 24. + 24.
    }

    fn as_widget_any(&self) -> Option<&dyn Any> {
        None
    }
}

const WIDGET_PANIC_EVENT: &str = "[editor-view] widget render panicked";

fn log_widget_panic_once(stage: &'static str, payload: Box<dyn Any + Send>) {
    use std::sync::{Mutex, OnceLock};
    static REPORTED: OnceLock<Mutex<HashSet<&'static str>>> = OnceLock::new();
    let first = REPORTED
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(stage);
    if first {
        let message = payload
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "widget render panicked".to_owned());
        crate::platform::diagnostics::warn(
            WIDGET_PANIC_EVENT,
            serde_json::json!({
                "stage": stage,
                "message": message,
            }),
        );
    }
}

/// Render a [`BlockWidget`] with panic isolation (`TA-33`). On panic, rolls
/// back any partial leaves registered during the failed call and returns `None`
/// so the caller renders visible fallback source lines instead.
pub fn render_block_widget_safely(
    widget: &dyn BlockWidget,
    cx: &mut WidgetCx,
) -> Option<(AnyElement, f32)> {
    let leaves_before = cx.render.leaves.len();
    let keys_before = cx.render.keys.clone();
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| widget.render(cx))) {
        Ok(out) => Some(out),
        Err(payload) => {
            cx.render.leaves.truncate(leaves_before);
            cx.render.keys = keys_before;
            cx.render.rooms.clear();
            log_widget_panic_once("BlockWidget::render", payload);
            None
        }
    }
}

/// Render a [`LineEmbed`] with panic isolation (`TA-33`). On panic, rolls back
/// partial leaves and returns `None` so the line renders its plain source text.
pub fn render_line_embed_safely(
    embed: &dyn LineEmbed,
    cx: &mut WidgetCx,
) -> Option<(AnyElement, f32)> {
    let leaves_before = cx.render.leaves.len();
    let keys_before = cx.render.keys.clone();
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| embed.render(cx))) {
        Ok(out) => Some(out),
        Err(payload) => {
            cx.render.leaves.truncate(leaves_before);
            cx.render.keys = keys_before;
            cx.render.rooms.clear();
            log_widget_panic_once("LineEmbed::render", payload);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{BlockId, BlockIdRegistry, WidgetState, WidgetStateStore};
    use crate::editor::text::{buffer::Buffer, change::ChangeSet};
    use std::collections::HashSet;

    #[test]
    fn a_widget_is_block_selected_only_when_the_selection_covers_it() {
        let source = 10..20;
        assert!(WidgetState::of(&source, 5, 25, true, false).selected);
        assert!(WidgetState::of(&source, 10, 20, true, false).selected);
        assert!(!WidgetState::of(&source, 12, 25, true, false).selected);
        // A caret inside (or at an edge) is focus-within only when focused.
        let caret = WidgetState::of(&source, 15, 15, false, false);
        assert!(caret.caret_inside && !caret.selected && !caret.focus_within());
        assert!(WidgetState::of(&source, 20, 20, true, false).focus_within());
        assert!(!WidgetState::of(&source, 30, 30, true, false).caret_inside);
    }

    #[test]
    fn block_id_preserves_identity_and_widget_state_across_edits_and_evicts_on_unmount() {
        let mut doc = Buffer::new("intro\n```rust\nfn main() {}\n```\n");
        let mut registry = BlockIdRegistry::default();
        let fence_start = 6;
        let id_before = registry.resolve_or_insert(fence_start, "code_block", 0);

        let mut store = WidgetStateStore::default();
        *store.get_or_default::<usize>(id_before) = 42;

        // Edit above the fenced block shifts its byte offset by +10 bytes.
        let cs = ChangeSet::replace(0..5, "longer heading!");
        cs.apply(&mut doc);
        registry.map(&cs, 1);

        let id_after = registry.resolve_or_insert(fence_start + 10, "code_block", 1);
        assert_eq!(id_before, id_after);
        assert_eq!(id_before.raw(), id_after.raw());
        assert_eq!(id_after.resolve(&doc), fence_start + 10);
        assert_eq!(store.get::<usize>(id_after), Some(&42));

        // Unmounting the block evicts its transient state from the store.
        let empty_live: HashSet<BlockId> = HashSet::new();
        registry.retain_live(&empty_live);
        store.retain_live(&empty_live);
        assert!(store.is_empty());
    }
}
