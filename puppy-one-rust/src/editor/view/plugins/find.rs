//! In-document Find view plugin (`TA-13`, `TA-20`, `TA-60`): literal,
//! case-insensitive matches over the source text; incremental `ChangeSet`
//! mapping + touched-line rescan on edits; and `O(log M + |visible|)` viewport
//! binary-search painting.
use super::ViewPlugin;
use crate::editor::{
    text::{
        buffer::Buffer,
        change::Assoc,
        search::find_all,
        state::{Applied, EditorState},
    },
    view::layout::DocLayout,
};
use gpui::{BorderStyle, Bounds, ContentMask, Pixels, Rgba, Window, px, quad};
use std::{any::Any, ops::Range};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FindMarks {
    pub query: String,
    pub matches: Vec<Range<usize>>,
    pub current: Option<usize>,
    /// Number of bytes rescanned by the most recent incremental update (test telemetry).
    pub last_rescan_bytes: usize,
}

/// Scan `doc` for `query` without materialising `doc.flat` when `query` has no
/// line breaks (`TA-01`, `TA-13`).
pub fn find_all_in_buffer(doc: &Buffer, query: &str) -> Vec<Range<usize>> {
    if query.is_empty() || doc.is_empty() {
        return Vec::new();
    }
    if query.contains('\n') {
        let text = doc.slice_cow(0..doc.len());
        return find_all(&text, query);
    }
    let mut out = Vec::new();
    let mut carry = String::new();
    let mut carry_offset = 0usize;
    let mut pos = 0usize;
    for chunk in doc.chunks_in(0..doc.len()) {
        if !carry.is_empty() {
            if let Some(nl) = chunk.find('\n') {
                carry.push_str(&chunk[..nl]);
                for m in find_all(&carry, query) {
                    out.push(carry_offset + m.start..carry_offset + m.end);
                }
                carry.clear();
                let rest = &chunk[nl + 1..];
                let rest_base = pos + nl + 1;
                if let Some(last_nl) = rest.rfind('\n') {
                    for m in find_all(&rest[..last_nl], query) {
                        out.push(rest_base + m.start..rest_base + m.end);
                    }
                    carry_offset = rest_base + last_nl + 1;
                    carry.push_str(&rest[last_nl + 1..]);
                } else {
                    carry_offset = rest_base;
                    carry.push_str(rest);
                }
            } else {
                carry.push_str(chunk);
            }
        } else if let Some(last_nl) = chunk.rfind('\n') {
            for m in find_all(&chunk[..last_nl], query) {
                out.push(pos + m.start..pos + m.end);
            }
            carry_offset = pos + last_nl + 1;
            carry.push_str(&chunk[last_nl + 1..]);
        } else {
            carry_offset = pos;
            carry.push_str(chunk);
        }
        pos += chunk.len();
    }
    if !carry.is_empty() {
        for m in find_all(&carry, query) {
            out.push(carry_offset + m.start..carry_offset + m.end);
        }
    }
    out
}

impl FindMarks {
    pub fn set_query(&mut self, doc: &Buffer, query: &str, selection_from: usize) {
        self.query = query.to_owned();
        self.matches = find_all_in_buffer(doc, query);
        self.last_rescan_bytes = doc.len();
        self.current = if self.matches.is_empty() {
            None
        } else {
            Some(
                self.matches
                    .partition_point(|m| m.start < selection_from)
                    .min(self.matches.len())
                    % self.matches.len(),
            )
        };
    }

    pub fn result(&self) -> (usize, usize) {
        (self.current.map_or(0, |c| c + 1), self.matches.len())
    }

    /// Incrementally map existing matches across `applied.changes` and rescan
    /// only the lines touched by the edit (± `query` newline span, `TA-13`).
    pub fn apply_changes(&mut self, applied: &Applied, doc: &Buffer) {
        if self.query.is_empty() || applied.changes.is_empty() {
            return;
        }
        let changes_slice = applied.changes.changes();
        let min_old = changes_slice.first().map_or(0, |c| c.range.start);
        let max_old = changes_slice.last().map_or(0, |c| c.range.end);

        let min_new = doc.clamp(applied.changes.map(min_old, Assoc::Before));
        let max_new = doc.clamp(applied.changes.map(max_old, Assoc::After));

        let query_lines = self.query.bytes().filter(|&b| b == b'\n').count();
        let line_count = doc.line_count();
        let mut first_line = doc.line_index(min_new).saturating_sub(query_lines);
        let mut last_line =
            (doc.line_index(max_new) + query_lines).min(line_count.saturating_sub(1));

        let mut scan_new = doc.line_range(first_line).start..doc.line_range(last_line).end;
        let mut old_start = applied
            .before_doc
            .clamp(applied.inverse.map(scan_new.start, Assoc::Before));
        let mut old_end = applied
            .before_doc
            .clamp(applied.inverse.map(scan_new.end, Assoc::After));

        // Expand if any existing match straddles `old_start` or `old_end`.
        let cut_start_probe = self.matches.partition_point(|m| m.end <= old_start);
        if let Some(m) = self.matches.get(cut_start_probe)
            && m.start < old_start
        {
            let extra_line = applied.before_doc.line_index(m.start);
            let mapped = doc.line_index(applied.changes.map(
                applied.before_doc.line_range(extra_line).start,
                Assoc::Before,
            ));
            first_line = first_line.min(mapped);
            scan_new.start = doc.line_range(first_line).start;
            old_start = applied
                .before_doc
                .clamp(applied.inverse.map(scan_new.start, Assoc::Before));
        }
        let cut_end_probe = self.matches.partition_point(|m| m.start < old_end);
        if cut_end_probe > 0
            && let Some(m) = self.matches.get(cut_end_probe - 1)
            && m.end > old_end
        {
            let extra_line = applied.before_doc.line_index(m.end);
            let mapped = doc.line_index(
                applied
                    .changes
                    .map(applied.before_doc.line_range(extra_line).end, Assoc::After),
            );
            last_line = last_line.max(mapped.min(line_count.saturating_sub(1)));
            scan_new.end = doc.line_range(last_line).end;
            old_end = applied
                .before_doc
                .clamp(applied.inverse.map(scan_new.end, Assoc::After));
        }

        let cut_start = self.matches.partition_point(|m| m.end <= old_start);
        let cut_end = self
            .matches
            .partition_point(|m| m.start < old_end)
            .max(cut_start);

        let slice = doc.slice_cow(scan_new.clone());
        self.last_rescan_bytes = slice.len();
        let rescanned: Vec<Range<usize>> = find_all(&slice, &self.query)
            .into_iter()
            .map(|m| scan_new.start + m.start..scan_new.start + m.end)
            .collect();

        let delta = scan_new.end as isize - old_end as isize;
        let old_removed = cut_end - cut_start;
        let new_added = rescanned.len();

        let prev_current = self.current;
        self.matches.splice(cut_start..cut_end, rescanned);
        if delta != 0 {
            for m in &mut self.matches[cut_start + new_added..] {
                m.start = (m.start as isize + delta) as usize;
                m.end = (m.end as isize + delta) as usize;
            }
        }

        self.current = match prev_current {
            None => (!self.matches.is_empty()).then_some(0),
            Some(_) if self.matches.is_empty() => None,
            Some(c) if c < cut_start => Some(c),
            Some(c) if c >= cut_end => {
                let shifted = c + new_added - old_removed;
                Some(shifted.min(self.matches.len() - 1))
            }
            Some(c) => Some(c.min(self.matches.len() - 1)),
        };
    }
}

#[derive(Default)]
pub struct FindPlugin {
    pub marks: FindMarks,
}

impl ViewPlugin for FindPlugin {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    fn on_applied(&mut self, applied: &Applied, state: &EditorState) {
        self.marks.apply_changes(applied, &state.doc);
    }

    fn paint_underlay(
        &self,
        dark: bool,
        layout: &DocLayout,
        bounds: Bounds<Pixels>,
        window: &mut Window,
    ) {
        if self.marks.matches.is_empty() || layout.leaves.is_empty() {
            return;
        }
        let vis_start = layout.leaves.first().map_or(0, |l| l.source().start);
        let vis_end = layout.leaves.last().map_or(0, |l| l.source().end);
        let first = self.marks.matches.partition_point(|m| m.end <= vis_start);
        let last = self
            .marks
            .matches
            .partition_point(|m| m.start < vis_end)
            .max(first);
        if first >= last {
            return;
        }

        let t = crate::theme::Theme::new(dark);
        let visible = |b: &Bounds<Pixels>| b.bottom() >= bounds.top() && b.top() <= bounds.bottom();
        window.with_content_mask(Some(ContentMask { bounds }), |window| {
            for i in first..last {
                let range = &self.marks.matches[i];
                let current = self.marks.current == Some(i);
                for b in layout
                    .range_boxes(range.clone())
                    .iter()
                    .filter(|b| visible(b))
                {
                    let tint = crate::theme::alpha(t.warning, if current { 0.58 } else { 0.34 });
                    if current {
                        let ring = crate::theme::mix(t.warning, t.text, 0.82);
                        window.paint_quad(quad(
                            b.dilate(px(1.)),
                            px(3.),
                            Rgba::default(),
                            px(1.),
                            ring,
                            BorderStyle::Solid,
                        ));
                    }
                    window.paint_quad(quad(
                        *b,
                        px(2.),
                        tint,
                        px(0.),
                        Rgba::default(),
                        BorderStyle::Solid,
                    ));
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::text::{
        change::ChangeSet,
        state::{EditorState, Transaction, UserEvent},
    };

    #[test]
    fn incremental_find_rescans_only_touched_lines_and_matches_full_scan() {
        let initial = (0..1_000)
            .map(|i| format!("Section {i}: alpha needle beta"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut state = EditorState::new(&initial);
        let mut marks = FindMarks::default();
        marks.set_query(&state.doc, "needle", 0);
        assert_eq!(marks.matches.len(), 1_000);
        assert!(!state.doc.has_materialized_flat());

        // Edit line 500: add a second "NEEDLE" on that line.
        let r500 = state.doc.line_range(500);
        let applied = state
            .apply(Transaction::edit(
                ChangeSet::replace(r500.end..r500.end, " extra NEEDLE!"),
                None,
                UserEvent::Input,
            ))
            .unwrap();
        marks.apply_changes(&applied, &state.doc);

        assert!(
            marks.last_rescan_bytes < 128,
            "rescanned {} bytes instead of only line 500",
            marks.last_rescan_bytes
        );
        assert!(!state.doc.has_materialized_flat());
        assert_eq!(marks.matches.len(), 1_001);
        assert_eq!(marks.matches, find_all(state.doc.as_str(), "needle"));
    }
}
