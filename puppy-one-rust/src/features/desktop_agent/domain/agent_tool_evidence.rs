//! Port of `domain/agent-tool-evidence.ts`: bounded rendering models for tool
//! output and structured input. The source stays available for copying; the
//! view never receives an unbounded text run. Lengths count UTF-16-free chars.

pub const MAX_CHARS: usize = 24 * 1024;
pub const MAX_LINES: usize = 400;
pub const MAX_LINE_CHARS: usize = 4 * 1024;
pub const HEAD_LINES: usize = 300;
pub const TAIL_LINES: usize = 80;

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Preview {
    pub head: String,
    pub tail: String,
    pub total_lines: usize,
    pub omitted_chars: usize,
    pub omitted_lines: usize,
    pub truncated: bool,
}

fn lines(source: &str) -> impl Iterator<Item = &str> {
    source
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
}

fn clip(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.into();
    }
    if max <= 1 {
        return "…".chars().take(max).collect();
    }
    let mut out: String = value.chars().take(max - 1).collect();
    out.push('…');
    out
}

/// `createAgentToolEvidencePreview`: head (¾ of the budget) and tail around an
/// omission marker when the output exceeds the char, line or line-length limit.
pub fn preview(source: &str) -> Preview {
    if source.is_empty() {
        return Preview::default();
    }
    let total = lines(source).count();
    let longest = lines(source).map(|l| l.chars().count()).max().unwrap_or(0);
    let length = source.chars().count();
    if length <= MAX_CHARS && total <= MAX_LINES && longest <= MAX_LINE_CHARS {
        return Preview {
            head: source.into(),
            total_lines: total,
            ..Default::default()
        };
    }
    let head_budget = (MAX_CHARS * 3 / 4).max(1);
    let tail_budget = MAX_CHARS - head_budget;
    let (mut head, mut used, mut head_raw, mut head_lines) = (Vec::new(), 0usize, 0usize, 0usize);
    for line in lines(source) {
        if head_lines >= HEAD_LINES || used >= head_budget {
            break;
        }
        let separator = usize::from(!head.is_empty());
        let available = head_budget.saturating_sub(used + separator);
        if available == 0 {
            break;
        }
        let clipped = clip(line, MAX_LINE_CHARS.min(available));
        used += separator + clipped.chars().count();
        head_raw += line.chars().count().min(clipped.chars().count());
        head.push(clipped);
        head_lines += 1;
    }
    let remaining = total.saturating_sub(head_lines);
    let mut tail: Vec<(String, usize)> = Vec::new();
    if remaining > 0 {
        let keep = TAIL_LINES.min(remaining);
        let mut used = 0usize;
        for line in lines(source) {
            let clipped = clip(line, MAX_LINE_CHARS.min(tail_budget));
            let raw = line.chars().count().min(clipped.chars().count());
            used += clipped.chars().count() + usize::from(!tail.is_empty());
            tail.push((clipped, raw));
            while tail.len() > keep || used > tail_budget {
                let Some((removed, _)) = (!tail.is_empty()).then(|| tail.remove(0)) else {
                    break;
                };
                used = used.saturating_sub(removed.chars().count() + usize::from(!tail.is_empty()));
            }
        }
    }
    let captured_chars = length.min(head_raw + tail.iter().map(|t| t.1).sum::<usize>());
    let captured_lines = total.min(head_lines + tail.len());
    Preview {
        head: head.join("\n"),
        tail: tail.into_iter().map(|t| t.0).collect::<Vec<_>>().join("\n"),
        total_lines: total,
        omitted_chars: length - captured_chars,
        omitted_lines: total - captured_lines,
        truncated: true,
    }
}

/// `collectAgentToolResultLines`: non-blank result lines, at most `max`.
pub fn result_lines(source: &str, max: usize) -> (Vec<String>, usize) {
    let mut kept = Vec::new();
    let mut total = 0;
    for line in lines(source) {
        if line.trim().is_empty() {
            continue;
        }
        total += 1;
        if kept.len() < max {
            kept.push(clip(line, MAX_LINE_CHARS));
        }
    }
    let omitted = total - kept.len();
    (kept, omitted)
}

/// `stringifyAgentToolInput` for an already bounded object: two-space JSON,
/// strings capped at 4 KiB, at most 40 entries per collection, 32 KiB total.
pub fn stringify_input(value: &serde_json::Value) -> Option<String> {
    fn bound(value: &serde_json::Value, depth: usize) -> serde_json::Value {
        use serde_json::Value;
        if depth > 8 {
            return Value::String("[truncated]".into());
        }
        match value {
            Value::String(s) => Value::String(clip(s, 4 * 1024)),
            Value::Array(a) => {
                Value::Array(a.iter().take(40).map(|v| bound(v, depth + 1)).collect())
            }
            Value::Object(o) => Value::Object(
                o.iter()
                    .take(40)
                    .map(|(k, v)| (k.chars().take(512).collect(), bound(v, depth + 1)))
                    .collect(),
            ),
            other => other.clone(),
        }
    }
    let bounded = bound(value, 0);
    let object = bounded.as_object()?;
    if object.is_empty() {
        return None;
    }
    let text = serde_json::to_string_pretty(&bounded).ok()?;
    Some(text.chars().take(32 * 1024).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn small_output_is_shown_whole_and_large_output_keeps_head_and_tail() {
        let small = preview("a\nb");
        assert!(!small.truncated);
        assert_eq!(small.head, "a\nb");
        let big = (0..1000)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let p = preview(&big);
        assert!(p.truncated);
        assert!(p.head.starts_with("line 0\n"));
        assert!(p.tail.ends_with("line 999"));
        assert_eq!(p.head.lines().count(), HEAD_LINES);
        assert_eq!(p.tail.lines().count(), TAIL_LINES);
        assert_eq!(p.omitted_lines, 1000 - HEAD_LINES - TAIL_LINES);
    }
    #[test]
    fn result_lines_skip_blanks_and_count_omissions() {
        let (lines, omitted) = result_lines("a\n\n b\nc\n", 2);
        assert_eq!(lines, vec!["a", " b"]);
        assert_eq!(omitted, 1);
    }
}
