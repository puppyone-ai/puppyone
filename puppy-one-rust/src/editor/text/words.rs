//! Word and character boundaries for cursor motion (CodeMirror
//! `moveByGroup`): a group is a run of word characters, of whitespace, or of
//! other punctuation; CJK ideographs form their own group per character run.
//!
//! Provides both `&str` functions and `Buffer` functions (`*_in`) that inspect
//! local rope windows via `Buffer::slice_cow` without materialising `flat`.
use super::buffer::Buffer;
use std::ops::Range;
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

fn clamp(text: &str, offset: usize) -> usize {
    let mut at = offset.min(text.len());
    while !text.is_char_boundary(at) {
        at -= 1;
    }
    at
}

/// Next grapheme boundary after `offset` (or the end).
pub fn next_grapheme(text: &str, offset: usize) -> usize {
    let offset = clamp(text, offset);
    text[offset..]
        .grapheme_indices(true)
        .nth(1)
        .map_or(text.len(), |(i, _)| offset + i)
}

/// Previous grapheme boundary before `offset` (or 0).
pub fn previous_grapheme(text: &str, offset: usize) -> usize {
    let offset = clamp(text, offset);
    text[..offset]
        .grapheme_indices(true)
        .next_back()
        .map_or(0, |(i, _)| i)
}

/// End of the group after `offset`, skipping leading whitespace first.
pub fn next_group(text: &str, offset: usize) -> usize {
    let offset = clamp(text, offset);
    let mut chars = text[offset..].char_indices().peekable();
    let mut end = offset;
    while let Some(&(_, c)) = chars.peek() {
        if class(c) != Class::Space {
            break;
        }
        end = offset + chars.next().unwrap().0 + c.len_utf8();
    }
    let Some(&(_, first)) = chars.peek() else {
        return end;
    };
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
    let offset = clamp(text, offset);
    let mut chars = text[..offset].char_indices().rev().peekable();
    let mut start = offset;
    while let Some(&(i, c)) = chars.peek() {
        if class(c) != Class::Space {
            break;
        }
        start = i;
        chars.next();
    }
    let Some(&(_, last)) = chars.peek() else {
        return start;
    };
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
pub fn group_at(text: &str, offset: usize) -> Range<usize> {
    let offset = clamp(text, offset);
    let after = text[offset..].chars().next();
    let before = text[..offset].chars().next_back();
    match (before, after) {
        (_, Some(c)) if class(c) != Class::Space => {
            previous_group(text, offset + c.len_utf8()).min(offset)..next_group(text, offset)
        }
        (Some(c), _) if class(c) != Class::Space => previous_group(text, offset)..offset,
        _ => offset..offset,
    }
}

/// Rope-native `next_grapheme` that never materialises `doc`'s flat string.
pub fn next_grapheme_in(doc: &Buffer, offset: usize) -> usize {
    let offset = doc.clamp(offset);
    let len = doc.len();
    if offset >= len {
        return len;
    }
    let mut window = 128usize;
    loop {
        let end = if offset.saturating_add(window) >= len {
            len
        } else {
            let mut e = doc.clamp(offset + window);
            if e <= offset {
                e = len.min(offset + 4);
                e = doc.clamp(e);
            }
            e
        };
        let slice = doc.slice_cow(offset..end);
        if let Some((i, _)) = slice.grapheme_indices(true).nth(1) {
            if offset + i < end || end == len {
                return offset + i;
            }
        } else if end == len {
            return len;
        }
        window = window.saturating_mul(2);
    }
}

/// Rope-native `previous_grapheme` that never materialises `doc`'s flat string.
pub fn previous_grapheme_in(doc: &Buffer, offset: usize) -> usize {
    let offset = doc.clamp(offset);
    if offset == 0 {
        return 0;
    }
    let mut window = 128usize;
    loop {
        let start = doc.clamp(offset.saturating_sub(window));
        let slice = doc.slice_cow(start..offset);
        if let Some((i, g)) = slice.grapheme_indices(true).next_back() {
            let ri = g.chars().any(|c| ('\u{1F1E6}'..='\u{1F1FF}').contains(&c));
            if start == 0 || (i > 0 && !ri) {
                return start + i;
            }
        } else if start == 0 {
            return 0;
        }
        window = window.saturating_mul(2);
    }
}

/// Rope-native `next_group` that never materialises `doc`'s flat string.
pub fn next_group_in(doc: &Buffer, offset: usize) -> usize {
    let offset = doc.clamp(offset);
    let len = doc.len();
    if offset >= len {
        return len;
    }
    let mut window = 256usize;
    loop {
        let end = if offset.saturating_add(window) >= len {
            len
        } else {
            doc.clamp(offset + window)
        };
        let slice = doc.slice_cow(offset..end);
        let rel = next_group(&slice, 0);
        if rel < slice.len() || end == len {
            return offset + rel;
        }
        window = window.saturating_mul(2);
    }
}

/// Rope-native `previous_group` that never materialises `doc`'s flat string.
pub fn previous_group_in(doc: &Buffer, offset: usize) -> usize {
    let offset = doc.clamp(offset);
    if offset == 0 {
        return 0;
    }
    let mut window = 256usize;
    loop {
        let start = doc.clamp(offset.saturating_sub(window));
        let slice = doc.slice_cow(start..offset);
        let rel = previous_group(&slice, slice.len());
        if rel > 0 || start == 0 {
            return start + rel;
        }
        window = window.saturating_mul(2);
    }
}

/// Rope-native `group_at` that never materialises `doc`'s flat string.
pub fn group_at_in(doc: &Buffer, offset: usize) -> Range<usize> {
    let offset = doc.clamp(offset);
    let after_end = doc.clamp((offset + 4).min(doc.len()));
    let before_start = doc.clamp(offset.saturating_sub(4));
    let after = doc.slice_cow(offset..after_end).chars().next();
    let before = doc.slice_cow(before_start..offset).chars().next_back();
    match (before, after) {
        (_, Some(c)) if class(c) != Class::Space => {
            previous_group_in(doc, offset + c.len_utf8()).min(offset)..next_group_in(doc, offset)
        }
        (Some(c), _) if class(c) != Class::Space => previous_group_in(doc, offset)..offset,
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

    #[test]
    fn stale_or_mid_codepoint_offsets_clamp_safely() {
        let t = "中文 word";
        assert_eq!(group_at(t, 1), 0..6);
        assert_eq!(group_at(t, 2), 0..6);
        assert_eq!(group_at(t, 999), 7..11);
        assert_eq!(group_at("", 42), 0..0);
        assert_eq!(next_grapheme(t, 999), t.len());
        assert_eq!(previous_grapheme(t, 2), 0);
    }

    #[test]
    fn rope_windowed_word_and_grapheme_motion_matches_str_across_chunk_seams() {
        let text = "alpha_beta 中文测试 👨‍👩‍👧‍👦 comma, space   ".repeat(60); // > 3 KB multi-leaf
        let doc = Buffer::new(text.clone());
        assert!(!doc.has_materialized_flat());

        for offset in (0..=text.len() + 8).step_by(17) {
            assert_eq!(next_grapheme_in(&doc, offset), next_grapheme(&text, offset));
            assert_eq!(
                previous_grapheme_in(&doc, offset),
                previous_grapheme(&text, offset)
            );
            assert_eq!(next_group_in(&doc, offset), next_group(&text, offset));
            assert_eq!(
                previous_group_in(&doc, offset),
                previous_group(&text, offset)
            );
            assert_eq!(group_at_in(&doc, offset), group_at(&text, offset));
        }
        assert!(!doc.has_materialized_flat());
    }
}
