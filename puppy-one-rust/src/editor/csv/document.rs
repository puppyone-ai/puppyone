//! CSV / TSV text ⇄ rows (viewers/csv/csvDocument.ts): quoted fields, per-record
//! raw slices (`CS-04`), predominant quoting style, unclosed-quote row index
//! (`CS-05`), line ending, trailing line ending and UTF-8 BOM are preserved so
//! untouched records round-trip byte for byte while modified records follow the
//! file's dialect.
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Delimiter {
    Comma,
    Tab,
}

impl Delimiter {
    pub fn char(self) -> char {
        match self {
            Self::Comma => ',',
            Self::Tab => '\t',
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LineEnding {
    #[default]
    Lf,
    CrLf,
    Cr,
}

impl LineEnding {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lf => "\n",
            Self::CrLf => "\r\n",
            Self::Cr => "\r",
        }
    }
}

/// Predominant field quoting style detected when parsing a document (`CS-04`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum QuoteStyle {
    /// Quote only fields that require quotes (RFC 4180 + outer whitespace).
    #[default]
    Minimal,
    /// Quote non-numeric fields while leaving numeric literals unquoted.
    NonNumeric,
    /// Quote all non-empty fields (and empty fields when `quote_empty` holds).
    Always { quote_empty: bool },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Layout {
    pub line_ending: LineEnding,
    pub trailing_line_ending: bool,
    pub utf8_bom: bool,
    pub quote_style: QuoteStyle,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Parsed {
    pub rows: Vec<Vec<String>>,
    /// Original raw bytes of each parsed record (excluding record separator).
    pub raw: Vec<Option<Arc<str>>>,
    pub layout: Layout,
    /// 0-based row index of an unclosed quote, if the document ended mid-quote (`CS-05`).
    pub unclosed_quote: Option<usize>,
}

fn detect_layout(content: &str) -> Layout {
    let line_ending = content
        .find(['\r', '\n'])
        .map(|i| match &content[i..] {
            s if s.starts_with("\r\n") => LineEnding::CrLf,
            s if s.starts_with('\r') => LineEnding::Cr,
            _ => LineEnding::Lf,
        })
        .unwrap_or(LineEnding::Lf);
    Layout {
        line_ending,
        trailing_line_ending: content.ends_with(['\n', '\r']),
        utf8_bom: content.starts_with('\u{FEFF}'),
        quote_style: QuoteStyle::Minimal,
    }
}

fn must_quote(value: &str, delimiter: Delimiter) -> bool {
    value.contains(delimiter.char()) || value.contains(['"', '\n', '\r']) || value != value.trim()
}

#[derive(Default)]
struct QuoteStats {
    opt_total: usize,
    opt_quoted: usize,
    opt_non_num_total: usize,
    opt_non_num_quoted: usize,
    opt_num_quoted: usize,
    empty_quoted: usize,
    empty_unquoted: usize,
}

impl QuoteStats {
    fn observe(&mut self, value: &str, was_quoted: bool, delimiter: Delimiter) {
        if value.is_empty() {
            if was_quoted {
                self.empty_quoted += 1;
            } else {
                self.empty_unquoted += 1;
            }
            return;
        }
        if must_quote(value, delimiter) {
            return;
        }
        self.opt_total += 1;
        let numeric = looks_numeric(value);
        if was_quoted {
            self.opt_quoted += 1;
            if numeric {
                self.opt_num_quoted += 1;
            } else {
                self.opt_non_num_quoted += 1;
            }
        }
        if !numeric {
            self.opt_non_num_total += 1;
        }
    }

    fn detect(&self) -> QuoteStyle {
        if self.opt_total == 0 {
            if self.empty_quoted > 0 && self.empty_quoted > self.empty_unquoted {
                return QuoteStyle::Always { quote_empty: true };
            }
            return QuoteStyle::Minimal;
        }
        let num_total = self.opt_total - self.opt_non_num_total;
        if num_total > 0
            && self.opt_non_num_total > 0
            && self.opt_non_num_quoted * 2 > self.opt_non_num_total
            && self.opt_num_quoted * 2 <= num_total
        {
            return QuoteStyle::NonNumeric;
        }
        if self.opt_quoted * 2 > self.opt_total {
            QuoteStyle::Always {
                quote_empty: self.empty_quoted > self.empty_unquoted,
            }
        } else {
            QuoteStyle::Minimal
        }
    }
}

/// `parseDelimitedText`.
pub fn parse(content: &str, delimiter: Delimiter) -> Parsed {
    let mut layout = detect_layout(content);
    let source = content.strip_prefix('\u{FEFF}').unwrap_or(content);
    if source.is_empty() {
        return Parsed {
            rows: vec![vec![String::new()]],
            raw: vec![Some(Arc::from(""))],
            layout,
            unclosed_quote: None,
        };
    }
    let d = delimiter.char();
    let mut rows: Vec<Vec<String>> = vec![Vec::new()];
    let mut raw: Vec<Option<Arc<str>>> = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut field_quoted = false;
    let mut record_start = 0usize;
    let mut stats = QuoteStats::default();
    let mut chars = source.char_indices().peekable();
    while let Some((idx, c)) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek().map(|&(_, next)| next) == Some('"') {
                    current.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                current.push(c);
            }
            continue;
        }
        if c == '"' && current.is_empty() && !field_quoted {
            quoted = true;
            field_quoted = true;
        } else if c == d {
            stats.observe(&current, field_quoted, delimiter);
            rows.last_mut().unwrap().push(std::mem::take(&mut current));
            field_quoted = false;
        } else if c == '\n' || c == '\r' {
            stats.observe(&current, field_quoted, delimiter);
            rows.last_mut().unwrap().push(std::mem::take(&mut current));
            field_quoted = false;
            raw.push(Some(Arc::from(&source[record_start..idx])));
            let mut next_start = idx + c.len_utf8();
            if c == '\r' && chars.peek().map(|&(_, next)| next) == Some('\n') {
                chars.next();
                next_start += 1;
            }
            record_start = next_start;
            rows.push(Vec::new());
        } else {
            current.push(c);
        }
    }
    stats.observe(&current, field_quoted, delimiter);
    rows.last_mut().unwrap().push(current);
    raw.push(Some(Arc::from(&source[record_start..source.len()])));

    if quoted {
        // Any trailing newline belonged to the unclosed quoted field, not a record terminator.
        layout.trailing_line_ending = false;
    } else if layout.trailing_line_ending
        && rows.last().is_some_and(|r| r.len() == 1 && r[0].is_empty())
        && raw.last().is_some_and(|r| r.as_deref() == Some(""))
    {
        rows.pop();
        raw.pop();
        stats.empty_unquoted = stats.empty_unquoted.saturating_sub(1);
    }
    if rows.is_empty() {
        rows.push(vec![String::new()]);
        raw.push(Some(Arc::from("")));
    }
    layout.quote_style = stats.detect();
    let unclosed_quote = quoted.then(|| rows.len() - 1);
    Parsed {
        rows,
        raw,
        layout,
        unclosed_quote,
    }
}

/// Slice a prefix covering at most `max_records` complete records for first-screen
/// preview while background parsing completes (`CS-13`). Never splits inside a
/// quoted multi-line field unless a single record exceeds `max_bytes`.
pub fn first_screen_prefix(content: &str, max_records: usize) -> &str {
    let max_records = max_records.max(1);
    let max_bytes = 128 * 1024;
    let bom_len = if content.starts_with('\u{FEFF}') {
        '\u{FEFF}'.len_utf8()
    } else {
        0
    };
    let source = &content[bom_len..];
    let mut quoted = false;
    let mut records = 0usize;
    let mut last_record_end = 0usize;
    let mut chars = source.char_indices().peekable();
    while let Some((idx, c)) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek().map(|&(_, next)| next) == Some('"') {
                    chars.next();
                } else {
                    quoted = false;
                }
            }
        } else if c == '"' {
            quoted = true;
        } else if c == '\n' || c == '\r' {
            let mut end = idx + c.len_utf8();
            if c == '\r' && chars.peek().map(|&(_, next)| next) == Some('\n') {
                chars.next();
                end += 1;
            }
            records += 1;
            last_record_end = end;
            if records >= max_records {
                return &content[..bom_len + end];
            }
        }
        if idx > max_bytes && last_record_end > 0 {
            return &content[..bom_len + last_record_end];
        }
    }
    content
}

pub fn serialize_cell_with_style(value: &str, delimiter: Delimiter, style: QuoteStyle) -> String {
    let force = match style {
        QuoteStyle::Minimal => false,
        QuoteStyle::NonNumeric => !value.is_empty() && !looks_numeric(value),
        QuoteStyle::Always { quote_empty } => !value.is_empty() || quote_empty,
    };
    if force || must_quote(value, delimiter) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// One record passed to [`stringify_records`].
pub struct RecordOut<'a, I> {
    pub cells: I,
    pub len: usize,
    pub raw: Option<&'a str>,
    pub canonical: bool,
}

/// Byte-preserving serializer (`CS-04`): untouched records emit `raw` verbatim;
/// modified records use `layout.quote_style`; newly inserted (`canonical`)
/// records use minimal RFC 4180 quoting.
pub fn stringify_records<'a, R, I>(
    records: R,
    total_rows: usize,
    delimiter: Delimiter,
    layout: Layout,
    preserve_terminal_empty_record: bool,
) -> String
where
    R: IntoIterator<Item = RecordOut<'a, I>>,
    I: IntoIterator<Item = &'a str>,
{
    let sep = delimiter.char();
    let ending = layout.line_ending.as_str();
    let mut out = String::new();
    if layout.utf8_bom {
        out.push('\u{FEFF}');
    }
    for (i, record) in records.into_iter().enumerate() {
        if i > 0 {
            out.push_str(ending);
        }
        let is_last = i + 1 == total_rows;
        if let Some(raw) = record.raw {
            if preserve_terminal_empty_record
                && !layout.trailing_line_ending
                && is_last
                && total_rows > 1
                && record.len == 1
                && raw.is_empty()
            {
                out.push_str("\"\"");
            } else {
                out.push_str(raw);
            }
            continue;
        }
        let style = if record.canonical {
            QuoteStyle::Minimal
        } else {
            layout.quote_style
        };
        let mut cells = record.cells.into_iter().peekable();
        if preserve_terminal_empty_record
            && is_last
            && record.len == 1
            && let Some(only) = cells.peek()
            && only.is_empty()
        {
            out.push_str("\"\"");
            continue;
        }
        let mut first = true;
        for cell in cells {
            if !first {
                out.push(sep);
            }
            first = false;
            out.push_str(&serialize_cell_with_style(cell, delimiter, style));
        }
    }
    if layout.trailing_line_ending {
        out.push_str(ending);
    }
    out
}

/// `stringifyDelimitedText`; `preserve_terminal_empty_record` keeps a final
/// one-column empty record distinguishable from a line ending.
pub fn stringify(
    rows: &[Vec<String>],
    delimiter: Delimiter,
    layout: Layout,
    preserve_terminal_empty_record: bool,
) -> String {
    let records = rows.iter().map(|row| RecordOut {
        cells: row.iter().map(String::as_str),
        len: row.len(),
        raw: None,
        canonical: false,
    });
    stringify_records(
        records,
        rows.len(),
        delimiter,
        layout,
        preserve_terminal_empty_record,
    )
}

/// `inferDelimiter`: `.tsv`, else whichever of tab / comma is more common in
/// the first eight lines.
pub fn infer_delimiter(name: &str, content: &str) -> Delimiter {
    if name.to_ascii_lowercase().ends_with(".tsv") {
        return Delimiter::Tab;
    }
    let sample: String = content
        .split(['\n', '\r'])
        .take(8)
        .collect::<Vec<_>>()
        .join("\n");
    let tabs = sample.matches('\t').count();
    let commas = sample.matches(',').count();
    if tabs > commas {
        Delimiter::Tab
    } else {
        Delimiter::Comma
    }
}

pub(crate) fn looks_numeric(value: &str) -> bool {
    let t = value.trim();
    !t.is_empty()
        && (t.parse::<f64>().is_ok_and(f64::is_finite)
            || (t.starts_with("0x") && i64::from_str_radix(&t[2..], 16).is_ok()))
}

fn looks_structured(value: &str) -> bool {
    let t = value.trim();
    if t.is_empty() {
        return false;
    }
    let lower = t.to_ascii_lowercase();
    let date = |s: &str| {
        let b = s.as_bytes();
        b.len() >= 10
            && b[..4].iter().all(u8::is_ascii_digit)
            && b[4] == b'-'
            && b[5..7].iter().all(u8::is_ascii_digit)
            && b[7] == b'-'
            && b[8..10].iter().all(u8::is_ascii_digit)
    };
    let email = || {
        let Some((user, domain)) = t.split_once('@') else {
            return false;
        };
        !user.is_empty()
            && !user.contains(char::is_whitespace)
            && !domain.contains(['@', ' '])
            && domain
                .split_once('.')
                .is_some_and(|(a, b)| !a.is_empty() && !b.is_empty())
    };
    looks_numeric(t)
        || matches!(lower.as_str(), "true" | "false" | "null")
        || date(t) && (t.len() == 10 || matches!(t.as_bytes()[10], b'T' | b' '))
        || email()
        || ((lower.starts_with("http://")
            || lower.starts_with("https://")
            || lower.starts_with("www."))
            && !t.contains(char::is_whitespace))
}

/// `inferHeaderRow`: distinct short labels over a column of structured data.
pub fn infer_header(rows: &[Vec<String>]) -> bool {
    if rows.len() < 2 {
        return false;
    }
    let first = &rows[0];
    if first.is_empty() || first.iter().all(|c| c.trim().is_empty()) {
        return false;
    }
    let labels: Vec<String> = first.iter().map(|c| c.trim().to_lowercase()).collect();
    let confident = labels.iter().all(|l| {
        !l.is_empty() && l.chars().count() <= 64 && !l.contains('\n') && !looks_structured(l)
    });
    let distinct = labels
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len()
        == labels.len();
    if !confident || !distinct {
        return false;
    }
    let sample = &rows[1..rows.len().min(9)];
    if sample.len() >= 2 && sample.iter().all(|r| r.iter().all(|c| c.trim().is_empty())) {
        return true;
    }
    (0..first.len()).any(|c| {
        let values: Vec<&str> = sample
            .iter()
            .map(|r| r.get(c).map_or("", |v| v.trim()))
            .filter(|v| !v.is_empty())
            .collect();
        if values.is_empty() {
            return false;
        }
        let structured = values.iter().filter(|v| looks_structured(v)).count();
        structured >= ((values.len() as f32 * 0.6).ceil() as usize).max(1)
    })
}

/// `normalizeRows`: a rectangle of at least one row and column.
pub fn normalize(rows: Vec<Vec<String>>) -> Vec<Vec<String>> {
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let mut rows = rows;
    if rows.is_empty() {
        rows.push(Vec::new());
    }
    for row in &mut rows {
        row.resize(columns, String::new());
    }
    rows
}

/// `toColumnLabel`: A, B, …, Z, AA, …
#[cfg(test)]
pub fn column_label(index: usize) -> String {
    let mut value = index + 1;
    let mut label = String::new();
    while value > 0 {
        let rem = (value - 1) % 26;
        label.insert(0, (b'A' + rem as u8) as char);
        value = (value - 1) / 26;
    }
    label
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_stringify_round_trip_with_layout() {
        let text = "\u{FEFF}a,\"b, c\",\"say \"\"hi\"\"\"\r\n1,2,3\r\n";
        let p = parse(text, Delimiter::Comma);
        assert_eq!(
            p.rows,
            vec![vec!["a", "b, c", "say \"hi\""], vec!["1", "2", "3"]]
        );
        assert_eq!(
            p.layout,
            Layout {
                line_ending: LineEnding::CrLf,
                trailing_line_ending: true,
                utf8_bom: true,
                quote_style: QuoteStyle::Minimal,
            }
        );
        assert_eq!(stringify(&p.rows, Delimiter::Comma, p.layout, true), text);
        assert_eq!(parse("\"open", Delimiter::Comma).unclosed_quote, Some(0));
        assert_eq!(
            parse("a,b\n1,\"open\n2,3\n", Delimiter::Comma).unclosed_quote,
            Some(1)
        );
        assert_eq!(parse("", Delimiter::Comma).rows, vec![vec![""]]);
        assert_eq!(
            stringify(
                &[vec!["".into()]],
                Delimiter::Comma,
                Layout::default(),
                true
            ),
            "\"\""
        );
    }

    #[test]
    fn inference_follows_the_product_rules() {
        assert_eq!(infer_delimiter("x.tsv", "a,b"), Delimiter::Tab);
        assert_eq!(infer_delimiter("x.csv", "a\tb\tc\nd,e"), Delimiter::Tab);
        let rows = parse(
            include_str!("../../../fixtures/editor/sample.csv"),
            Delimiter::Comma,
        )
        .rows;
        assert!(infer_header(&rows));
        assert!(!infer_header(&[
            vec!["1".into(), "2".into()],
            vec!["3".into(), "4".into()]
        ]));
        assert_eq!(
            (column_label(0), column_label(25), column_label(26)),
            ("A".into(), "Z".into(), "AA".into())
        );
    }

    #[test]
    fn untouched_records_keep_exact_bytes_and_modified_records_follow_quote_style() {
        // Quoting quirks: unnecessary quotes on row 0/2, mid-token quote on row 2.
        let src = "\"id\",\"name\"\n\"1\",\"alice\"\n\"2\",bo\"b\n";
        let parsed = parse(src, Delimiter::Comma);
        assert_eq!(
            parsed.layout.quote_style,
            QuoteStyle::Always { quote_empty: false }
        );
        let mut rows = normalize(parsed.rows);
        let mut raw = parsed.raw;
        // Modify only row 1: row 0 and row 2 stay untouched!
        rows[1][1] = "alicia".into();
        raw[1] = None;
        let out = stringify_records(
            rows.iter().zip(&raw).map(|(r, raw)| RecordOut {
                cells: r.iter().map(String::as_str),
                len: r.len(),
                raw: raw.as_deref(),
                canonical: false,
            }),
            rows.len(),
            Delimiter::Comma,
            parsed.layout,
            true,
        );
        assert_eq!(out, "\"id\",\"name\"\n\"1\",\"alicia\"\n\"2\",bo\"b\n");
    }

    /// Deterministic PRNG (xorshift64*) for property testing (`CS-31`).
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x >> 12;
            x ^= x << 25;
            x ^= x >> 27;
            self.0 = x;
            x.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn below(&mut self, bound: usize) -> usize {
            (self.next() as usize) % bound.max(1)
        }
        fn coin(&mut self) -> bool {
            self.next() & 1 == 1
        }
    }

    fn random_cell(rng: &mut Rng, ending: &str) -> String {
        let len = rng.below(10);
        let mut s = String::new();
        for _ in 0..len {
            match rng.below(11) {
                0 => s.push(','),
                1 => s.push('\t'),
                2 => s.push('"'),
                3 => s.push_str(ending),
                4 => s.push(' '),
                5 => s.push_str("42"),
                6 => s.push_str("你好"),
                _ => s.push((b'a' + rng.below(26) as u8) as char),
            }
        }
        s
    }

    fn encode_quirky_field(value: &str, delimiter: Delimiter, rng: &mut Rng) -> String {
        let force_quote = rng.coin();
        if force_quote || must_quote(value, delimiter) || value.is_empty() && rng.coin() {
            format!("\"{}\"", value.replace('"', "\"\""))
        } else {
            value.to_owned()
        }
    }

    /// `CS-31`: randomized round-trip property tests across 250 seeds.
    #[test]
    fn property_round_trip_preserves_untouched_bytes_and_edited_values() {
        for seed in 1..=250u64 {
            let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
            let delimiter = if rng.coin() {
                Delimiter::Comma
            } else {
                Delimiter::Tab
            };
            let line_ending = match rng.below(3) {
                0 => LineEnding::Lf,
                1 => LineEnding::CrLf,
                _ => LineEnding::Cr,
            };
            let trailing = rng.coin();
            let bom = rng.coin();
            let cols = 1 + rng.below(6);
            let row_count = 2 + rng.below(14);
            let ending = line_ending.as_str();

            let mut raw_records = Vec::with_capacity(row_count);
            for r in 0..row_count {
                let this_cols = if cols > 1 && rng.below(5) == 0 {
                    1 + rng.below(cols)
                } else {
                    cols
                };
                let mut rec = String::new();
                for c in 0..this_cols {
                    if c > 0 {
                        rec.push(delimiter.char());
                    }
                    let mut val = random_cell(&mut rng, ending);
                    // Avoid an unquoted empty last record on a 1-col non-trailing table,
                    // which in raw CSV text is indistinguishable from a trailing newline.
                    if !trailing && r + 1 == row_count && this_cols == 1 && val.is_empty() {
                        val.push('x');
                    }
                    let encoded =
                        if !trailing && r + 1 == row_count && this_cols == 1 && val.is_empty() {
                            "\"\"".to_owned()
                        } else {
                            encode_quirky_field(&val, delimiter, &mut rng)
                        };
                    rec.push_str(&encoded);
                }
                if !trailing && r + 1 == row_count && rec.is_empty() {
                    rec = "\"\"".to_owned();
                }
                raw_records.push(rec);
            }
            let mut text = String::new();
            if bom {
                text.push('\u{FEFF}');
            }
            text.push_str(&raw_records.join(ending));
            if trailing {
                text.push_str(ending);
            }

            let parsed = parse(&text, delimiter);
            assert_eq!(parsed.unclosed_quote, None, "seed {seed}");
            assert_eq!(parsed.raw.len(), raw_records.len(), "seed {seed}");
            for (idx, orig) in raw_records.iter().enumerate() {
                assert_eq!(
                    parsed.raw[idx].as_deref(),
                    Some(orig.as_str()),
                    "seed {seed} row {idx}"
                );
            }

            let width = parsed.rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
            let mut rows = normalize(parsed.rows);
            let mut raws = parsed.raw;
            let mut touched = vec![false; rows.len()];

            // Edit a random subset of cells and optionally insert a new row.
            let edits = 1 + rng.below(5);
            for _ in 0..edits {
                let r = rng.below(rows.len());
                let c = rng.below(width);
                rows[r][c] = random_cell(&mut rng, ending);
                raws[r] = None;
                touched[r] = true;
            }
            if rng.coin() {
                let at = rng.below(rows.len() + 1);
                let new_row: Vec<String> =
                    (0..width).map(|_| random_cell(&mut rng, ending)).collect();
                rows.insert(at, new_row);
                raws.insert(at, None);
                touched.insert(at, true);
            }

            let serialized = stringify_records(
                rows.iter()
                    .zip(&raws)
                    .zip(&touched)
                    .map(|((r, raw), &is_touched)| RecordOut {
                        cells: r.iter().map(String::as_str),
                        len: r.len(),
                        raw: raw.as_deref(),
                        canonical: is_touched && raw.is_none() && rng.coin(),
                    }),
                rows.len(),
                delimiter,
                parsed.layout,
                true,
            );

            let reparsed = parse(&serialized, delimiter);
            assert_eq!(reparsed.unclosed_quote, None, "seed {seed}");
            assert_eq!(reparsed.rows.len(), rows.len(), "seed {seed}");
            let reparsed_norm = normalize(reparsed.rows);
            for r in 0..rows.len() {
                if !touched[r] {
                    // Untouched records MUST match their original raw bytes byte-for-byte!
                    assert_eq!(
                        reparsed.raw[r].as_deref(),
                        raws[r].as_deref(),
                        "seed {seed} untouched row {r} changed bytes"
                    );
                } else {
                    // Modified / inserted records MUST re-parse to exact edited cell values!
                    assert_eq!(
                        &reparsed_norm[r][..width],
                        &rows[r][..width],
                        "seed {seed} modified row {r} value mismatch"
                    );
                }
            }
        }
    }
}
