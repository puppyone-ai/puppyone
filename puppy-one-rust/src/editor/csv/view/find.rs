//! The CSV find adapter (editor/find/useCsvFindAdapter.ts) for the pane's
//! find bar: case-insensitive substring matches over every cell in reading
//! order, the current one revealed; matches are tinted and outlined
//! (editor-find.css). Edits refresh the matches and keep the current one.
use super::*;
use crate::theme::Theme;

/// `EditorFindResult`: the 1-based current match and the total.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FindResult {
    pub current: usize,
    pub total: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct Find {
    pub(super) query: String,
    pub(super) matches: Vec<(usize, usize)>,
    pub(super) current: Option<usize>,
}

impl Find {
    fn result(&self) -> FindResult {
        FindResult {
            current: self.current.map_or(0, |c| c + 1),
            total: self.matches.len(),
        }
    }
}

impl CsvEditor {
    fn refresh_find(&mut self, select_first: bool) -> FindResult {
        let query = self.find.query.to_lowercase();
        if query.is_empty() {
            self.find.matches.clear();
            self.find.current = None;
            return self.find.result();
        }
        let matches: Vec<(usize, usize)> = self
            .model
            .rows()
            .iter()
            .enumerate()
            .flat_map(|(r, row)| {
                row.cells
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| v.to_lowercase().contains(&query))
                    .map(move |(c, _)| (r, c))
            })
            .collect();
        let current = match self.find.current {
            _ if matches.is_empty() => None,
            Some(c) if !select_first && c < matches.len() => Some(c),
            _ => Some(0),
        };
        self.find.matches = matches;
        self.find.current = current;
        if let Some((row, column)) = current.map(|c| self.find.matches[c]) {
            self.reveal(row, column);
        }
        self.find.result()
    }

    /// `setQuery`: matches restart at the first.
    pub fn find_query(&mut self, query: &str, cx: &mut Context<Self>) -> FindResult {
        self.find.query = query.to_owned();
        let result = self.refresh_find(true);
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
        self.find = Find::default();
        cx.notify();
    }

    /// `focusEditor`: edit the current match with its value selected (else the
    /// first cell).
    pub fn find_focus_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let target = self
            .find
            .current
            .map(|c| self.find.matches[c])
            .or((self.rows() > 0 && self.columns() > 0).then_some((0, 0)));
        if let Some((row, column)) = target {
            self.activate(row, column, None, window, cx);
        }
    }

    /// After a document change, keep the matches current.
    pub(super) fn find_changed(&mut self) {
        if !self.find.query.is_empty() {
            self.refresh_find(false);
        }
    }

    /// `[data-find-match]` / `[data-find-current]`: the input's tint and the
    /// cell's inset ring, inside its own borders.
    pub(super) fn draw_find(&self, row: usize, column: usize, out: &mut Vec<Draw>) {
        if !self.find.matches.contains(&(row, column)) {
            return;
        }
        let warning = Theme::new(self.theme.dark).warning;
        let text = Theme::new(self.theme.dark).text;
        let current = self.find.current.map(|c| self.find.matches[c]) == Some((row, column));
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
        // The cell's inset ring paints under the input's tint.
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
