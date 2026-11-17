//! Unified native code & plain-text extension on [`EditorView`] (`CE-01`,
//! `CE-03`, `CE-10`, `CE-11`, `CE-12`):
//! - Pure `&self` two-layer decorations (`TA-11`): Document Layer caches syntax
//!   highlighting, fold regions, trailing-whitespace marks, gutter numbers,
//!   fold chevrons, and `codeIndentGuides` (`CE-12`) once per `(revision, len,
//!   language, soft_wrap, dark, scale, theme_key)` (`CE-03`).
//! - Reveal Layer (`decorate_reveal`) patches only the lines intersecting the
//!   active cursor line, bracket match, selection matches, or HTML visual
//!   highlight — preserving syntax token colours while avoiding whole-document
//!   rebuilds on cursor motion.
//! - Markdown source panels (`Language("markdown")`) highlight via
//!   [`crate::editor::markdown::source_highlights`] (`CE-10`), and all syntax
//!   roles evaluate through [`Tokens::get`] (`CE-11`).
use super::{
    decorate::{
        Brackets, brackets_in_buffer, indent_guides_for_line, selection_matches_in_buffer,
        trailing_whitespace_in_buffer,
    },
    editing::{filter_typing_transaction, intercept_intent},
    folding::{FoldState, FoldedCodeWidget, compute_fold_ranges},
    highlight::{Roles, SyntaxColors},
    language::Language,
};
use crate::{
    editor::{
        text::{
            buffer::Buffer,
            change::Assoc,
            selection::Selection,
            state::{Applied, EditorState, StateEffect, Transaction},
        },
        tokens::Tokens,
        view::{
            command::Command,
            decoration::{
                Block, BlockSplice, Decorations, InlineWidget, Mark, MarkStyle, RevealLayer,
                RevealPatch, Surface, next_decorations_id, packed,
            },
            extension::{DecorateInput, EditIntent, EditorExtension, SetAppearance, SetReadOnly},
            style::{Align, Edges, LineHeight, LineStyle, Paint, Rect, TextStyle},
            widget::BlockId,
        },
    },
    theme::{self, Theme},
    typography::Scale,
};
use gpui::Rgba;
use gpui_kit::component::{Rope as KitRope, highlighter::SyntaxHighlighter};
use std::{
    cell::RefCell,
    collections::{BTreeSet, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    ops::Range,
    rc::Rc,
};

pub const FOLD_FEATURE_ID: &str = "code.fold";
const MAX_SYNTAX_BYTES: usize = 1024 * 1024;
const MAX_GUTTER_OVERLAY_LINES: usize = 25_000;

/// `.cm-lineNumbers` (36px) + `.cm-foldGutter` (16px) + `.cm-line` inset (8px).
const GUTTER_NUM_WIDTH: f32 = 36.;
const GUTTER_NUM_PAD_LEFT: f32 = 8.;
const GUTTER_NUM_PAD_RIGHT: f32 = 9.;
const GUTTER_FOLD_WIDTH: f32 = 16.;
const LINE_TEXT_INSET: f32 = 8.;
const TOTAL_LEFT_INSET: f32 = GUTTER_NUM_WIDTH + GUTTER_FOLD_WIDTH + LINE_TEXT_INSET;
const CODE_LINE_HEIGHT: f32 = 20.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SetCodeLanguage(pub Language);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SetSoftWrap(pub bool);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SetVisualHighlight(pub Option<Range<usize>>);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SetFoldedLines(pub Vec<usize>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UnfoldOffset(pub usize);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ToggleCodeFold {
    pub line: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct DerivedKey {
    revision: u64,
    len: usize,
    language: &'static str,
    dark: bool,
    scale: u8,
    theme_key: u64,
}

#[derive(Clone)]
struct CodeEditSplice {
    from_rev: u64,
    to_rev: u64,
    old_lines: Range<usize>,
    new_lines: Range<usize>,
    old_bytes: Range<usize>,
    new_bytes: Range<usize>,
    byte_delta: isize,
}

struct CachedCodeDecos {
    doc_key: u64,
    dark: bool,
    revision: u64,
    decos: Rc<Decorations>,
}

#[derive(Default)]
struct DerivedCache {
    key: Option<DerivedKey>,
    syntax_marks: Vec<Mark>,
    trailing_ws: Vec<Range<usize>>,
    fold_ranges: Vec<Range<usize>>,
    last_edit: Option<CodeEditSplice>,
    doc_decos: Option<CachedCodeDecos>,
    #[cfg(test)]
    pub recompute_count: u64,
}

pub struct CodeExtension {
    pub language: Language,
    pub soft_wrap: bool,
    pub dark: bool,
    pub scale: Scale,
    pub read_only: bool,
    pub visual_highlight: Option<Range<usize>>,
    folds: FoldState,
    fold_epoch: u64,
    config_epoch: u64,
    cache: RefCell<DerivedCache>,
}

impl CodeExtension {
    pub fn new(language: Language, soft_wrap: bool, dark: bool, scale: Scale) -> Self {
        Self {
            language,
            soft_wrap,
            dark,
            scale,
            read_only: false,
            visual_highlight: None,
            folds: FoldState::default(),
            fold_epoch: 0,
            config_epoch: 0,
            cache: RefCell::new(DerivedCache::default()),
        }
    }

    pub fn folded_lines(&self, doc: &Buffer) -> Vec<usize> {
        self.folds.folded_lines(doc)
    }

    #[cfg(test)]
    pub fn derived_recompute_count(&self) -> u64 {
        self.cache.borrow().recompute_count
    }

    fn code_text_style(&self, dark: bool) -> TextStyle {
        let t = Tokens::get(dark, self.scale);
        TextStyle {
            size: self.scale.metrics().editor.code,
            weight: 400.,
            italic: false,
            mono: true,
            color: t.color("--po-md-content-color"),
            tabular: false,
            line_height: LineHeight::Px(CODE_LINE_HEIGHT),
            face: Default::default(),
        }
    }

    fn number_text_style(&self, color: Rgba, weight: f32) -> TextStyle {
        TextStyle {
            size: self.scale.metrics().ui.hint,
            weight,
            italic: false,
            mono: true,
            color,
            tabular: true,
            line_height: LineHeight::Px(CODE_LINE_HEIGHT),
            face: Default::default(),
        }
    }

    fn surface_style(&self, dark: bool) -> Surface {
        let p = Theme::new(dark);
        let t = Tokens::get(dark, self.scale);
        Surface {
            content: Edges::new(8., 12., 24., 0.),
            max_text_width: None,
            background: t.color("--po-editor-bg"),
            selection: t.color("--po-md-selection-bg"),
            selection_inactive: theme::alpha(p.text, 0.08),
            caret: p.accent,
            caret_width: 2.,
            link: p.accent_text,
            link_plain: false,
            inline_code: None,
            inline_code_background: None,
            inline_code_padding: None,
        }
    }

    fn ensure_derived(&self, state: &EditorState, dark: bool) {
        let theme_key = crate::editor::tokens::theme_key();
        let want = DerivedKey {
            revision: state.revision,
            len: state.doc.len(),
            language: self.language.0,
            dark,
            scale: self.scale as u8,
            theme_key,
        };
        let mut cache = self.cache.borrow_mut();
        if cache.key == Some(want) {
            return;
        }
        #[cfg(test)]
        {
            cache.recompute_count += 1;
        }
        let colors = SyntaxColors::resolve(dark, self.scale);
        cache.syntax_marks = compute_syntax_marks(&state.doc, self.language, &colors);
        cache.trailing_ws = trailing_whitespace_in_buffer(&state.doc);
        cache.fold_ranges = compute_fold_ranges(&state.doc, self.language);
        cache.key = Some(want);
        cache.last_edit = None;
        cache.doc_decos = None;
    }

    fn build_line_style(
        &self,
        doc: &Buffer,
        line: usize,
        dark: bool,
        active: bool,
        foldable: Option<bool>,
    ) -> LineStyle {
        let p = Theme::new(dark);
        let text = self.code_text_style(dark);
        let tab_size = self.language.tab_size();
        let ch = text.ch();
        let mut overlays = Vec::new();
        let mut hotspots = Vec::new();

        // Line number in `.cm-lineNumbers` (`36px` box, right-aligned).
        let num_color = if active {
            p.text
        } else {
            theme::alpha(p.text, 0.34)
        };
        let num_weight = if active { 500. } else { 400. };
        overlays.push(Paint::Label {
            rect: Rect::new(
                GUTTER_NUM_PAD_LEFT,
                0.,
                GUTTER_NUM_WIDTH - GUTTER_NUM_PAD_LEFT - GUTTER_NUM_PAD_RIGHT,
                CODE_LINE_HEIGHT,
            ),
            text: format!("{}", line + 1).into(),
            style: self.number_text_style(num_color, num_weight),
            align: Align::End,
        });

        // Fold chevron in `.cm-foldGutter` (`16px` box).
        if let Some(folded) = foldable {
            let fold_rect = Rect::new(GUTTER_NUM_WIDTH, 0., GUTTER_FOLD_WIDTH, CODE_LINE_HEIGHT);
            overlays.push(Paint::Label {
                rect: fold_rect,
                text: (if folded { "▸" } else { "▾" }).into(),
                style: self.number_text_style(theme::alpha(p.text, 0.52), 400.),
                align: Align::Center,
            });
            hotspots.push((
                fold_rect,
                Command::new(FOLD_FEATURE_ID, ToggleCodeFold { line }),
            ));
        }

        // CE-12: `codeIndentGuides.ts` vertical rules (capped at 16 columns).
        if self.language.0 != "plaintext" {
            let line_str = doc.line_cow(line);
            let guide_color = theme::alpha(p.text, 0.10);
            for (_, col) in indent_guides_for_line(&line_str, tab_size, tab_size) {
                let x = TOTAL_LEFT_INSET + (col as f32) * ch;
                overlays.push(Paint::fill(
                    Rect::new(x, 0., 1., CODE_LINE_HEIGHT),
                    guide_color,
                ));
            }
        }

        LineStyle {
            text,
            padding: Edges::new(0., 12., 0., TOTAL_LEFT_INSET),
            border: Edges::default(),
            border_color: None,
            background: active.then(|| theme::alpha(p.text, 0.04)),
            background_radii: [0.; 4],
            inset_bottom: None,
            strike: false,
            nowrap: !self.soft_wrap,
            tab_size: Some(tab_size),
            overlays,
            hotspots,
            trailing: None,
            embed: None,
        }
    }
}

fn compute_syntax_marks(doc: &Buffer, language: Language, colors: &SyntaxColors) -> Vec<Mark> {
    if doc.is_empty() || doc.len() > MAX_SYNTAX_BYTES {
        return Vec::new();
    }
    if language.is_markdown() {
        return crate::editor::markdown::source_highlights(doc, colors);
    }
    let Some(grammar) = language.grammar() else {
        return Vec::new();
    };
    let text = doc.slice_cow(0..doc.len());
    let mut highlighter = SyntaxHighlighter::new(grammar);
    highlighter.update(None, &KitRope::from(text.as_ref()), None);
    let roles = Roles(colors.clone());
    let keyword_rgba = colors.keyword;
    let raw = highlighter.styles(&(0..text.len()), &roles);
    let mut out: Vec<Mark> = Vec::with_capacity(raw.len());
    for (range, hs) in raw {
        if range.is_empty() {
            continue;
        }
        let Some(hsla) = hs.color else {
            continue;
        };
        let rgba: Rgba = hsla.into();
        let style = MarkStyle {
            bold: rgba == keyword_rgba,
            color: Some(packed(rgba)),
            ..Default::default()
        };
        match out.last_mut() {
            Some(last) if last.range.end == range.start && last.style == style => {
                last.range.end = range.end;
            }
            Some(last) if range.start < last.range.end => {
                let prev_end = last.range.end;
                if range.end > prev_end {
                    out.push(Mark {
                        range: prev_end..range.end,
                        style,
                    });
                }
            }
            _ => out.push(Mark { range, style }),
        }
    }
    out
}

/// Overlay highlight `tints` (`(range, highlight_packed)`) onto sorted `base`
/// marks inside `bounds`, producing sorted non-overlapping [`Mark`]s.
fn overlay_highlights_in(
    bounds: Range<usize>,
    base: &[Mark],
    tints: &[(Range<usize>, u32)],
) -> Vec<Mark> {
    if bounds.is_empty() {
        return Vec::new();
    }
    if tints.is_empty() {
        return base
            .iter()
            .filter_map(|m| {
                let s = m.range.start.max(bounds.start);
                let e = m.range.end.min(bounds.end);
                (s < e).then(|| Mark {
                    range: s..e,
                    style: m.style.clone(),
                })
            })
            .collect();
    }
    let mut cuts = vec![bounds.start, bounds.end];
    for m in base {
        if m.range.end > bounds.start && m.range.start < bounds.end {
            cuts.push(m.range.start.max(bounds.start));
            cuts.push(m.range.end.min(bounds.end));
        }
    }
    for (r, _) in tints {
        if r.end > bounds.start && r.start < bounds.end {
            cuts.push(r.start.max(bounds.start));
            cuts.push(r.end.min(bounds.end));
        }
    }
    cuts.sort_unstable();
    cuts.dedup();
    let mut out: Vec<Mark> = Vec::new();
    for pair in cuts.windows(2) {
        let seg = pair[0]..pair[1];
        let mut style = base
            .iter()
            .find(|m| m.range.start <= seg.start && m.range.end >= seg.end)
            .map(|m| m.style.clone())
            .unwrap_or_default();
        for (r, tint) in tints {
            if r.start <= seg.start && r.end >= seg.end {
                style.highlight = Some(*tint);
            }
        }
        if style.is_plain() {
            continue;
        }
        match out.last_mut() {
            Some(last) if last.range.end == seg.start && last.style == style => {
                last.range.end = seg.end;
            }
            _ => out.push(Mark { range: seg, style }),
        }
    }
    out
}

impl EditorExtension for CodeExtension {
    fn filter_transaction(&self, tr: &mut Transaction, state: &EditorState, read_only: bool) {
        filter_typing_transaction(self.language, tr, state, read_only);
    }

    fn apply_effects(
        &mut self,
        effects: &[StateEffect],
        state: &EditorState,
        read_only: bool,
    ) -> bool {
        let mut changed = false;
        if self.read_only != read_only {
            self.read_only = read_only;
            changed = true;
        }
        for eff in effects {
            if let Some(ro) = eff.downcast_ref::<SetReadOnly>()
                && self.read_only != ro.0
            {
                self.read_only = ro.0;
                changed = true;
            }
            if let Some(app) = eff.downcast_ref::<SetAppearance>()
                && (self.dark, self.scale) != (app.dark, app.scale)
            {
                self.dark = app.dark;
                self.scale = app.scale;
                self.config_epoch = self.config_epoch.wrapping_add(1);
                changed = true;
            }
            if let Some(lang) = eff.downcast_ref::<SetCodeLanguage>()
                && self.language != lang.0
            {
                self.language = lang.0;
                self.config_epoch = self.config_epoch.wrapping_add(1);
                changed = true;
            }
            if let Some(sw) = eff.downcast_ref::<SetSoftWrap>()
                && self.soft_wrap != sw.0
            {
                self.soft_wrap = sw.0;
                self.config_epoch = self.config_epoch.wrapping_add(1);
                changed = true;
            }
            if let Some(vh) = eff.downcast_ref::<SetVisualHighlight>()
                && self.visual_highlight != vh.0
            {
                self.visual_highlight = vh.0.clone();
                changed = true;
            }
            if let Some(fl) = eff.downcast_ref::<SetFoldedLines>() {
                self.folds
                    .set_folded_lines(&state.doc, &fl.0, state.revision);
                self.fold_epoch = self.fold_epoch.wrapping_add(1);
                changed = true;
            }
            if let Some(unfold) = eff.downcast_ref::<UnfoldOffset>() {
                self.ensure_derived(state, self.dark);
                let regions = self.cache.borrow().fold_ranges.clone();
                if self.folds.unfold_containing(&state.doc, &regions, unfold.0) {
                    self.fold_epoch = self.fold_epoch.wrapping_add(1);
                    changed = true;
                }
            }
        }
        changed
    }

    fn prepare_applied(&mut self, applied: &Applied, state: &EditorState) {
        self.folds.map_changes(&applied.changes, state.revision);

        if applied.changes.is_empty()
            || applied.before_doc.line_count() == 0
            || state.doc.line_count() == 0
        {
            return;
        }
        let slices = applied.changes.changes();
        let first_old = slices.first().map_or(0, |c| c.range.start);
        let last_old = slices.last().map_or(0, |c| c.range.end);
        let old_first_line = applied.before_doc.line_index(first_old);
        let old_last_line = applied
            .before_doc
            .line_index(last_old)
            .min(applied.before_doc.line_count() - 1);
        let old_lines = old_first_line..(old_last_line + 1);
        let old_bytes = applied.before_doc.line_range(old_first_line).start
            ..applied.before_doc.line_range(old_last_line).end;

        let new_start_off = state
            .doc
            .clamp(applied.changes.map(first_old, Assoc::Before));
        let new_end_off = state.doc.clamp(applied.changes.map(last_old, Assoc::After));
        let new_first_line = state.doc.line_index(new_start_off);
        let new_last_line = state
            .doc
            .line_index(new_end_off)
            .min(state.doc.line_count() - 1);
        let new_lines = new_first_line..(new_last_line + 1);
        let new_bytes =
            state.doc.line_range(new_first_line).start..state.doc.line_range(new_last_line).end;
        let byte_delta = state.doc.len() as isize - applied.before_doc.len() as isize;

        let from_rev = state.revision.wrapping_sub(1);
        let theme_key = crate::editor::tokens::theme_key();
        let prev_key = DerivedKey {
            revision: from_rev,
            len: applied.before_doc.len(),
            language: self.language.0,
            dark: self.dark,
            scale: self.scale as u8,
            theme_key,
        };
        let mut cache = self.cache.borrow_mut();
        let syntax_exempt = self.language.0 == "plaintext" || state.doc.len() > MAX_SYNTAX_BYTES;
        if cache.key == Some(prev_key)
            && syntax_exempt
            && self.folds.is_empty()
            && cache.fold_ranges.is_empty()
            && old_lines.len() == new_lines.len()
        {
            if state.doc.len() > super::decorate::MAX_PASSIVE_SCAN_BYTES {
                cache.trailing_ws.clear();
            } else {
                let p_end = cache
                    .trailing_ws
                    .partition_point(|r| r.end <= old_bytes.start);
                let s_start = cache
                    .trailing_ws
                    .partition_point(|r| r.start < old_bytes.end)
                    .max(p_end);
                let mut local_ws = Vec::new();
                for l in new_lines.clone() {
                    let lr = state.doc.line_range(l);
                    if !lr.is_empty() {
                        let ls = state.doc.line_cow(l);
                        let trimmed = ls.trim_end_matches([' ', '\t']).len();
                        if trimmed < ls.len() {
                            local_ws.push(lr.start + trimmed..lr.end);
                        }
                    }
                }
                let mut next_ws = Vec::with_capacity(
                    p_end + local_ws.len() + (cache.trailing_ws.len() - s_start),
                );
                next_ws.extend_from_slice(&cache.trailing_ws[..p_end]);
                next_ws.extend(local_ws);
                for r in &cache.trailing_ws[s_start..] {
                    let s = (r.start as isize + byte_delta) as usize;
                    let e = (r.end as isize + byte_delta) as usize;
                    next_ws.push(s..e);
                }
                cache.trailing_ws = next_ws;
            }
            cache.syntax_marks.clear();
            cache.key = Some(DerivedKey {
                revision: state.revision,
                len: state.doc.len(),
                ..prev_key
            });
            cache.last_edit = Some(CodeEditSplice {
                from_rev,
                to_rev: state.revision,
                old_lines,
                new_lines,
                old_bytes,
                new_bytes,
                byte_delta,
            });
        } else {
            cache.last_edit = None;
        }
    }

    fn supports_layered_decorations(&self) -> bool {
        true
    }

    fn document_decoration_key(&self) -> u64 {
        let mut h = DefaultHasher::new();
        (
            self.language.0,
            self.soft_wrap,
            self.scale as u8,
            crate::editor::tokens::theme_key(),
            self.fold_epoch,
            self.config_epoch,
        )
            .hash(&mut h);
        h.finish()
    }

    fn reveal_decoration_key(&self) -> u64 {
        let mut h = DefaultHasher::new();
        self.visual_highlight.hash(&mut h);
        h.finish()
    }

    fn decorate_document(&self, state: &EditorState, dark: bool) -> Rc<Decorations> {
        let doc_key = self.document_decoration_key();
        self.ensure_derived(state, dark);
        {
            let cache = self.cache.borrow();
            if let Some(ref cached) = cache.doc_decos
                && cached.doc_key == doc_key
                && cached.dark == dark
                && cached.revision == state.revision
            {
                return Rc::clone(&cached.decos);
            }
        }

        let p = Theme::new(dark);
        let ws_tint = packed(theme::alpha(p.danger, 0.20));

        // O(1) incremental Document Layer splice (`TA-13`, `CE-03`, `CE-30`):
        // moves the existing `Vec<Block>` without cloning untouched lines and
        // hands `HeightMap` a narrow `BlockSplice` covering only `edit.new_lines`.
        let can_incremental = {
            let cache = self.cache.borrow();
            match (&cache.last_edit, &cache.doc_decos) {
                (Some(edit), Some(prev)) => {
                    edit.to_rev == state.revision
                        && prev.revision == edit.from_rev
                        && prev.doc_key == doc_key
                        && prev.dark == dark
                        && edit.old_lines.len() == edit.new_lines.len()
                        && self.folds.is_empty()
                        && cache.fold_ranges.is_empty()
                        && cache.syntax_marks.is_empty()
                        && prev.decos.blocks.len() == state.doc.line_count()
                }
                _ => false,
            }
        };
        if can_incremental {
            let (edit, prev_decos, trailing_empty, new_ws_marks) = {
                let mut cache = self.cache.borrow_mut();
                let edit = cache.last_edit.take().unwrap();
                let prev = cache.doc_decos.take().unwrap();
                let trailing_empty = cache.trailing_ws.is_empty();
                let new_ws_marks: Vec<Mark> = if trailing_empty {
                    Vec::new()
                } else {
                    let first = cache
                        .trailing_ws
                        .partition_point(|r| r.end <= edit.new_bytes.start);
                    let last = cache
                        .trailing_ws
                        .partition_point(|r| r.start < edit.new_bytes.end)
                        .max(first);
                    cache.trailing_ws[first..last]
                        .iter()
                        .map(|r| Mark {
                            range: r.clone(),
                            style: MarkStyle {
                                highlight: Some(ws_tint),
                                ..Default::default()
                            },
                        })
                        .collect()
                };
                (edit, prev.decos, trailing_empty, new_ws_marks)
            };
            let base_ptr = prev_decos.id as usize;
            let mut owned = Rc::unwrap_or_clone(prev_decos);
            owned.id = next_decorations_id();
            if state.doc.line_count() <= MAX_GUTTER_OVERLAY_LINES {
                for l in edit.new_lines.clone() {
                    owned.blocks[l] = Block::Line {
                        line: l,
                        style: Rc::new(self.build_line_style(&state.doc, l, dark, false, None)),
                    };
                }
            }
            if trailing_empty {
                owned.marks.clear();
            } else {
                let p_end = owned
                    .marks
                    .partition_point(|m| m.range.end <= edit.old_bytes.start);
                let s_start = owned
                    .marks
                    .partition_point(|m| m.range.start < edit.old_bytes.end)
                    .max(p_end);
                let mut next_marks =
                    Vec::with_capacity(p_end + new_ws_marks.len() + (owned.marks.len() - s_start));
                next_marks.extend_from_slice(&owned.marks[..p_end]);
                next_marks.extend(new_ws_marks);
                for m in &owned.marks[s_start..] {
                    let s = (m.range.start as isize + edit.byte_delta) as usize;
                    let e = (m.range.end as isize + edit.byte_delta) as usize;
                    next_marks.push(Mark {
                        range: s..e,
                        style: m.style.clone(),
                    });
                }
                owned.marks = next_marks;
            }
            owned.surface = self.surface_style(dark);
            owned.splice = Some(BlockSplice {
                base_ptr,
                old_blocks: edit.old_lines,
                new_blocks: edit.new_lines,
            });
            let next_rc = Rc::new(owned);
            self.cache.borrow_mut().doc_decos = Some(CachedCodeDecos {
                doc_key,
                dark,
                revision: state.revision,
                decos: Rc::clone(&next_rc),
            });
            return next_rc;
        }

        let (marks, fold_ranges) = {
            let cache = self.cache.borrow();
            let ws_tints: Vec<(Range<usize>, u32)> = cache
                .trailing_ws
                .iter()
                .map(|r| (r.clone(), ws_tint))
                .collect();
            let marks = overlay_highlights_in(0..state.doc.len(), &cache.syntax_marks, &ws_tints);
            (marks, cache.fold_ranges.clone())
        };

        let line_count = state.doc.line_count();
        let mut blocks = Vec::with_capacity(line_count);
        let mut inline_widgets = Vec::new();
        let mut atomic = Vec::new();

        if line_count > MAX_GUTTER_OVERLAY_LINES {
            let shared = Rc::new(LineStyle {
                text: self.code_text_style(dark),
                padding: Edges::new(0., 12., 0., TOTAL_LEFT_INSET),
                nowrap: !self.soft_wrap,
                tab_size: Some(self.language.tab_size()),
                ..LineStyle::default()
            });
            for line in 0..line_count {
                blocks.push(Block::Line {
                    line,
                    style: Rc::clone(&shared),
                });
            }
        } else {
            let mut line = 0usize;
            while line < line_count {
                let region = fold_ranges.iter().find(|r| r.start == line);
                let is_folded = region.is_some() && self.folds.is_folded(&state.doc, line);
                let foldable = region.map(|_| is_folded);
                let style = Rc::new(self.build_line_style(&state.doc, line, dark, false, foldable));
                blocks.push(Block::Line { line, style });
                if is_folded && let Some(r) = region {
                    let end = r.end.min(line_count);
                    if line + 1 < end {
                        let body_start = state.doc.line_range(line + 1).start;
                        let body_end = state.doc.line_range(end - 1).end;
                        blocks.push(Block::Widget {
                            id: BlockId::for_line_embed(body_start, state.revision),
                            lines: line + 1..end,
                            widget: Rc::new(FoldedCodeWidget),
                        });
                        let header_end = state.doc.line_range(line).end;
                        inline_widgets.push(InlineWidget::text(header_end..header_end, " …"));
                        atomic.push(header_end..body_end);
                        line = end;
                        continue;
                    }
                }
                line += 1;
            }
        }

        let built = Rc::new(Decorations {
            id: next_decorations_id(),
            blocks,
            marks,
            hidden: Vec::new(),
            atomic,
            inline_widgets,
            underlines: Vec::new(),
            surface: self.surface_style(dark),
            splice: None,
        });
        self.cache.borrow_mut().doc_decos = Some(CachedCodeDecos {
            doc_key,
            dark,
            revision: state.revision,
            decos: Rc::clone(&built),
        });
        built
    }

    fn decorate_reveal(&self, input: &DecorateInput, doc_layer: &Decorations) -> Rc<RevealLayer> {
        let state = input.state;
        let doc = &state.doc;
        if doc.line_count() == 0 {
            return Rc::default();
        }
        let dark = input.dark;
        let p = Theme::new(dark);
        let sel = state.selection;
        let active_line = doc.line_index(sel.head);

        let mut tints: Vec<(Range<usize>, u32)> = Vec::new();
        let mut touched_lines = BTreeSet::new();
        touched_lines.insert(active_line);

        if sel.is_empty() {
            match brackets_in_buffer(doc, sel.head) {
                Some(Brackets::Matched(a, b)) => {
                    let c = packed(theme::alpha(p.accent, 0.22));
                    for r in [a, b] {
                        touched_lines.insert(doc.line_index(r.start));
                        tints.push((r, c));
                    }
                }
                Some(Brackets::Unmatched(r)) => {
                    touched_lines.insert(doc.line_index(r.start));
                    tints.push((r, packed(theme::alpha(p.danger, 0.24))));
                }
                None => {}
            }
        } else {
            let match_tint = packed(theme::alpha(p.accent, 0.14));
            for r in selection_matches_in_buffer(doc, sel.as_range()) {
                touched_lines.insert(doc.line_index(r.start));
                tints.push((r, match_tint));
            }
        }

        if let Some(ref vh) = self.visual_highlight {
            let clamped = doc.clamp_range(vh.clone());
            if !clamped.is_empty() {
                let first = doc.line_index(clamped.start);
                let last = doc.line_index(clamped.end.saturating_sub(1));
                for l in first..=last {
                    touched_lines.insert(l);
                }
                tints.push((clamped, packed(theme::alpha(p.accent, 0.18))));
            }
        }

        let fold_ranges = self.cache.borrow().fold_ranges.clone();
        let mut patches = Vec::new();
        for &line in &touched_lines {
            // Do not override lines currently hidden inside a folded body widget.
            let inside_fold = fold_ranges
                .iter()
                .any(|r| line > r.start && line < r.end && self.folds.is_folded(doc, r.start));
            if inside_fold {
                continue;
            }
            let line_r = doc.line_range(line);
            let byte_range = line_r.start..(line_r.end + usize::from(line + 1 < doc.line_count()));
            let region = fold_ranges.iter().find(|r| r.start == line);
            let foldable = region.map(|_| self.folds.is_folded(doc, line));
            let style =
                Rc::new(self.build_line_style(doc, line, dark, line == active_line, foldable));
            let base_marks = doc_layer.marks_in(&byte_range);
            let marks = overlay_highlights_in(byte_range.clone(), base_marks, &tints);
            let mut inline_widgets = doc_layer.inline_widgets_in(&byte_range).to_vec();
            inline_widgets.sort_by_key(|w| (w.range.start, w.range.end));
            patches.push(RevealPatch {
                lines: line..line + 1,
                byte_range,
                blocks: vec![Block::Line { line, style }],
                marks,
                hidden: Vec::new(),
                atomic: Vec::new(),
                inline_widgets,
                underlines: Vec::new(),
            });
        }
        Rc::new(RevealLayer { patches })
    }

    fn intercept(&mut self, intent: EditIntent, state: &EditorState) -> Option<Transaction> {
        intercept_intent(self.language, intent, state, self.read_only)
    }

    fn command(&mut self, command: &Command, state: &EditorState) -> Option<Transaction> {
        if command.feature() != FOLD_FEATURE_ID {
            return None;
        }
        let toggle = command.payload::<ToggleCodeFold>()?;
        self.folds.toggle(&state.doc, toggle.line, state.revision);
        self.fold_epoch = self.fold_epoch.wrapping_add(1);
        Some(Transaction::select(Selection::cursor(state.selection.head)))
    }
}
