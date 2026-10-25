//! CSV / TSV text ⇄ rows (viewers/csv/csvDocument.ts): quoted fields, the
//! file's line ending, trailing line ending and BOM are preserved so an
//! untouched document serializes byte for byte.

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineEnding {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Layout {
    pub line_ending: LineEnding,
    pub trailing_line_ending: bool,
    pub utf8_bom: bool,
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            line_ending: LineEnding::Lf,
            trailing_line_ending: false,
            utf8_bom: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Parsed {
    pub rows: Vec<Vec<String>>,
    pub layout: Layout,
    pub unclosed_quote: bool,
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
    }
}

/// `parseDelimitedText`.
pub fn parse(content: &str, delimiter: Delimiter) -> Parsed {
    let layout = detect_layout(content);
    let source = content.strip_prefix('\u{FEFF}').unwrap_or(content);
    if source.is_empty() {
        return Parsed {
            rows: vec![vec![String::new()]],
            layout,
            unclosed_quote: false,
        };
    }
    let d = delimiter.char();
    let mut rows: Vec<Vec<String>> = vec![Vec::new()];
    let mut current = String::new();
    let mut quoted = false;
    let mut chars = source.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
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
        if c == '"' && current.is_empty() {
            quoted = true;
        } else if c == d {
            rows.last_mut().unwrap().push(std::mem::take(&mut current));
        } else if c == '\n' || c == '\r' {
            rows.last_mut().unwrap().push(std::mem::take(&mut current));
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            rows.push(Vec::new());
        } else {
            current.push(c);
        }
    }
    rows.last_mut().unwrap().push(current);
    if layout.trailing_line_ending && rows.last().is_some_and(|r| r.len() == 1 && r[0].is_empty()) {
        rows.pop();
    }
    if rows.is_empty() {
        rows.push(vec![String::new()]);
    }
    Parsed {
        rows,
        layout,
        unclosed_quote: quoted,
    }
}

fn serialize_cell(value: &str, delimiter: Delimiter) -> String {
    let must_quote = value.contains(delimiter.char())
        || value.contains(['"', '\n', '\r'])
        || value != value.trim();
    if must_quote {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// `stringifyDelimitedText`; `preserve_terminal_empty_record` keeps a final
/// one-column empty record distinguishable from a line ending.
pub fn stringify(
    rows: &[Vec<String>],
    delimiter: Delimiter,
    layout: Layout,
    preserve_terminal_empty_record: bool,
) -> String {
    let sep = delimiter.char().to_string();
    let body: Vec<String> = rows
        .iter()
        .enumerate()
        .map(|(i, row)| {
            if preserve_terminal_empty_record
                && i + 1 == rows.len()
                && row.len() == 1
                && row[0].is_empty()
            {
                return "\"\"".to_owned();
            }
            row.iter()
                .map(|c| serialize_cell(c, delimiter))
                .collect::<Vec<_>>()
                .join(&sep)
        })
        .collect();
    let ending = layout.line_ending.as_str();
    format!(
        "{}{}{}",
        if layout.utf8_bom { "\u{FEFF}" } else { "" },
        body.join(ending),
        if layout.trailing_line_ending {
            ending
        } else {
            ""
        }
    )
}

/// `inferDelimiter`: `.tsv`, else whichever of tab / comma is more common in
/// the first eight lines.
pub fn infer_delimiter(name: &str, content: &str) -> Delimiter {
    if name.to_ascii_lowercase().ends_with(".tsv") {
        return Delimiter::Tab;
    }
    let sample: String = content.split('\n').take(8).collect::<Vec<_>>().join("\n");
    let tabs = sample.matches('\t').count();
    let commas = sample.matches(',').count();
    if tabs > commas {
        Delimiter::Tab
    } else {
        Delimiter::Comma
    }
}

fn looks_numeric(value: &str) -> bool {
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
                utf8_bom: true
            }
        );
        assert_eq!(stringify(&p.rows, Delimiter::Comma, p.layout, true), text);
        assert!(parse("\"open", Delimiter::Comma).unclosed_quote);
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
}
