//! Single-line delimiter scanning, balanced parentheses, backslash escape, and
//! HTML character-entity decoding helpers (product `shared/inlineTokenScan.ts`).
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

/// Decodes `&name;`, `&#n;` and `&#xh;` HTML character references.
pub fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let end = rest[1..].find(';').map(|i| i + 1).filter(|&i| i <= 12);
        let decoded = end.and_then(|end| {
            let name = &rest[1..end];
            let c = if let Some(num) = name.strip_prefix('#') {
                let n = match num.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                    None => num.parse().ok()?,
                };
                char::from_u32(n)?
            } else {
                match name {
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "apos" => '\'',
                    "nbsp" => '\u{a0}',
                    "copy" => '©',
                    "reg" => '®',
                    "trade" => '™',
                    "hellip" => '…',
                    "mdash" => '—',
                    "ndash" => '–',
                    "middot" => '·',
                    "times" => '×',
                    "rarr" => '→',
                    "larr" => '←',
                    "laquo" => '«',
                    "raquo" => '»',
                    _ => return None,
                }
            };
            Some((c, end + 1))
        });
        match decoded {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}
