//! `conflictMarkers.ts` + `ConflictMarkerBanner` (`CE-03`, `CE-21`):
//! universal Git conflict-marker detection and resolution shared across all
//! native text surfaces (code, plain text, JSON, HTML source, CSV source and
//! Markdown). Conflict blocks are computed at most once per committed document
//! revision (`CE-03`) with a zero-allocation rope chunk fast-path when no
//! `<<<<<<<` marker exists.
use super::ViewPlugin;
use crate::{
    editor::{
        text::{
            buffer::Buffer,
            change::Assoc,
            history::minimal_diff,
            state::{Applied, EditorState, Transaction, UserEvent},
        },
        view::editor::EditorView,
    },
    localization::{t, tf},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use std::{any::Any, cell::RefCell, rc::Rc};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub start: usize,
    pub end: usize,
    pub ours: String,
    pub theirs: String,
    pub ours_label: String,
    pub theirs_label: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Ours,
    Theirs,
}

fn open_label(line: &str) -> Option<&str> {
    line.strip_prefix("<<<<<<<").map(str::trim)
}

fn close_label(line: &str) -> Option<&str> {
    line.strip_prefix(">>>>>>>").map(str::trim)
}

fn separator(line: &str) -> bool {
    line.strip_prefix("=======")
        .is_some_and(|rest| rest.trim().is_empty())
}

/// Zero-allocation chunk check across `doc`: returns `false` immediately when
/// `"<<<<<<<"` cannot appear anywhere in `doc` (even across chunk seams).
pub fn may_contain_open_marker(doc: &Buffer) -> bool {
    if doc.len() < 7 {
        return false;
    }
    let mut tail_lt = 0usize;
    for chunk in doc.chunks_in(0..doc.len()) {
        if chunk.contains("<<<<<<<") {
            return true;
        }
        let leading_lt = chunk.bytes().take_while(|&b| b == b'<').count();
        if tail_lt + leading_lt >= 7 {
            return true;
        }
        tail_lt = chunk.bytes().rev().take_while(|&b| b == b'<').count();
    }
    false
}

/// `parseConflictMarkers` over a rope `Buffer` (`CE-02`, `CE-03`).
pub fn parse_buffer(doc: &Buffer) -> Vec<Block> {
    if !may_contain_open_marker(doc) {
        return Vec::new();
    }
    let text = doc.slice_cow(0..doc.len());
    parse(&text)
}

/// `parseConflictMarkers`.
pub fn parse(content: &str) -> Vec<Block> {
    if !content.contains("<<<<<<<") {
        return vec![];
    }
    let lines: Vec<&str> = content.split('\n').collect();
    let mut blocks = vec![];
    let mut index = 0;
    while index < lines.len() {
        let Some(ours_label) = open_label(lines[index]) else {
            index += 1;
            continue;
        };
        let (mut sep, mut end, mut theirs_label) = (None, None, "");
        for (cursor, line) in lines.iter().enumerate().skip(index + 1) {
            if sep.is_none() && separator(line) {
                sep = Some(cursor);
                continue;
            }
            if sep.is_some()
                && let Some(label) = close_label(line)
            {
                end = Some(cursor);
                theirs_label = label;
                break;
            }
        }
        let (Some(sep), Some(end)) = (sep, end) else {
            index += 1;
            continue;
        };
        blocks.push(Block {
            start: index,
            end,
            ours: lines[index + 1..sep].join("\n"),
            theirs: lines[sep + 1..end].join("\n"),
            ours_label: ours_label.into(),
            theirs_label: theirs_label.into(),
        });
        index = end + 1;
    }
    blocks
}

/// `resolveConflictMarkers`: `pick` returns the replacement of each block.
pub fn resolve(content: &str, pick: impl Fn(usize, &Block) -> String) -> String {
    let blocks = parse(content);
    if blocks.is_empty() {
        return content.into();
    }
    let mut lines: Vec<String> = content.split('\n').map(Into::into).collect();
    for (i, block) in blocks.iter().enumerate().rev() {
        let replacement = pick(i, block);
        let mut replacement: Vec<String> = replacement.split('\n').map(Into::into).collect();
        if replacement.last().is_some_and(String::is_empty) {
            replacement.pop();
        }
        lines.splice(block.start..=block.end, replacement);
    }
    lines.join("\n")
}

pub fn resolve_all(content: &str, side: Side) -> String {
    resolve(content, |_, b| match side {
        Side::Ours => b.ours.clone(),
        Side::Theirs => b.theirs.clone(),
    })
}

/// `pickOne`: the chosen side for `index`, the current side for the others.
pub fn resolve_one(content: &str, index: usize, side: Side) -> String {
    resolve(content, |i, b| {
        if i == index && side == Side::Theirs {
            b.theirs.clone()
        } else {
            b.ours.clone()
        }
    })
}

#[derive(Default)]
struct CachedConflicts {
    key: Option<(u64, usize)>,
    has_open_marker: Option<bool>,
    blocks: Rc<Vec<Block>>,
    expanded: bool,
    #[cfg(test)]
    parses: u64,
}

/// Universal revision-cached `ConflictMarkerBanner` plugin (`CE-03`, `CE-21`).
#[derive(Default)]
pub struct ConflictBannerPlugin {
    cache: RefCell<CachedConflicts>,
}

impl ConflictBannerPlugin {
    pub fn blocks_for(&self, doc: &Buffer, committed_revision: u64) -> Rc<Vec<Block>> {
        let key = (committed_revision, doc.len());
        let mut cache = self.cache.borrow_mut();
        if cache.key == Some(key) {
            return Rc::clone(&cache.blocks);
        }
        #[cfg(test)]
        {
            cache.parses += 1;
        }
        let open = may_contain_open_marker(doc);
        let parsed = Rc::new(if open {
            let text = doc.slice_cow(0..doc.len());
            parse(&text)
        } else {
            Vec::new()
        });
        cache.key = Some(key);
        cache.has_open_marker = Some(open);
        cache.blocks = Rc::clone(&parsed);
        parsed
    }

    pub fn toggle_expanded(&self) {
        let mut cache = self.cache.borrow_mut();
        cache.expanded = !cache.expanded;
    }

    pub fn is_expanded(&self) -> bool {
        self.cache.borrow().expanded
    }

    #[cfg(test)]
    pub fn parse_count(&self) -> u64 {
        self.cache.borrow().parses
    }
}

pub fn apply_conflict_resolution(
    view: &mut EditorView,
    resolved: &str,
    cx: &mut Context<EditorView>,
) {
    if view.read_only() {
        return;
    }
    view.commit_composition(cx);
    let Some(changes) = minimal_diff(&view.state().doc, resolved) else {
        return;
    };
    view.dispatch(
        Transaction::edit(changes, None, UserEvent::Command).with_scroll_into_view(false),
        cx,
    );
}

impl ViewPlugin for ConflictBannerPlugin {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    fn on_applied(&mut self, applied: &Applied, state: &EditorState) {
        if applied.is_annotation(crate::editor::text::state::Annotation::INPUT_COMPOSE) {
            return;
        }
        let prev_key = (state.revision.wrapping_sub(1), applied.before_doc.len());
        let mut cache = self.cache.borrow_mut();
        // O(1) fast-path (`CE-03`, `CE-30`): if the prior revision contained zero
        // `"<<<<<<<"` markers, only inspect lines touched by `applied.changes`.
        if cache.key == Some(prev_key)
            && cache.has_open_marker == Some(false)
            && !applied.changes.is_empty()
            && state.doc.line_count() > 0
        {
            let slices = applied.changes.changes();
            let first_old = slices.first().map_or(0, |c| c.range.start);
            let last_old = slices.last().map_or(0, |c| c.range.end);
            let new_start = state
                .doc
                .clamp(applied.changes.map(first_old, Assoc::Before));
            let new_end = state.doc.clamp(applied.changes.map(last_old, Assoc::After));
            let first_line = state.doc.line_index(new_start);
            let last_line = state
                .doc
                .line_index(new_end)
                .min(state.doc.line_count() - 1);
            let introduced_marker = (first_line..=last_line).any(|l| {
                state
                    .doc
                    .line_cow(l)
                    .as_bytes()
                    .windows(7)
                    .any(|w| w == b"<<<<<<<")
            });
            if !introduced_marker {
                cache.key = Some((state.revision, state.doc.len()));
                cache.has_open_marker = Some(false);
                cache.blocks = Rc::default();
            }
        }
    }

    fn header(&self, view: &EditorView, cx: &mut Context<EditorView>) -> Vec<AnyElement> {
        let doc = view.committed_doc();
        let blocks = self.blocks_for(doc, view.committed_revision());
        if blocks.is_empty() {
            return Vec::new();
        }
        let expanded = self.is_expanded();
        let read_only = view.read_only();
        let top_margin = 8. + view.chrome_inset();
        let p = cx.palette();
        let ty = crate::theme::ty();
        let button = |id: ElementId, label: String| {
            div()
                .id(id)
                .px(px(8.))
                .py(px(4.))
                .rounded(px(5.))
                .bg(p.control)
                .text_color(p.text)
                .text_size(px(ty.ui.meta))
                .hover(move |d| d.bg(p.control_hover))
                .cursor(crate::theme::clickable_cursor())
                .child(label)
        };
        let mut row = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(12.))
            .child(
                div()
                    .px(px(8.))
                    .py(px(2.))
                    .rounded(px(4.))
                    .bg(p.warning)
                    .text_color(p.text_inverse)
                    .text_size(px(ty.ui.caption))
                    .child(t("editor.conflict.badge")),
            )
            .child(tf(
                "editor.conflict.summary",
                &[("count", (blocks.len() as i64).into())],
            ));
        if !read_only {
            row = row
                .child(
                    button(
                        "conflict-keep-ours".into(),
                        t("editor.conflict.keepServer").into(),
                    )
                    .on_click(cx.listener(|v, _, _, cx| {
                        let cur = v.committed_doc().slice_cow(0..v.committed_doc().len());
                        let resolved = resolve_all(&cur, Side::Ours);
                        apply_conflict_resolution(v, &resolved, cx);
                    })),
                )
                .child(
                    button(
                        "conflict-keep-theirs".into(),
                        t("editor.conflict.keepIncoming").into(),
                    )
                    .on_click(cx.listener(|v, _, _, cx| {
                        let cur = v.committed_doc().slice_cow(0..v.committed_doc().len());
                        let resolved = resolve_all(&cur, Side::Theirs);
                        apply_conflict_resolution(v, &resolved, cx);
                    })),
                );
        }
        row = row.child(
            button(
                "conflict-toggle".into(),
                t(if expanded {
                    "editor.conflict.hideBlocks"
                } else {
                    "editor.conflict.showBlocks"
                })
                .into(),
            )
            .on_click(cx.listener(|v, _, _, cx| {
                if let Some(plugin) = v.plugin::<ConflictBannerPlugin>() {
                    plugin.toggle_expanded();
                }
                cx.notify();
            })),
        );
        let mut banner = div()
            .id("editor-conflict-banner")
            .flex_none()
            .mx(px(12.))
            .mt(px(top_margin))
            .mb(px(8.))
            .px(px(14.))
            .py(px(10.))
            .flex()
            .flex_col()
            .gap(px(10.))
            .border_1()
            .border_color(crate::theme::alpha(p.warning, 0.32))
            .rounded(px(8.))
            .bg(crate::theme::alpha(p.warning, 0.12))
            .text_color(p.text)
            .text_size(px(ty.ui.body))
            .child(row);
        if expanded {
            let total = blocks.len();
            for (index, block) in blocks.iter().enumerate() {
                let side = |side: Side,
                            label: &str,
                            content: &str,
                            cx: &mut Context<EditorView>| {
                    let mut title = div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .text_size(px(ty.ui.meta))
                        .text_color(p.muted)
                        .child(label.to_owned());
                    if !read_only {
                        title = title.child(
                            button(
                                ElementId::Name(format!("conflict-pick-{index}-{side:?}").into()),
                                t("editor.conflict.pick").into(),
                            )
                            .on_click(cx.listener(
                                move |v, _, _, cx| {
                                    let cur =
                                        v.committed_doc().slice_cow(0..v.committed_doc().len());
                                    let resolved = resolve_one(&cur, index, side);
                                    apply_conflict_resolution(v, &resolved, cx);
                                },
                            )),
                        );
                    }
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .child(title)
                        .child(
                            div()
                                .p(px(8.))
                                .rounded(px(5.))
                                .bg(p.inset)
                                .font(crate::ui::fonts::font(
                                    crate::typography::fonts::Role::Code,
                                    cx,
                                ))
                                .text_size(px(ty.ui.meta))
                                .child(content.to_owned()),
                        )
                };
                let ours_label = if block.ours_label.is_empty() {
                    t("editor.conflict.current").to_owned()
                } else {
                    block.ours_label.clone()
                };
                let theirs_label = if block.theirs_label.is_empty() {
                    t("editor.conflict.incoming").to_owned()
                } else {
                    block.theirs_label.clone()
                };
                banner = banner.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .child(
                            div()
                                .text_size(px(ty.ui.meta))
                                .text_color(p.subtle)
                                .child(tf(
                                    "editor.conflict.blockPosition",
                                    &[
                                        ("index", ((index + 1) as i64).into()),
                                        ("total", (total as i64).into()),
                                        ("line", ((block.start + 1) as i64).into()),
                                    ],
                                )),
                        )
                        .child(
                            div()
                                .flex()
                                .gap(px(10.))
                                .child(side(Side::Ours, &ours_label, &block.ours, cx))
                                .child(side(Side::Theirs, &theirs_label, &block.theirs, cx)),
                        ),
                );
            }
        }
        vec![banner.into_any_element()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    const DOC: &str = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\nb\n<<<<<<<\nx\n=======\ny\n>>>>>>>\nc";

    #[test]
    fn blocks_parse_with_labels_and_incomplete_markers_are_ignored() {
        let blocks = parse(DOC);
        assert_eq!(blocks.len(), 2);
        assert_eq!((blocks[0].start, blocks[0].end), (1, 5));
        assert_eq!(
            (blocks[0].ours.as_str(), blocks[0].theirs.as_str()),
            ("mine", "theirs")
        );
        assert_eq!(
            (
                blocks[0].ours_label.as_str(),
                blocks[0].theirs_label.as_str()
            ),
            ("HEAD", "feature")
        );
        assert_eq!(blocks[1].ours_label, "");
        assert!(parse("<<<<<<< HEAD\nno separator\n").is_empty());
        assert!(parse("plain").is_empty());
    }

    #[test]
    fn resolving_keeps_one_side_for_all_or_one_block() {
        assert_eq!(resolve_all(DOC, Side::Ours), "a\nmine\nb\nx\nc");
        assert_eq!(resolve_all(DOC, Side::Theirs), "a\ntheirs\nb\ny\nc");
        assert_eq!(resolve_one(DOC, 1, Side::Theirs), "a\nmine\nb\ny\nc");
        assert_eq!(
            resolve_all("q\n<<<<<<<\n\n=======\nz\n>>>>>>>", Side::Ours),
            "q"
        );
    }

    #[test]
    fn conflict_plugin_caches_by_committed_revision_without_flattening_clean_rope() {
        let big = Buffer::new("line without markers\n".repeat(4_000));
        let plugin = ConflictBannerPlugin::default();
        assert!(plugin.blocks_for(&big, 1).is_empty());
        assert!(
            !big.has_materialized_flat(),
            "chunk fast-path never flattens"
        );
        assert_eq!(plugin.parse_count(), 1);
        assert!(plugin.blocks_for(&big, 1).is_empty());
        assert_eq!(plugin.parse_count(), 1, "same revision hits cache");

        let conflicted = Buffer::new(DOC);
        assert_eq!(plugin.blocks_for(&conflicted, 2).len(), 2);
        assert_eq!(plugin.parse_count(), 2);
        assert_eq!(plugin.blocks_for(&conflicted, 2).len(), 2);
        assert_eq!(plugin.parse_count(), 2);
    }
}
