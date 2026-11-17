//! In-memory laboratory model. No filesystem, persistence queue or application domain imports.
use std::ops::Range;

pub const MAX_ROWS: usize = 12;
pub const MAX_COLS: usize = 6;
pub const MAX_TEXT: usize = 4096;
const HISTORY_LIMIT: usize = 64;

pub use crate::input::Mark as Marks;
#[derive(Clone, Copy, Debug)]
pub enum Format {
    Bold,
    Italic,
}
impl Marks {
    pub fn contains(self, format: Format) -> bool {
        match format {
            Format::Bold => self.bold,
            Format::Italic => self.italic,
        }
    }
    pub fn set(&mut self, format: Format, value: bool) {
        match format {
            Format::Bold => self.bold = value,
            Format::Italic => self.italic = value,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RichText {
    pub text: String,
    /// One entry per Unicode scalar, independent of GPUI's UTF-8/UTF-16 platform offsets.
    /// This is deliberately not a production rope or grapheme navigation engine.
    pub marks: Vec<Marks>,
}
impl RichText {
    pub fn new(text: &str) -> Self {
        Self {
            text: text.into(),
            marks: vec![Marks::default(); text.chars().count()],
        }
    }
    pub fn toggle(&mut self, range: Range<usize>, format: Format) {
        let start = range.start.min(self.marks.len());
        let end = range.end.min(self.marks.len());
        if start >= end {
            return;
        }
        let enabled = !self.marks[start..end].iter().all(|m| m.contains(format));
        for mark in &mut self.marks[start..end] {
            mark.set(format, enabled);
        }
    }
    /// Limited readable projection, not a Markdown importer or lossless codec.
    pub fn markdown(&self) -> String {
        let chars: Vec<_> = self.text.chars().collect();
        let mut result = String::new();
        let mut i = 0;
        while i < chars.len() {
            let mark = self.marks[i];
            let mut end = i + 1;
            while end < chars.len() && self.marks[end] == mark {
                end += 1;
            }
            if mark.bold {
                result.push_str("**");
            }
            if mark.italic {
                result.push('_');
            }
            for &c in &chars[i..end] {
                if "\\`*_{}[]()#+-.!|<>".contains(c) {
                    result.push('\\');
                }
                if c == '\n' {
                    result.push_str("<br>");
                } else {
                    result.push(c);
                }
            }
            if mark.italic {
                result.push('_');
            }
            if mark.bold {
                result.push_str("**");
            }
            i = end;
        }
        result
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextNode {
    pub id: u64,
    pub content: RichText,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Document {
    pub title: TextNode,
    pub before: TextNode,
    pub cells: Vec<Vec<TextNode>>,
    pub after: TextNode,
    next_id: u64,
}
impl Document {
    pub fn demo() -> Self {
        let node = |id, text| TextNode {
            id,
            content: RichText::new(text),
        };
        let mut result = Self {
            title: node(1, "原生富文本 · Native editor lab"),
            before: node(
                2,
                "这里没有浏览器。选中文字后按 ⌘B / ⌘I，或点击工具栏。中文、emoji 🐶 和表格都直接在原生控件里编辑。",
            ),
            cells: vec![],
            after: node(
                3,
                "验证：表格里按 Tab / Shift+Tab 切换单元格；粘贴带制表符的 TSV；撤销应同时恢复内容、格式和表格结构。",
            ),
            next_id: 4,
        };
        for values in [
            ["项目", "说明", "状态"],
            ["富文本", "Bold / italic", "试试选择格式化"],
            ["表格", "中文与 emoji 🐶", "原生编辑"],
            ["生命周期", "只在内存里", "不写真实文件"],
        ] {
            let row = values.iter().map(|s| result.node(s)).collect();
            result.cells.push(row);
        }
        for cell in &mut result.cells[0] {
            cell.content
                .toggle(0..cell.content.marks.len(), Format::Bold);
        }
        for (node, word, format) in [
            (&mut result.before, "emoji", Format::Bold),
            (&mut result.after, "Tab / Shift+Tab", Format::Italic),
        ] {
            let byte = node.content.text.find(word).unwrap();
            let start = node.content.text[..byte].chars().count();
            node.content
                .toggle(start..start + word.chars().count(), format);
        }
        result
    }
    fn node(&mut self, text: &str) -> TextNode {
        let id = self.next_id;
        self.next_id += 1;
        TextNode {
            id,
            content: RichText::new(text),
        }
    }
    pub fn get(&self, id: u64) -> Option<&TextNode> {
        [&self.title, &self.before, &self.after]
            .into_iter()
            .chain(self.cells.iter().flatten())
            .find(|n| n.id == id)
    }
    pub fn get_mut(&mut self, id: u64) -> Option<&mut TextNode> {
        [&mut self.title, &mut self.before, &mut self.after]
            .into_iter()
            .chain(self.cells.iter_mut().flatten())
            .find(|n| n.id == id)
    }
    pub fn cell_position(&self, id: u64) -> Option<(usize, usize)> {
        self.cells
            .iter()
            .enumerate()
            .find_map(|(r, row)| row.iter().position(|n| n.id == id).map(|c| (r, c)))
    }
    pub fn next_cell(&self, id: u64, backwards: bool, next_row: bool) -> Option<u64> {
        let (r, c) = self.cell_position(id)?;
        let columns = self.cells[0].len();
        let total = self.cells.len() * columns;
        let step = if next_row { columns } else { 1 };
        let current = r * columns + c;
        let next = if backwards {
            (current + total - step) % total
        } else {
            (current + step) % total
        };
        Some(self.cells[next / columns][next % columns].id)
    }
    pub fn add_row(&mut self) -> Option<u64> {
        if self.cells.len() >= MAX_ROWS {
            return None;
        }
        let row: Vec<_> = (0..self.cells[0].len()).map(|_| self.node("")).collect();
        let first = row[0].id;
        self.cells.push(row);
        Some(first)
    }
    pub fn add_column(&mut self) -> Option<u64> {
        if self.cells[0].len() >= MAX_COLS {
            return None;
        }
        for r in 0..self.cells.len() {
            let node = self.node("");
            self.cells[r].push(node);
        }
        self.cells[0].last().map(|n| n.id)
    }
    pub fn delete_row(&mut self, id: u64) -> Option<u64> {
        let (r, c) = self.cell_position(id)?;
        if r == 0 || self.cells.len() <= 2 {
            return None;
        }
        self.cells.remove(r);
        Some(self.cells[r.min(self.cells.len() - 1)][c].id)
    }
    pub fn delete_column(&mut self, id: u64) -> Option<u64> {
        let (r, c) = self.cell_position(id)?;
        if self.cells[0].len() <= 1 {
            return None;
        }
        for row in &mut self.cells {
            row.remove(c);
        }
        Some(self.cells[r][c.min(self.cells[0].len() - 1)].id)
    }
    /// Validate the entire paste before mutating; overflow never partially applies.
    pub fn paste_tsv(&mut self, id: u64, source: &str) -> Result<(), &'static str> {
        let (start_r, start_c) = self.cell_position(id).ok_or("Not a table cell")?;
        if source.len() > MAX_ROWS * MAX_COLS * MAX_TEXT * 4 {
            return Err("Paste exceeds probe limits");
        }
        let normalized = source.replace("\r\n", "\n");
        let rows: Vec<Vec<&str>> = normalized
            .trim_end_matches('\n')
            .split('\n')
            .map(|r| r.split('\t').collect())
            .collect();
        let width = rows.iter().map(Vec::len).max().unwrap_or(0);
        if rows
            .iter()
            .any(|r| r.len() != width || r.iter().any(|s| s.chars().count() > MAX_TEXT))
        {
            return Err("TSV must be rectangular; each cell is limited to 4096 characters");
        }
        if start_r + rows.len() > MAX_ROWS || start_c + width > MAX_COLS {
            return Err("Table limit: 12 rows × 6 columns");
        }
        while self.cells.len() < start_r + rows.len() {
            self.add_row();
        }
        while self.cells[0].len() < start_c + width {
            self.add_column();
        }
        for (r, row) in rows.iter().enumerate() {
            for (c, value) in row.iter().enumerate() {
                self.cells[start_r + r][start_c + c].content = RichText::new(value);
            }
        }
        Ok(())
    }
    pub fn markdown(&self) -> String {
        let mut result = format!(
            "# {}\n\n{}\n\n",
            self.title.content.markdown(),
            self.before.content.markdown()
        );
        for (r, row) in self.cells.iter().enumerate() {
            result.push_str("| ");
            result.push_str(
                &row.iter()
                    .map(|n| n.content.markdown())
                    .collect::<Vec<_>>()
                    .join(" | "),
            );
            result.push_str(" |\n");
            if r == 0 {
                result.push('|');
                for _ in row {
                    result.push_str(" --- |");
                }
                result.push('\n');
            }
        }
        result.push_str(&format!("\n{}\n", self.after.content.markdown()));
        result
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Selection {
    pub node: u64,
    pub anchor: usize,
    pub cursor: usize,
}
impl Selection {
    pub fn caret(node: u64) -> Self {
        Self {
            node,
            anchor: 0,
            cursor: 0,
        }
    }
    pub fn range(self) -> Range<usize> {
        self.anchor.min(self.cursor)..self.anchor.max(self.cursor)
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub document: Document,
    pub selection: Selection,
}
#[derive(Default)]
pub struct History {
    undo: Vec<Snapshot>,
    redo: Vec<Snapshot>,
}
impl History {
    pub fn record(&mut self, before: Snapshot, after: &Snapshot) {
        if before.document == after.document {
            return;
        }
        self.undo.push(before);
        self.redo.clear();
        if self.undo.len() > HISTORY_LIMIT {
            self.undo.remove(0);
        }
    }
    pub fn undo(&mut self, current: &mut Snapshot) -> bool {
        if let Some(previous) = self.undo.pop() {
            self.redo.push(std::mem::replace(current, previous));
            true
        } else {
            false
        }
    }
    pub fn redo(&mut self, current: &mut Snapshot) -> bool {
        if let Some(next) = self.redo.pop() {
            self.undo.push(std::mem::replace(current, next));
            true
        } else {
            false
        }
    }
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_marks_use_characters_not_utf8_bytes() {
        let mut t = RichText::new("中🐶e\u{301}");
        t.toggle(1..2, Format::Bold);
        assert_eq!(t.marks.len(), 4);
        assert!(t.marks[1].bold);
        assert!(!t.marks[2].bold);
        assert_eq!(t.markdown(), "中**🐶**e\u{301}");
    }
    #[test]
    fn mixed_selection_becomes_uniform_then_toggles_off() {
        let mut t = RichText::new("abc");
        t.toggle(0..1, Format::Italic);
        t.toggle(0..3, Format::Italic);
        assert!(t.marks.iter().all(|m| m.italic));
        t.toggle(0..3, Format::Italic);
        assert!(t.marks.iter().all(|m| !m.italic));
    }
    #[test]
    fn structural_edits_keep_surviving_cell_identities() {
        let mut d = Document::demo();
        let id = d.cells[2][1].id;
        d.add_row();
        d.add_column();
        assert_eq!(d.cell_position(id), Some((2, 1)));
        let first = d.cells[1][0].id;
        d.delete_row(first);
        assert_eq!(d.cell_position(id), Some((1, 1)));
        let first = d.cells[1][0].id;
        d.delete_column(first);
        assert_eq!(d.cell_position(id), Some((1, 0)));
        assert!(d.get(id).is_some());
    }
    #[test]
    fn header_and_last_column_are_protected() {
        let mut d = Document::demo();
        assert!(d.delete_row(d.cells[0][0].id).is_none());
        while d.cells[0].len() > 1 {
            d.delete_column(d.cells[0][0].id);
        }
        assert!(d.delete_column(d.cells[0][0].id).is_none());
    }
    #[test]
    fn navigation_wraps_without_mutating_table() {
        let d = Document::demo();
        let first = d.cells[0][0].id;
        let last = d.cells.last().unwrap().last().unwrap().id;
        assert_eq!(d.next_cell(first, true, false), Some(last));
        assert_eq!(d.next_cell(last, false, false), Some(first));
        assert_eq!(d.next_cell(first, false, true), Some(d.cells[1][0].id));
    }
    #[test]
    fn rectangular_paste_expands_atomically_and_keeps_ids() {
        let mut d = Document::demo();
        let id = d.cells[3][2].id;
        d.paste_tsv(id, "中\t🐶\r\nA\tB\r\n").unwrap();
        assert_eq!(d.cells[3][2].id, id);
        assert_eq!(d.cells[4][3].content.text, "B");
        let old = d.clone();
        assert!(d.paste_tsv(id, "a\tb\nc").is_err());
        assert_eq!(d, old);
        assert!(d.paste_tsv(id, &"x\t".repeat(20)).is_err());
        assert_eq!(d, old);
    }
    #[test]
    fn undo_restores_structure_styles_and_selection() {
        let mut s = Snapshot {
            document: Document::demo(),
            selection: Selection::caret(2),
        };
        let before = s.clone();
        s.document.before.content.toggle(0..2, Format::Bold);
        s.selection.node = s.document.add_column().unwrap();
        let after = s.clone();
        let mut h = History::default();
        h.record(before.clone(), &s);
        assert!(h.undo(&mut s));
        assert_eq!(s, before);
        assert!(h.redo(&mut s));
        assert_eq!(s, after);
        h.undo(&mut s);
        let old = s.clone();
        s.document.add_row();
        h.record(old, &s);
        assert!(!h.can_redo());
    }
}
