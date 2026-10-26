//! The Markdown table model (features/table/tableModel.ts). The parser
//! recognises the table start; the editable block is narrowed to the
//! consecutive pipe-delimited rows, and every cell keeps its exact source
//! range so cells edit the one canonical document.
use crate::editor::text::buffer::Buffer;
use std::ops::Range;

/// Model limits (core/plans/markdownBlockExecution.ts): larger tables stay
/// visible source.
pub const COLUMN_LIMIT: usize = 64;
pub const ROW_LIMIT: usize = 2000;
pub const CELL_LIMIT: usize = 20_000;
pub const ROW_BYTE_LIMIT: usize = 64 * 1024;

pub use crate::editor::table::operation::Alignment;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Cell {
    /// Trimmed content in the source (empty at the row end for padding cells).
    pub range: Range<usize>,
    /// The content with `\|` unescaped.
    pub text: String,
    pub editable: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Row {
    pub cells: Vec<Cell>,
    pub header: bool,
    /// Source line index.
    pub line: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Table {
    pub range: Range<usize>,
    /// Source lines covered (header, delimiter, rows).
    pub lines: Range<usize>,
    pub alignments: Vec<Alignment>,
    pub rows: Vec<Row>,
    pub refinement_valid: bool,
}

fn is_escaped(text: &[u8], index: usize) -> bool {
    text[..index]
        .iter()
        .rev()
        .take_while(|&&b| b == b'\\')
        .count()
        % 2
        == 1
}

fn pipes(text: &str) -> Vec<usize> {
    let b = text.as_bytes();
    (0..b.len())
        .filter(|&i| b[i] == b'|' && !is_escaped(b, i))
        .collect()
}

/// `splitTableCellSegments`: raw cell byte ranges of one row.
fn segments(text: &str) -> Vec<Range<usize>> {
    let pipes = pipes(text);
    if pipes.is_empty() {
        return Vec::new();
    }
    let first = text.find(|c: char| !c.is_whitespace());
    let last = text.rfind(|c: char| !c.is_whitespace());
    let leading = first.is_some_and(|i| text.as_bytes()[i] == b'|');
    let trailing = last.is_some_and(|i| text.as_bytes()[i] == b'|');
    let mut bounds: Vec<isize> = Vec::new();
    if !leading {
        bounds.push(-1);
    }
    bounds.extend(pipes.iter().map(|&p| p as isize));
    if !trailing {
        bounds.push(text.len() as isize);
    }
    bounds
        .windows(2)
        .map(|w| ((w[0] + 1) as usize)..(w[1] as usize).min(text.len()))
        .collect()
}

fn unescape(text: &str) -> String {
    text.replace("\\|", "|")
}

fn split_cells(text: &str) -> Vec<String> {
    segments(text)
        .into_iter()
        .map(|r| unescape(text[r].trim()))
        .collect()
}

fn is_delimiter_cell(cell: &str) -> bool {
    let c = cell.trim();
    let inner = c.strip_prefix(':').unwrap_or(c);
    let inner = inner.strip_suffix(':').unwrap_or(inner);
    !inner.is_empty() && inner.bytes().all(|b| b == b'-')
}

fn is_delimiter_line(text: &str) -> bool {
    if text.len() > ROW_BYTE_LIMIT {
        return false;
    }
    let cells = split_cells(text);
    !cells.is_empty() && cells.iter().all(|c| is_delimiter_cell(c))
}

fn has_cell_segment(text: &str) -> bool {
    let p = pipes(text);
    if p.is_empty() {
        return false;
    }
    let first = text.find(|c: char| !c.is_whitespace());
    let last = text.rfind(|c: char| !c.is_whitespace());
    let leading = first.is_some_and(|i| text.as_bytes()[i] == b'|');
    let trailing = last.is_some_and(|i| text.as_bytes()[i] == b'|');
    !(leading && trailing && p.len() < 2)
}

/// `isMarkdownTableLine`.
pub fn is_table_line(text: &str) -> bool {
    let t = text.trim();
    !pipes(t).is_empty() && (is_delimiter_line(t) || has_cell_segment(t))
}

/// `isMarkdownTableSourceLine` (the `cm-md-table-line` class).
#[cfg(test)]
pub fn is_table_source_line(text: &str) -> bool {
    let t = text.trim();
    if pipes(t).is_empty() {
        return false;
    }
    is_delimiter_line(t) || (t.len() > 2 && t.starts_with('|') && t.ends_with('|'))
}

fn alignment(cell: &str) -> Alignment {
    let t = cell.trim();
    match (t.starts_with(':'), t.ends_with(':')) {
        (true, true) => Alignment::Center,
        (true, false) => Alignment::Left,
        (false, true) => Alignment::Right,
        _ => Alignment::None,
    }
}

fn row_cells(doc: &Buffer, line: usize) -> Vec<Cell> {
    let range = doc.line_range(line);
    let text = doc.line(line);
    segments(text)
        .into_iter()
        .map(|seg| {
            let raw = &text[seg.clone()];
            let lead = raw.len() - raw.trim_start().len();
            let trail = raw.len() - raw.trim_end().len();
            let from = range.start + seg.start + lead;
            let to = (range.start + seg.end - trail).max(from);
            Cell {
                range: from..to,
                text: unescape(raw.trim()),
                editable: true,
            }
        })
        .take(COLUMN_LIMIT + 1)
        .collect()
}

/// `getMarkdownTableBlock` for a parser table node starting at `syntax.start`.
pub fn table_block(doc: &Buffer, syntax: &Range<usize>) -> Option<Table> {
    let header = doc.line_index(syntax.start);
    if header + 1 >= doc.line_count() || doc.line_range(header).start != syntax.start {
        return None;
    }
    let delimiter = header + 1;
    if syntax.end <= doc.line_range(delimiter).start {
        return None;
    }
    let last_syntax = doc.line_index(syntax.end.saturating_sub(1).max(syntax.start));
    // The explicit extent: consecutive table lines after the delimiter.
    let mut last = delimiter;
    for line in delimiter + 1..=last_syntax {
        let text = doc.line(line);
        if !is_table_line(text) || is_delimiter_line(text) {
            break;
        }
        last = line;
    }
    let (head_text, delim_text) = (doc.line(header), doc.line(delimiter));
    if head_text.len() > ROW_BYTE_LIMIT || delim_text.len() > ROW_BYTE_LIMIT {
        return None;
    }
    let delimiter_cells = split_cells(delim_text);
    let header_cells = row_cells(doc, header);
    let refinement_valid = !header_cells.is_empty()
        && !delimiter_cells.is_empty()
        && delimiter_cells.iter().all(|c| is_delimiter_cell(c));
    let mut rows = vec![Row {
        cells: header_cells,
        header: true,
        line: header,
    }];
    let mut cell_count = rows[0].cells.len();
    for line in delimiter + 1..=last {
        let cells = row_cells(doc, line);
        cell_count += cells.len();
        if rows.len() + 1 > ROW_LIMIT
            || cell_count > CELL_LIMIT
            || cells.len() > COLUMN_LIMIT
            || doc.line(line).len() > ROW_BYTE_LIMIT
        {
            return None;
        }
        rows.push(Row {
            cells,
            header: false,
            line,
        });
    }
    if rows[0].cells.len() > COLUMN_LIMIT || delimiter_cells.len() > COLUMN_LIMIT {
        return None;
    }
    let width = rows
        .iter()
        .map(|r| r.cells.len())
        .max()
        .unwrap_or(0)
        .max(delimiter_cells.len())
        .max(1);
    // Rows narrower than the table get empty, non-editable padding cells.
    for row in &mut rows {
        let end = doc.line_range(row.line).end;
        while row.cells.len() < width {
            row.cells.push(Cell {
                range: end..end,
                text: String::new(),
                editable: false,
            });
        }
        row.cells.truncate(width);
    }
    let mut alignments: Vec<Alignment> = delimiter_cells
        .iter()
        .take(width)
        .map(|c| alignment(c))
        .collect();
    alignments.resize(width, Alignment::None);
    let range = doc.line_range(header).start..doc.line_range(last).end;
    Some(Table {
        range,
        lines: header..last + 1,
        alignments,
        rows,
        refinement_valid,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_cells_and_alignments_follow_the_product_model() {
        let doc = Buffer::new("| Name | Value \\| x |\n| :-- | --: |\n| a | b |\n| c |\nprose");
        let t = table_block(&doc, &(0..doc.len())).unwrap();
        assert_eq!(t.lines, 0..4);
        assert_eq!(t.alignments, vec![Alignment::Left, Alignment::Right]);
        assert_eq!(t.rows[0].cells[1].text, "Value | x");
        assert_eq!(doc.slice(t.rows[0].cells[0].range.clone()), "Name");
        assert!(!t.rows[2].cells[1].editable);
        assert!(is_table_source_line("| a | b |") && !is_table_source_line("a | b"));
    }
}
