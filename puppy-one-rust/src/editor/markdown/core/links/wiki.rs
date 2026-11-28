//! Obsidian-style `[[target]]` / `[[target|alias]]` wiki-link token scanner
//! (product `core/links/wikiLinkModel.ts`).
use crate::editor::markdown::shared::token_scan::{is_escaped, scan_delimiter};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq)]
pub struct WikiLinkToken {
    pub range: Range<usize>,
    /// The visible part: alias if present, else the target.
    pub visible: Range<usize>,
    pub target: String,
}

/// `[[target]]` / `[[target|alias]]` tokens of one source string.
pub fn find_wiki_links(source: &str) -> Vec<WikiLinkToken> {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i..].starts_with(b"[[") || is_escaped(bytes, i) {
            i += 1;
            continue;
        }
        let (close, next) = scan_delimiter(bytes, i + 2, b"]]");
        if let Some(close) = close {
            let content_from = i + 2;
            let content = &source[content_from..close];
            let (target, alias) = match content.find('|') {
                Some(bar) => (
                    content_from..content_from + bar,
                    Some(content_from + bar + 1..close),
                ),
                None => (content_from..close, None),
            };
            let trimmed = source[target.clone()].trim();
            if !trimmed.is_empty() && !trimmed.contains(['[', ']']) {
                let visible = match alias {
                    Some(a) if !source[a.clone()].trim().is_empty() => a,
                    _ => target.clone(),
                };
                tokens.push(WikiLinkToken {
                    range: i..close + 2,
                    visible,
                    target: trimmed.to_owned(),
                });
            }
        }
        i = next;
    }
    tokens
}
