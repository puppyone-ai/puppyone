//! Word and character boundaries for cursor motion (CodeMirror
//! `moveByGroup`): a group is a run of word characters, of whitespace, or of
//! other punctuation; CJK ideographs form their own group per character run.
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Class {
    Word,
    Space,
    Other,
}

fn class(c: char) -> Class {
    if c.is_whitespace() {
        Class::Space
    } else if c.is_alphanumeric() || c == '_' {
        Class::Word
    } else {
        Class::Other
    }
}

/// Next grapheme boundary after `offset` (or the end).
pub fn next_grapheme(text: &str, offset: usize) -> usize {
    text[offset..]
        .grapheme_indices(true)
        .nth(1)
        .map_or(text.len(), |(i, _)| offset + i)
}

/// Previous grapheme boundary before `offset` (or 0).
pub fn previous_grapheme(text: &str, offset: usize) -> usize {
    text[..offset].grapheme_indices(true).next_back().map_or(0, |(i, _)| i)
}

/// End of the group after `offset`, skipping leading whitespace first.
pub fn next_group(text: &str, offset: usize) -> usize {
    let mut chars = text[offset..].char_indices().peekable();
    let mut end = offset;
    while let Some(&(_, c)) = chars.peek() {
        if class(c) != Class::Space {
            break;
        }
        end = offset + chars.next().unwrap().0 + c.len_utf8();
    }
    let Some(&(_, first)) = chars.peek() else { return end };
    let kind = class(first);
    for (i, c) in chars {
        if class(c) != kind {
            break;
        }
        end = offset + i + c.len_utf8();
    }
    end
}

/// Start of the group before `offset`, skipping trailing whitespace first.
pub fn previous_group(text: &str, offset: usize) -> usize {
    let mut chars = text[..offset].char_indices().rev().peekable();
    let mut start = offset;
    while let Some(&(i, c)) = chars.peek() {
        if class(c) != Class::Space {
            break;
        }
        start = i;
        chars.next();
    }
    let Some(&(_, last)) = chars.peek() else { return start };
    let kind = class(last);
    for (i, c) in chars {
        if class(c) != kind {
            break;
        }
        start = i;
    }
    start
}

/// The word (or group) containing `offset`, for double-click selection.
pub fn group_at(text: &str, offset: usize) -> std::ops::Range<usize> {
    let after = text[offset..].chars().next();
    let before = text[..offset].chars().next_back();
    match (before, after) {
        (_, Some(c)) if class(c) != Class::Space => previous_group(text, offset + c.len_utf8()).min(offset)..next_group(text, offset),
        (Some(c), _) if class(c) != Class::Space => previous_group(text, offset)..offset,
        _ => offset..offset,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn groups_follow_codemirror_classes() {
        let t = "hello, wide world";
        assert_eq!(next_group(t, 0), 5);
        assert_eq!(next_group(t, 5), 6);
        assert_eq!(next_group(t, 6), 11);
        assert_eq!(previous_group(t, 11), 7);
        assert_eq!(previous_group(t, 7), 5);
        assert_eq!(group_at(t, 8), 7..11);
        assert_eq!(next_grapheme("e\u{301}x", 0), 3);
        assert_eq!(previous_grapheme("中文", 6), 3);
    }
}
