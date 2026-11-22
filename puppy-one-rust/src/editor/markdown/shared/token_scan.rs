//! Single-line delimiter scanning, balanced parentheses, and backslash escape
//! helpers (product `shared/inlineTokenScan.ts`).
//!
//! Floor-layer utility: depends only on `std` (`R6`, `MA-08`).

/// Whether the character at `index` is escaped by an odd backslash run.
pub fn is_escaped(source: &[u8], index: usize) -> bool {
    source[..index]
        .iter()
        .rev()
        .take_while(|&&b| b == b'\\')
        .count()
        % 2
        == 1
}

/// Find an unescaped `delimiter` from `start` without crossing a line.
/// Returns `(closing index, next scan index)`.
pub fn scan_delimiter(source: &[u8], start: usize, delimiter: &[u8]) -> (Option<usize>, usize) {
    let mut escaped = false;
    let mut i = start;
    while i < source.len() {
        let c = source[i];
        if c == b'\n' {
            return (None, i + 1);
        }
        if escaped {
            escaped = false;
        } else if c == b'\\' {
            escaped = true;
        } else if source[i..].starts_with(delimiter) {
            return (Some(i), i + delimiter.len());
        }
        i += 1;
    }
    (None, source.len())
}

/// Find the matching unescaped `)` starting at `start` without crossing a line,
/// respecting nested parentheses and quoted titles.
/// Returns `(closing index, next scan index)`.
pub fn closing_paren(source: &[u8], start: usize) -> (Option<usize>, usize) {
    let (mut escaped, mut quote, mut depth) = (false, None::<u8>, 0usize);
    for (i, &c) in source.iter().enumerate().skip(start) {
        if c == b'\n' {
            return (None, i + 1);
        }
        if escaped {
            escaped = false;
            continue;
        }
        if c == b'\\' {
            escaped = true;
            continue;
        }
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            b'"' | b'\'' => quote = Some(c),
            b'(' => depth += 1,
            b')' if depth == 0 => return (Some(i), i + 1),
            b')' => depth -= 1,
            _ => {}
        }
    }
    (None, source.len())
}
