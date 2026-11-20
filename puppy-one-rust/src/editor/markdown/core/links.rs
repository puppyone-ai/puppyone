//! Link token scanners (core/links/markdownLinkModel.ts, wikiLinkModel.ts,
//! shared/inlineTokenScan.ts). Only links these scanners recognise are
//! decorated; everything else stays visible source, as in the product.
use std::{collections::HashMap, ops::Range};

#[derive(Clone, Debug, PartialEq)]
pub struct LinkToken {
    pub range: Range<usize>,
    pub label: Range<usize>,
    pub href: String,
}

/// A standard `![alt](destination "title")` image (`MarkdownImageToken`).
#[derive(Clone, Debug, PartialEq)]
pub struct ImageToken {
    pub range: Range<usize>,
    pub alt: Range<usize>,
    pub href: String,
    pub title: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WikiLinkToken {
    pub range: Range<usize>,
    /// The visible part: alias if present, else the target.
    pub visible: Range<usize>,
    pub target: String,
}

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
/// Returns (closing index, next scan index).
fn scan_delimiter(source: &[u8], start: usize, delimiter: &[u8]) -> (Option<usize>, usize) {
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

fn closing_paren(source: &[u8], start: usize) -> (Option<usize>, usize) {
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

fn trailing_title_start(value: &str) -> Option<usize> {
    let bytes = value.as_bytes();
    let quote = *bytes.last()?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    for i in (0..bytes.len().saturating_sub(1)).rev() {
        if bytes[i] != quote || is_escaped(bytes, i) {
            continue;
        }
        let before = value[..i].trim_end();
        if before.is_empty() || before.len() == i {
            return None;
        }
        return Some(i);
    }
    None
}

fn destination(value: &str) -> Option<String> {
    destination_and_title(value).map(|(href, _)| href)
}

/// `parseMarkdownImageDestination`: the destination as authored (spaces
/// included) and its optional quoted title.
fn destination_and_title(value: &str) -> Option<(String, Option<String>)> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let unquote = |title: &str| title[1..title.len() - 1].to_owned();
    // `/^<([^>\n]+)>(?:\s+["'][^"']*["'])?$/`
    if let Some(rest) = trimmed.strip_prefix('<')
        && let Some(close) = rest.find('>')
    {
        let (inner, tail) = (&rest[..close], &rest[close + 1..]);
        let title = tail.trim_start();
        let tail_ok = tail.is_empty()
            || (title.len() < tail.len()
                && title.len() >= 2
                && matches!(title.as_bytes()[0], b'"' | b'\'')
                && matches!(title.as_bytes()[title.len() - 1], b'"' | b'\'')
                && !title[1..title.len() - 1].contains(['"', '\'']));
        if !inner.is_empty() && !inner.contains('\n') && tail_ok {
            let href = inner.trim();
            return (!href.is_empty())
                .then(|| (href.to_owned(), (!title.is_empty()).then(|| unquote(title))));
        }
    }
    let (href, title) = match trailing_title_start(trimmed) {
        Some(at) => (trimmed[..at].trim(), Some(unquote(&trimmed[at..]))),
        None => (trimmed, None),
    };
    (!href.is_empty()).then(|| (href.to_owned(), title))
}

/// `[label](destination "title")` tokens of one source string.
pub fn find_links(source: &str) -> Vec<LinkToken> {
    // No inline destination can exist without this adjacent delimiter. Avoid
    // building a bracket index for ordinary prose and unmatched opening runs.
    if !source.contains("](") {
        return Vec::new();
    }
    let bytes = source.as_bytes();
    // Pair nested labels once. Looking for the first `]` mistakes an image's
    // destination for the outer link; rescanning every unmatched `[` is quadratic.
    let mut openings = Vec::new();
    let mut closings = HashMap::new();
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'\n' => openings.clear(),
            b'\\' => at += 1,
            b'[' => openings.push(at),
            b']' => {
                if let Some(open) = openings.pop() {
                    closings.insert(open, at);
                }
            }
            _ => {}
        }
        at += 1;
    }
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'[' || (i > 0 && bytes[i - 1] == b'!') || is_escaped(bytes, i) {
            i += 1;
            continue;
        }
        let Some(label_to) = closings
            .get(&i)
            .copied()
            .filter(|&t| t > i + 1 && bytes.get(t + 1) == Some(&b'('))
        else {
            i += 1;
            continue;
        };
        let href_from = label_to + 2;
        let (href_to, next) = closing_paren(bytes, href_from);
        let Some(href_to) = href_to.filter(|&t| t > href_from) else {
            i = next;
            continue;
        };
        let label = &source[i + 1..label_to];
        match destination(&source[href_from..href_to]) {
            Some(href) if !label.trim().is_empty() => tokens.push(LinkToken {
                range: i..href_to + 1,
                label: i + 1..label_to,
                href,
            }),
            _ => {}
        }
        i = href_to + 1;
    }
    tokens
}

/// `findStandardMarkdownImageTokens`: `![alt](destination "title")`
/// images of one source string, the alt text on its own line and the
/// destination taken as authored, spaces included (a macOS screenshot's
/// name). Obsidian `![[…]]` embeds are not these.
pub fn find_images(source: &str) -> Vec<ImageToken> {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i..].starts_with(b"![") || is_escaped(bytes, i) {
            i += 1;
            continue;
        }
        if bytes[i..].starts_with(b"![[") {
            i += 3;
            continue;
        }
        let alt_from = i + 2;
        let (alt_to, next) = scan_delimiter(bytes, alt_from, b"]");
        let Some(alt_to) = alt_to.filter(|&t| bytes.get(t + 1) == Some(&b'(')) else {
            i = next.max(i + 1);
            continue;
        };
        let href_from = alt_to + 2;
        let (href_to, next) = closing_paren(bytes, href_from);
        let Some(href_to) = href_to.filter(|&t| t > href_from) else {
            i = next.max(i + 1);
            continue;
        };
        if let Some((href, title)) = destination_and_title(&source[href_from..href_to]) {
            tokens.push(ImageToken {
                range: i..href_to + 1,
                alt: alt_from..alt_to,
                href,
                title,
            });
        }
        i = href_to + 1;
    }
    tokens
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_follow_the_product_scanner() {
        let t = find_links(
            "a [link](https://example.com) and ![img](x) [x](<a b> \"t\") [](no) \\[n](o)",
        );
        assert_eq!(t.len(), 2);
        assert_eq!(
            (t[0].range.clone(), t[0].label.clone(), t[0].href.as_str()),
            (2..29, 3..7, "https://example.com")
        );
        assert_eq!(t[1].href, "a b");
        let w = find_wiki_links("see [[Note#H|alias]] and [[Other]]");
        assert_eq!(w.len(), 2);
        assert_eq!(
            (
                w[0].target.as_str(),
                &"see [[Note#H|alias]] and [[Other]]"[w[0].visible.clone()]
            ),
            ("Note#H", "alias")
        );
    }

    /// `keeps markdown link titles out of the href`.
    #[test]
    fn a_link_title_stays_out_of_the_href() {
        let source = "[label](note.md \"Title\")";
        let t = find_links(source);
        assert_eq!(
            (
                t[0].range.clone(),
                &source[t[0].label.clone()],
                t[0].href.as_str()
            ),
            (0..24, "label", "note.md")
        );
    }

    /// `findStandardMarkdownImageTokens`: destinations keep their spaces,
    /// titles come apart, Obsidian embeds and escaped or code-like openers
    /// are not standard images.
    #[test]
    fn standard_images_keep_spaced_destinations_and_their_titles() {
        let source = "![Context Base](asserts/Screenshot 2026-07-15 at 10.07.43 PM.png) \\![no](x.png) ![[e.png]] ![t](<a b.png> \"T\") ![p](y.png 'P')";
        let t = find_images(source);
        let found: Vec<_> = t
            .iter()
            .map(|t| (&source[t.alt.clone()], t.href.as_str(), t.title.as_deref()))
            .collect();
        assert_eq!(
            found,
            [
                (
                    "Context Base",
                    "asserts/Screenshot 2026-07-15 at 10.07.43 PM.png",
                    None
                ),
                ("t", "a b.png", Some("T")),
                ("p", "y.png", Some("P")),
            ]
        );
        assert_eq!(t[0].range, 0..65);
    }
}
