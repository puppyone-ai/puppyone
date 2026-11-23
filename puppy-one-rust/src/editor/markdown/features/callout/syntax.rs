//! Callout marker syntax parser (`features/callout/syntax.rs`, `MA-04`: zero `gpui`).
//!
//! Recognizes Obsidian `> [!type][+-]?` headers on the opening line of a blockquote.

/// Parsed `[!type][+-]?` header within a blockquote's first line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalloutHeader {
    pub appearance: &'static str,
    pub default_title: String,
    pub fold: Option<bool>,
    /// Byte offsets relative to the line's start for `[!type][+-]? ` marker.
    pub marker_start: usize,
    pub marker_end: usize,
}

/// Parses `> [!type][+-]?` from a raw line slice.
pub fn parse_header(text: &str) -> Option<CalloutHeader> {
    let lead = text.len() - text.trim_start().len();
    let rest = text[lead..].strip_prefix('>')?;
    let space = usize::from(rest.starts_with([' ', '\t']));
    let after = &rest[space..];
    let word_len = after.strip_prefix("[!")?.find(']').filter(|&n| n > 0)?;
    let word = &after[2..2 + word_len];
    if !word.starts_with(|c: char| c.is_ascii_alphabetic())
        || !word
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    let mut end = 2 + word_len + 1;
    let fold = match after[end..].chars().next() {
        Some('-') => {
            end += 1;
            Some(true)
        }
        Some('+') => {
            end += 1;
            Some(false)
        }
        _ => None,
    };
    let marker_start = lead + 1 + space;
    let spaces = after[end..].len() - after[end..].trim_start_matches([' ', '\t']).len();
    let marker_end = marker_start + end + spaces;
    let lower = word.to_lowercase();
    let appearance = match lower.as_str() {
        "abstract" | "summary" | "tldr" => "abstract",
        "attention" | "warning" => "warning",
        "bug" => "bug",
        "caution" => "caution",
        "check" | "done" | "success" => "success",
        "cite" | "quote" => "quote",
        "danger" | "error" => "danger",
        "example" => "example",
        "fail" | "failure" | "missing" => "failure",
        "faq" | "help" | "question" => "question",
        "hint" | "tip" => "tip",
        "important" => "important",
        "info" => "info",
        "todo" => "todo",
        _ => "note",
    };
    let mut default_title = lower;
    if let Some(first) = default_title.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    Some(CalloutHeader {
        appearance,
        default_title,
        fold,
        marker_start,
        marker_end,
    })
}
