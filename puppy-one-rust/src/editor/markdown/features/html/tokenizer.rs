//! HTML block tag tokenizer (`features/html/tokenizer.rs`, TS
//! `htmlTagTokenizer.ts`).
pub use crate::editor::markdown::shared::token_scan::decode_entities;

pub(crate) const VOID_TAGS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr",
];

pub(crate) enum Token {
    Open {
        tag: String,
        attributes: Vec<(String, String)>,
        void: bool,
    },
    Close(String),
    Text(String),
}

fn attributes(mut text: &str) -> Option<Vec<(String, String)>> {
    let mut out = Vec::new();
    loop {
        text = text.trim_start();
        if text.is_empty() {
            return Some(out);
        }
        let end = text
            .find(|c: char| c.is_whitespace() || c == '=')
            .unwrap_or(text.len());
        let name = text[..end].to_ascii_lowercase();
        if name.is_empty() {
            return None;
        }
        text = text[end..].trim_start();
        let value = match text.strip_prefix('=') {
            Some(rest) => {
                let rest = rest.trim_start();
                let (value, after) = match rest.chars().next() {
                    Some(q @ ('"' | '\'')) => {
                        let close = rest[1..].find(q)?;
                        (&rest[1..1 + close], &rest[close + 2..])
                    }
                    _ => {
                        let close = rest.find(char::is_whitespace).unwrap_or(rest.len());
                        (&rest[..close], &rest[close..])
                    }
                };
                text = after;
                decode_entities(value)
            }
            None => String::new(),
        };
        if out.iter().any(|(n, _): &(String, String)| *n == name) {
            return None;
        }
        out.push((name, value));
    }
}

fn tag_end(source: &str) -> Option<usize> {
    let mut quote = None;
    for (i, c) in source.char_indices().skip(1) {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, '>') => return Some(i + 1),
            (None, '<') => return None,
            _ => {}
        }
    }
    None
}

pub(crate) fn tokens(source: &str) -> Option<Vec<Token>> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut rest = source;
    while let Some(at) = rest.find('<') {
        text.push_str(&rest[..at]);
        rest = &rest[at..];
        if let Some(comment) = rest.strip_prefix("<!--") {
            let end = comment.find("-->")?;
            rest = &comment[end + 3..];
            continue;
        }
        if rest.starts_with("<!") || rest.starts_with("<?") {
            let end = rest.find('>')?;
            rest = &rest[end + 1..];
            continue;
        }
        let closing = rest.starts_with("</");
        let name_start = if closing { 2 } else { 1 };
        let is_tag = rest[name_start..]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic());
        let end = is_tag.then(|| tag_end(rest)).flatten();
        let Some(end) = end else {
            text.push('<');
            rest = &rest[1..];
            continue;
        };
        if !text.is_empty() {
            out.push(Token::Text(decode_entities(&std::mem::take(&mut text))));
        }
        let inner = &rest[name_start..end - 1];
        let (inner, self_closing) = match inner.strip_suffix('/') {
            Some(i) => (i, true),
            None => (inner, false),
        };
        let name_end = inner
            .find(|c: char| c.is_whitespace())
            .unwrap_or(inner.len());
        let tag = inner[..name_end].to_ascii_lowercase();
        if closing {
            out.push(Token::Close(tag));
        } else {
            let attributes = attributes(&inner[name_end..])?;
            let void = self_closing || VOID_TAGS.contains(&tag.as_str());
            out.push(Token::Open {
                tag,
                attributes,
                void,
            });
        }
        rest = &rest[end..];
    }
    text.push_str(rest);
    if !text.is_empty() {
        out.push(Token::Text(decode_entities(&text)));
    }
    Some(out)
}
