//! `agentMarkdownPolicy.ts`'s first window over a long answer: at most
//! 24 KiB of text (its head and tail around a marker, open fences closed
//! and reopened) and 240 blocks. The rest shows on "Show full response".
use crate::features::desktop_agent::domain::agent_stream_presentation::{
    OpenMarkdownFence, advance_open_markdown_fence,
};
use regex::Regex;
use std::sync::LazyLock;

/// `AGENT_MARKDOWN_INITIAL_TEXT_LIMIT`, in UTF-16 units as JavaScript counts.
pub const INITIAL_TEXT_LIMIT: usize = 24 * 1024;
/// `AGENT_MARKDOWN_INITIAL_BLOCK_LIMIT`.
pub const INITIAL_BLOCK_LIMIT: usize = 240;

/// `createInitialAgentMarkdownWindow(text)`: the source shown first, and
/// whether it leaves anything out.
pub fn initial_window(text: &str) -> (String, bool) {
    let source = text.replace("\r\n", "\n").replace('\r', "\n");
    let long = utf16_len(&source) > INITIAL_TEXT_LIMIT;
    let window = if long {
        head_tail(&source, INITIAL_TEXT_LIMIT)
    } else {
        source
    };
    let (window, blocks) = limit_blocks(&window, INITIAL_BLOCK_LIMIT);
    (window, long || blocks)
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// The byte index `units` UTF-16 units into `s` (at a character boundary
/// at or after it).
fn byte_at(s: &str, units: usize) -> usize {
    let mut counted = 0;
    for (index, c) in s.char_indices() {
        if counted >= units {
            return index;
        }
        counted += c.len_utf16();
    }
    s.len()
}

fn find_open_fence(source: &str) -> Option<OpenMarkdownFence> {
    source.split('\n').fold(None, advance_open_markdown_fence)
}

fn head_tail(source: &str, limit: usize) -> String {
    const MARKER: &str = "\n\n… long response collapsed …\n\n";
    let available = limit.saturating_sub(utf16_len(MARKER));
    let head = available * 3 / 4;
    let tail = available - head;
    let total = utf16_len(source);
    // `nextLineBoundary` / `previousLineBoundary`.
    let head_end = {
        let from = byte_at(source, head);
        source[from..]
            .find('\n')
            .map_or(source.len(), |n| from + n + 1)
    };
    let tail_start = {
        let at = byte_at(source, total.saturating_sub(tail));
        // `lastIndexOf("\n", at)` looks at `at` itself too.
        let end = (at + 1).min(source.len());
        source[..end].rfind('\n').map_or(0, |n| n + 1)
    };
    let head = &source[..head_end];
    let close = find_open_fence(head)
        .map(|open| format!("\n{}", open.marker.to_string().repeat(open.length)))
        .unwrap_or_default();
    let reopen = find_open_fence(&source[..tail_start])
        .map(|open| {
            format!(
                "{}{}\n",
                open.marker.to_string().repeat(open.length),
                open.info
            )
        })
        .unwrap_or_default();
    format!("{head}{close}{MARKER}{reopen}{}", &source[tail_start..])
}

/// `limitMarkdownBlocks`: the source up to the block that reaches `limit`
/// (the marker is itself the last one).
fn limit_blocks(source: &str, limit: usize) -> (String, bool) {
    static STARTS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^#{1,6}\s|^\s*(?:>|[-*+] |\d+[.)] )").expect("block"));
    let lines: Vec<&str> = source.split('\n').collect();
    let mut blocks = 0;
    let mut fence: Option<OpenMarkdownFence> = None;
    let mut previous_blank = true;
    for (index, line) in lines.iter().enumerate() {
        let next = advance_open_markdown_fence(fence.clone(), line);
        let blank = line.trim().is_empty();
        if next != fence {
            if fence.is_none() && previous_blank {
                blocks += 1;
            }
            fence = next;
        } else if fence.is_none() && !blank && (previous_blank || STARTS.is_match(line)) {
            blocks += 1;
        }
        if blocks >= limit {
            let kept = lines[..index].join("\n");
            return (format!("{kept}\n\n… additional blocks collapsed …"), true);
        }
        previous_blank = blank;
    }
    (source.to_owned(), false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn short_answers_stay_whole() {
        assert_eq!(initial_window("a\r\nb\rc"), ("a\nb\nc".to_owned(), false));
    }

    #[test]
    fn long_answers_keep_head_and_tail_and_balance_fences() {
        // A fence open across the cut is closed before the marker and
        // reopened after it.
        let body = "x".repeat(79);
        let mut text = String::from("```ts\n");
        for _ in 0..600 {
            text.push_str(&body);
            text.push('\n');
        }
        let (window, truncated) = initial_window(&text);
        assert!(truncated);
        assert!(utf16_len(&window) <= INITIAL_TEXT_LIMIT + 200);
        let (head, tail) = window
            .split_once("\n\n… long response collapsed …\n\n")
            .expect("marker");
        assert!(head.starts_with("```ts\n") && head.ends_with("\n```"));
        assert!(tail.starts_with("```ts\n"));
        assert!(text.ends_with(tail.trim_start_matches("```ts\n")));
    }

    #[test]
    fn many_blocks_stop_at_the_limit() {
        let text = (0..300)
            .map(|i| format!("Paragraph {i}"))
            .collect::<Vec<_>>()
            .join("\n\n");
        let (window, truncated) = initial_window(&text);
        assert!(truncated);
        assert!(window.ends_with("\n\n… additional blocks collapsed …"));
        assert!(window.contains("Paragraph 238"));
        assert!(!window.contains("Paragraph 239"));
        // List items each count as a block.
        let list = (0..250).map(|i| format!("- item {i}")).collect::<Vec<_>>();
        assert!(initial_window(&list.join("\n")).1);
    }
}
