//! The CSV find adapter (editor/find/useCsvFindAdapter.ts) for the pane's
//! find bar (`CS-12`): case-insensitive substring matches over every cell in
//! reading order, indexed by `(row_id, col_id)` so `draw_find` is $O(1)$ per
//! visible cell; single-cell edits incrementally update only the edited cell;
//! initial scans on large tables (`> 50,000` cells) run on GPUI's background
//! executor with cancellation generation.
use super::*;
use crate::{editor::csv::rows::RowVec, theme::Theme};
use std::collections::HashMap;

/// Tables exceeding this cell count run initial find scans on the background executor (`CS-12`).
pub const BACKGROUND_FIND_CELL_THRESHOLD: usize = 50_000;

/// `EditorFindResult`: the 1-based current match and the total.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FindResult {
    pub current: usize,
    pub total: usize,
}

#[derive(Default)]
pub(super) struct Find {
    pub(super) query: String,
    pub(super) query_lower: String,
    pub(super) matches: Vec<(usize, usize)>,
    /// `(row_id, col_id) -> index in matches` for $O(1)$ visible cell lookup (`CS-12`).
    pub(super) index: HashMap<(u64, u64), usize>,
    pub(super) current: Option<usize>,
    pub(super) generation: u64,
    pub(super) task: Option<Task<()>>,
}

impl Find {
    pub(super) fn result(&self) -> FindResult {
        FindResult {
            current: self.current.map_or(0, |c| c + 1),
            total: self.matches.len(),
        }
    }
}

type ScanOutput = (Vec<(usize, usize)>, HashMap<(u64, u64), usize>);

fn scan_rows(
    rows: &RowVec,
    columns: &[u64],
    query_lower: &str,
    draft: Option<(usize, usize, &str)>,
) -> ScanOutput {
    let mut matches = Vec::new();
    let mut index = HashMap::new();
    if query_lower.is_empty() {
        return (matches, index);
    }
    let col_len = columns.len();
    for (r, row) in rows.iter().enumerate() {
        for (c, &col_id) in columns.iter().enumerate().take(col_len) {
            let val = match draft {
                Some((dr, dc, dval)) if dr == r && dc == c => dval,
                _ => row.cell_or_empty(c),
            };
            if val.to_lowercase().contains(query_lower) {
                let idx = matches.len();
                matches.push((r, c));
                index.insert((row.id, col_id), idx);
            }
        }
    }
    (matches, index)
}

impl CsvEditor {
    fn active_draft_tuple(&self) -> Option<(usize, usize, String)> {
        let cell = self.cell.as_ref()?;
        Some((cell.row, cell.column, cell.committed_draft.borrow().clone()))
    }

    fn install_find_matches(
        &mut self,
        matches: Vec<(usize, usize)>,
        index: HashMap<(u64, u64), usize>,
        select_first: bool,
    ) -> FindResult {
        let current = match self.find.current {
            _ if matches.is_empty() => None,
            Some(c) if !select_first && c < matches.len() => Some(c),
            _ => Some(0),
        };
        self.find.matches = matches;
        self.find.index = index;
        self.find.current = current;
        if let Some((row, column)) = current.map(|c| self.find.matches[c]) {
            self.reveal(row, column);
        }
        self.find.result()
    }

    fn schedule_or_run_find(&mut self, select_first: bool, cx: &mut Context<Self>) -> FindResult {
        self.find.generation += 1;
        let generation = self.find.generation;
        self.find.task = None;

        if self.find.query_lower.is_empty() {
            self.find.matches.clear();
            self.find.index.clear();
            self.find.current = None;
            return self.find.result();
        }

        let total_cells = self.rows().saturating_mul(self.columns());
        let draft = self.active_draft_tuple();
        if total_cells <= BACKGROUND_FIND_CELL_THRESHOLD {
            let (matches, index) = scan_rows(
                self.model.rows(),
                &self.model.content().columns,
                &self.find.query_lower,
                draft.as_ref().map(|(r, c, s)| (*r, *c, s.as_str())),
            );
            return self.install_find_matches(matches, index, select_first);
        }

        // Large table (`> 50,000` cells): scan on GPUI's background executor with cancellation!
        let rows = self.model.rows().clone();
        let columns = self.model.content().columns.clone();
        let query_lower = self.find.query_lower.clone();
        let bg = cx.background_executor().spawn(async move {
            scan_rows(
                &rows,
                &columns,
                &query_lower,
                draft.as_ref().map(|(r, c, s)| (*r, *c, s.as_str())),
            )
        });
        self.find.task = Some(cx.spawn(async move |this, cx| {
            let (matches, index) = bg.await;
            let _ = this.update(cx, |this, cx| {
                if this.find.generation != generation {
                    return;
                }
                this.find.task = None;
                let r = this.install_find_matches(matches, index, select_first);
                cx.emit(CsvEvent::FindResult {
                    current: r.current,
                    total: r.total,
                });
                cx.notify();
            });
        }));
        self.find.result()
    }

    /// `setQuery`: matches restart at the first.
    pub fn find_query(&mut self, query: &str, cx: &mut Context<Self>) -> FindResult {
        self.find.query = query.to_owned();
        self.find.query_lower = query.to_lowercase();
        let result = self.schedule_or_run_find(true, cx);
        cx.notify();
        result
    }

    /// `move`: the next / previous match, wrapping.
    pub fn find_move(&mut self, forward: bool, cx: &mut Context<Self>) -> FindResult {
        let n = self.find.matches.len();
        if n == 0 {
            return self.find.result();
        }
        let current = self.find.current.unwrap_or(if forward { n - 1 } else { 0 });
        let next = if forward {
            (current + 1) % n
        } else {
            (current + n - 1) % n
        };
        self.find.current = Some(next);
        let (row, column) = self.find.matches[next];
        self.reveal(row, column);
        cx.notify();
        self.find.result()
    }

    pub fn find_clear(&mut self, cx: &mut Context<Self>) {
        self.find.generation += 1;
        self.find = Find {
            generation: self.find.generation,
            ..Default::default()
        };
        cx.notify();
    }

    /// `focusEditor`: edit the current match with its value selected (else the
    /// first cell).
    pub fn find_focus_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let target = self
            .find
            .current
            .and_then(|c| self.find.matches.get(c).copied())
            .or((self.rows() > 0 && self.columns() > 0).then_some((0, 0)));
        if let Some((row, column)) = target {
            self.activate(row, column, None, window, cx);
        }
    }

    /// Incremental single-cell find update (`CS-12`): touches only `(row, column)`
    /// without scanning untouched rows or cells!
    pub(super) fn find_cell_changed(
        &mut self,
        row: usize,
        column: usize,
        value: &str,
        cx: &mut Context<Self>,
    ) {
        if self.find.query_lower.is_empty() {
            return;
        }
        if self.find.task.is_some() {
            self.schedule_or_run_find(false, cx);
            return;
        }
        let Some(row_obj) = self.model.rows().get(row) else {
            return;
        };
        let Some(&col_id) = self.model.content().columns.get(column) else {
            return;
        };
        let key = (row_obj.id, col_id);
        let was_match = self.find.index.contains_key(&key);
        let now_matches = value.to_lowercase().contains(&self.find.query_lower);
        if was_match == now_matches {
            return;
        }
        if now_matches {
            let pos = self
                .find
                .matches
                .binary_search(&(row, column))
                .unwrap_or_else(|p| p);
            self.find.matches.insert(pos, (row, column));
            // Shift index entries at or after `pos`.
            for &(mr, mc) in &self.find.matches[pos + 1..] {
                if let (Some(ro), Some(&cid)) = (
                    self.model.rows().get(mr),
                    self.model.content().columns.get(mc),
                ) && let Some(slot) = self.find.index.get_mut(&(ro.id, cid))
                {
                    *slot += 1;
                }
            }
            self.find.index.insert(key, pos);
            self.find.current = match self.find.current {
                None => Some(0),
                Some(c) if c >= pos => Some(c + 1),
                Some(c) => Some(c),
            };
        } else if let Some(pos) = self.find.index.remove(&key) {
            self.find.matches.remove(pos);
            for &(mr, mc) in &self.find.matches[pos..] {
                if let (Some(ro), Some(&cid)) = (
                    self.model.rows().get(mr),
                    self.model.content().columns.get(mc),
                ) && let Some(slot) = self.find.index.get_mut(&(ro.id, cid))
                {
                    *slot -= 1;
                }
            }
            self.find.current = match self.find.current {
                _ if self.find.matches.is_empty() => None,
                Some(c) if c > pos => Some(c - 1),
                Some(c) if c >= self.find.matches.len() => Some(0),
                other => other,
            };
        }
        let r = self.find.result();
        cx.emit(CsvEvent::FindResult {
            current: r.current,
            total: r.total,
        });
    }

    /// After a structural / multi-row document change, refresh matches.
    pub(super) fn find_changed(&mut self, cx: &mut Context<Self>) {
        if !self.find.query_lower.is_empty() {
            let r = self.schedule_or_run_find(false, cx);
            if self.find.task.is_none() {
                cx.emit(CsvEvent::FindResult {
                    current: r.current,
                    total: r.total,
                });
            }
        }
    }

    /// `[data-find-match]` / `[data-find-current]`: $O(1)$ lookup by `(row_id, col_id)` (`CS-12`).
    pub(super) fn draw_find(&self, row: usize, column: usize, out: &mut Vec<Draw>) {
        if self.find.index.is_empty() {
            return;
        }
        let Some(row_obj) = self.model.rows().get(row) else {
            return;
        };
        let Some(&col_id) = self.model.content().columns.get(column) else {
            return;
        };
        let Some(&match_idx) = self.find.index.get(&(row_obj.id, col_id)) else {
            return;
        };
        let palette = Theme::new(self.theme.dark);
        let warning = palette.warning;
        let text = palette.text;
        let current = self.find.current == Some(match_idx);
        let t = &self.theme;
        let bounds = Draw::rect(
            self.column_x(column),
            self.row_top(row),
            self.column_width(column) - self.cell_end_border(column),
            t.table.row_min_height - self.cell_bottom_border(row),
        );
        let (ring, width) = if current {
            (crate::theme::mix(warning, text, 0.8), 2.)
        } else {
            (
                Rgba {
                    a: warning.a * 0.56,
                    ..warning
                },
                1.,
            )
        };
        out.push(Draw::Cell {
            bounds,
            background: Rgba::default(),
            border: Sides {
                top: width,
                right: width,
                bottom: width,
                left: width,
            },
            border_color: ring,
            radius: Corners::default(),
        });
        out.push(Draw::Cell {
            bounds,
            background: Rgba {
                a: warning.a * 0.24,
                ..warning
            },
            border: Sides::default(),
            border_color: Rgba::default(),
            radius: Corners::default(),
        });
    }
}
