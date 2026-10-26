//! `markdownTableColumnLayout.ts`: document tables hug their content, then
//! flex to the reading column. This deliberately does not use CSV's 96–560px
//! spreadsheet tracks. Estimates are in ems and sample at most 128 rows.
use super::model::Table;

const MIN: f64 = 48.;
const SLACK: f64 = 1.06;

#[derive(Clone, Copy, Debug, Default)]
struct Extent {
    min: f64,
    max: f64,
}

/// Tracks include cell padding and their end rule, like CSS `<col>` widths.
pub fn column_widths(table: &Table, available: f32, font_size: f32, inset: f32) -> Vec<f32> {
    let mut contents = vec![Extent::default(); table.alignments.len().max(1)];
    let rows = table.rows.len();
    for sample in 0..rows.min(128) {
        let index = if rows <= 128 {
            sample
        } else {
            (sample as f64 * (rows - 1) as f64 / 127.).round() as usize
        };
        let row = &table.rows[index];
        let factor = if row.header { 1.05 } else { 1. };
        for (cell, column) in row.cells.iter().zip(&mut contents) {
            let extent = measure(&cell.text);
            column.min = column.min.max(extent.min * factor);
            column.max = column.max.max(extent.max * factor);
        }
    }
    layout(&contents, available as f64, font_size as f64, inset as f64)
        .into_iter()
        .map(|w| w as f32)
        .collect()
}

fn layout(contents: &[Extent], available: f64, font: f64, inset: f64) -> Vec<f64> {
    if contents.is_empty() {
        return vec![];
    }
    let available = if available.is_finite() && available > 0. {
        available
    } else {
        640.
    };
    let available = (available.floor() - 2.).max(MIN);
    let cap = (available * 0.3).max(MIN);
    let natural: Vec<_> = contents
        .iter()
        .map(|c| (c.max * font * SLACK + inset).ceil().max(MIN))
        .collect();
    let minimum: Vec<_> = contents
        .iter()
        .zip(&natural)
        .map(|(c, n)| {
            (c.min * font * SLACK + inset)
                .ceil()
                .min(cap)
                .max(MIN)
                .min(*n)
        })
        .collect();
    let total: f64 = natural.iter().sum();
    if total <= available {
        return natural;
    }
    let short_limit = 160f64.min(available * 0.22);
    let short: Vec<_> = natural.iter().map(|n| *n <= short_limit).collect();
    let short_total: f64 = natural
        .iter()
        .zip(&short)
        .filter(|(_, s)| **s)
        .map(|(n, _)| n)
        .sum();
    let long_min: f64 = minimum
        .iter()
        .zip(&short)
        .filter(|(_, s)| !**s)
        .map(|(n, _)| n)
        .sum();
    if short.iter().any(|s| !s) && short_total + long_min <= available {
        let long_total = total - short_total;
        let ratio = (available - short_total - long_min) / (long_total - long_min);
        let exact: Vec<_> = natural
            .iter()
            .zip(&minimum)
            .zip(&short)
            .map(|((n, m), s)| if *s { *n } else { m + (n - m) * ratio })
            .collect();
        return distribute(&exact, available, &short);
    }
    let min_total: f64 = minimum.iter().sum();
    if min_total >= available {
        return minimum;
    }
    let ratio = (available - min_total) / (total - min_total);
    let exact: Vec<_> = natural
        .iter()
        .zip(&minimum)
        .map(|(n, m)| m + (n - m) * ratio)
        .collect();
    distribute(&exact, available, &vec![false; contents.len()])
}

fn distribute(exact: &[f64], target: f64, fixed: &[bool]) -> Vec<f64> {
    let mut rounded: Vec<_> = exact.iter().map(|w| w.floor()).collect();
    let remainder = (target - rounded.iter().sum::<f64>()).round().max(0.) as usize;
    let mut order: Vec<_> = (0..exact.len()).filter(|i| !fixed[*i]).collect();
    order.sort_by(|a, b| {
        exact[*b]
            .fract()
            .total_cmp(&exact[*a].fract())
            .then(a.cmp(b))
    });
    for index in order.into_iter().take(remainder) {
        rounded[index] += 1.;
    }
    rounded
}

/// Same source-to-visible-text estimate as the product (not a Markdown parser).
fn visible(source: &str) -> String {
    // /!?\[([^\]]*)\]\([^)]*\)/ and /<((?:https?|mailto):[^>\s]+)>/
    let mut text = String::new();
    let mut rest = source;
    while !rest.is_empty() {
        let label = rest.strip_prefix("![").or_else(|| rest.strip_prefix('['));
        if let Some(label) = label
            && let Some(end) = label.find(']')
            && let Some(target) = label[end + 1..].strip_prefix('(')
            && let Some(close) = target.find(')')
        {
            text.push_str(&label[..end]);
            rest = &target[close + 1..];
            continue;
        }
        if let Some(inner) = rest.strip_prefix('<')
            && let Some(end) = inner.find('>')
        {
            let link = &inner[..end];
            if ["http:", "https:", "mailto:"].iter().any(|prefix| {
                link.strip_prefix(prefix)
                    .is_some_and(|s| !s.is_empty() && !s.chars().any(char::is_whitespace))
            }) {
                text.push_str(link);
                rest = &inner[end + 1..];
                continue;
            }
        }
        let ch = rest.chars().next().unwrap();
        text.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    let text = text.replace("**", "").replace("__", "").replace("~~", "");
    let mut chars = text.chars().peekable();
    let mut unescaped = String::new();
    while let Some(ch) = chars.next() {
        if ch == '\\'
            && chars
                .peek()
                .is_some_and(|c| "\\`*_{}[]()#+-.!|".contains(*c))
        {
            unescaped.push(chars.next().unwrap());
        } else {
            unescaped.push(ch);
        }
    }
    unescaped
}

fn measure(source: &str) -> Extent {
    let text = visible(source);
    let mut rest = text.as_str();
    let mut result = Extent::default();
    let (mut line, mut word) = (0f64, 0f64);
    let mut mono = false;
    while !rest.is_empty() {
        // /<br\s*\/?>|\n/i
        let br = rest
            .get(..3)
            .filter(|s| s.eq_ignore_ascii_case("<br"))
            .and_then(|_| rest.find('>'))
            .filter(|end| {
                rest[3..*end]
                    .strip_suffix('/')
                    .unwrap_or(&rest[3..*end])
                    .chars()
                    .all(char::is_whitespace)
            });
        if rest.starts_with('\n') || br.is_some() {
            result.min = result.min.max(word);
            result.max = result.max.max(line);
            (line, word, mono) = (0., 0., false);
            rest = &rest[br.map_or(1, |end| end + 1)..];
            continue;
        }
        let ch = rest.chars().next().unwrap();
        rest = &rest[ch.len_utf8()..];
        if ch == '`' {
            mono = !mono;
            continue;
        }
        let wide = is_wide(ch);
        let width = if mono && !wide { 0.6 } else { character_em(ch) };
        line += width;
        if ch == ' ' || ch == '\t' {
            result.min = result.min.max(word);
            word = 0.;
        } else if wide {
            result.min = result.min.max(word).max(width);
            word = 0.;
        } else {
            word += width;
            if ch == '/' || ch == '-' {
                result.min = result.min.max(word);
                word = 0.;
            }
        }
    }
    result.min = result.min.max(word);
    result.max = result.max.max(line);
    result
}

fn is_wide(ch: char) -> bool {
    matches!(ch as u32, 0x1100..=0x115f | 0x2e80..=0xa4cf | 0xac00..=0xd7a3 |
        0xf900..=0xfaff | 0xfe30..=0xfe4f | 0xff00..=0xff60 | 0xffe0..=0xffe6 |
        0x1f300..=0x1faff | 0x20000..=0x3fffd)
}

fn character_em(ch: char) -> f64 {
    if is_wide(ch) {
        return 1.;
    }
    match ch {
        ' ' => 0.28,
        '\t' => 1.12,
        'M' | 'W' => 0.86,
        'A'..='Z' => 0.64,
        '0'..='9' => 0.58,
        'm' | 'w' => 0.82,
        'i' | 'l' | 'j' | 't' | 'f' | 'r' | '.' | ',' | ':' | ';' | '\'' | '|' | '!' | '('
        | ')' | '[' | ']' => 0.32,
        _ => 0.54,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tracks_match_the_product_at_every_reading_width() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../fixtures/editor/table-layout.json"
        ))
        .unwrap();
        for case in cases["cases"].as_array().unwrap() {
            let mut table = Table {
                range: 0..0,
                lines: 0..0,
                alignments: vec![],
                rows: vec![],
                refinement_valid: true,
            };
            let rows = &cases["tables"][case["table"].as_str().unwrap()];
            for (i, row) in rows.as_array().unwrap().iter().enumerate() {
                table.rows.push(super::super::model::Row {
                    header: i == 0,
                    line: i,
                    cells: row
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| super::super::model::Cell {
                            range: 0..0,
                            text: v.as_str().unwrap().into(),
                            editable: true,
                        })
                        .collect(),
                });
            }
            table.alignments =
                vec![super::super::model::Alignment::None; table.rows[0].cells.len()];
            let got = column_widths(
                &table,
                case["width"].as_f64().unwrap() as f32,
                case["font"].as_f64().unwrap() as f32,
                21.,
            );
            let expected: Vec<f32> = serde_json::from_value(case["tracks"].clone()).unwrap();
            assert_eq!(got, expected, "{}", case["id"]);
        }
    }
}
