//! MDX component tag and block scanner (`mdxComponentSyntax.ts`, `MA-04`: zero `gpui`).
use crate::editor::{
    markdown::shared::fence::{fence_closes, fence_open},
    text::buffer::Buffer,
};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Token {
    pub from: usize,
    pub to: usize,
    pub name: String,
    pub closing: bool,
    pub self_closing: bool,
    pub attributes: String,
}

/// `parseMdxComponentTagTokenAt`: a capitalised tag at `start`, its
/// attributes kept whole (quotes and braces balanced).
pub fn tag_at(s: &str, start: usize) -> Option<Token> {
    let b = s.as_bytes();
    if b.get(start) != Some(&b'<') {
        return None;
    }
    let mut i = start + 1;
    let closing = b.get(i) == Some(&b'/');
    if closing {
        i += 1;
    }
    let name_from = i;
    if !b.get(i)?.is_ascii_uppercase() {
        return None;
    }
    i += 1;
    while i < b.len() && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'.' | b'-')) {
        i += 1;
    }
    let name = s[name_from..i].to_owned();
    let (mut quote, mut braces) = (None, 0usize);
    while i < b.len() {
        let c = b[i];
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == b'"' || c == b'\'' => quote = Some(c),
            None if c == b'{' => braces += 1,
            None if c == b'}' && braces > 0 => braces -= 1,
            None if c == b'>' && braces == 0 => break,
            None => {}
        }
        i += 1;
    }
    if i >= b.len() || quote.is_some() || braces != 0 {
        return None;
    }
    let before = &s[name_from + name.len()..i];
    let trimmed = before.trim_end();
    let self_closing = !closing && trimmed.ends_with('/');
    let attributes = if self_closing {
        trimmed[..trimmed.len() - 1].to_owned()
    } else {
        before.to_owned()
    };
    if closing && !attributes.trim().is_empty() {
        return None;
    }
    Some(Token {
        from: start,
        to: i + 1,
        name,
        closing,
        self_closing,
        attributes,
    })
}

/// `scanMdxComponentTagTokens`: the component tags of `s` (offsets from
/// `base`), skipping fenced code.
pub fn scan(s: &str, base: usize) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut open: Option<(u8, usize)> = None;
    let mut line_start = 0;
    for line in s.split_inclusive('\n') {
        if let Some((c, n)) = open {
            if fence_closes(line, c, n) {
                open = None;
            }
        } else if let Some(f) = fence_open(line) {
            open = Some(f);
        } else {
            let mut i = 0;
            while let Some(at) = line[i..].find('<') {
                let at = line_start + i + at;
                match tag_at(s, at) {
                    Some(mut t) => {
                        i = t.to - line_start;
                        t.from += base;
                        t.to += base;
                        tokens.push(t);
                        if i >= line.len() {
                            break;
                        }
                    }
                    None => i = at - line_start + 1,
                }
            }
        }
        line_start += line.len();
    }
    tokens
}

/// `parseMdxComponentBlock`: the component blocks of the document — from a
/// line opening a component to the line where it closes (or the end).
pub fn blocks(doc: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut fenced: Option<(u8, usize)> = None;
    let mut at = 0;
    while at < doc.len() {
        let end = doc[at..].find('\n').map_or(doc.len(), |n| at + n + 1);
        let line = &doc[at..end];
        if let Some((c, n)) = fenced {
            if fence_closes(line, c, n) {
                fenced = None;
            }
        } else if let Some(f) = fence_open(line) {
            fenced = Some(f);
        } else {
            let indent = line.len() - line.trim_start_matches(' ').len();
            if indent <= 3 && tag_at(doc, at + indent).is_some_and(|t| !t.closing) {
                let block = close(doc, at + indent);
                out.push(block.clone());
                at = block.end;
                continue;
            }
        }
        at = end;
    }
    out
}

/// Where the component opened at `from` closes: the end of that line.
fn close(doc: &str, from: usize) -> Range<usize> {
    let mut stack: Vec<String> = Vec::new();
    let mut fenced: Option<(u8, usize)> = None;
    let mut at = from;
    let mut first = true;
    while at < doc.len() {
        let end = doc[at..].find('\n').map_or(doc.len(), |n| at + n + 1);
        let line = &doc[at..end];
        let is_first = first;
        first = false;
        if !is_first && let Some((c, n)) = fenced {
            if fence_closes(line, c, n) {
                fenced = None;
            }
        } else if !is_first && let Some(f) = fence_open(line) {
            fenced = Some(f);
        } else if fenced.is_none() {
            for t in scan(line, at) {
                if t.closing {
                    if stack.last() == Some(&t.name) {
                        stack.pop();
                    }
                } else if !t.self_closing {
                    stack.push(t.name);
                }
                if stack.is_empty() {
                    return from..end.min(doc.len()).max(from);
                }
            }
        }
        at = end;
    }
    from..doc.len()
}

/// Scans capitalized `<Component` / `</Component` block delimiters for incremental window expansion.
pub fn scan_block_delimiters(
    doc: &Buffer,
    line_window: Range<usize>,
    code_lines: &[Range<usize>],
    out: &mut Vec<usize>,
) {
    let mut code_idx = code_lines.partition_point(|r| r.end <= line_window.start);
    let end = line_window.end.min(doc.line_count());
    for line in line_window.start..end {
        while code_idx < code_lines.len() && code_lines[code_idx].end <= line {
            code_idx += 1;
        }
        if code_idx < code_lines.len() && code_lines[code_idx].contains(&line) {
            continue;
        }
        let text = doc.line_cow(line);
        if !text.contains('<') {
            continue;
        }
        let base = doc.line_range(line).start;
        let bytes = text.as_bytes();
        for i in 0..bytes.len() {
            if bytes[i] == b'<' {
                let next = bytes.get(i + 1).copied();
                let is_cap_tag = next.is_some_and(|b| b.is_ascii_uppercase())
                    || (next == Some(b'/')
                        && bytes.get(i + 2).is_some_and(|b| b.is_ascii_uppercase()));
                if is_cap_tag {
                    out.push(base + i);
                }
            }
        }
    }
}
