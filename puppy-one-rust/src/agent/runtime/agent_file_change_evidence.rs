//! `electron/main/agent/runtime/agent-file-change-evidence.mjs`: adapter
//! utility. Inputs are semantic file/diff values, never provider JSON. It
//! only prepares display evidence; it does not read files or apply edits.
use super::agent_file_change_blocks::{bound_file_change_blocks, file_change_blocks};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

const MAX_SOURCE: usize = 128 * 1024;
const MAX_PREVIEW: usize = 24 * 1024;
const MAX_FILES: usize = 100;
/// The evidence diff budget (`performance.now() + 30`). Unit tests run many
/// suites in parallel, so a descheduled thread must not read as a slow diff.
const DIFF_BUDGET: Duration = if cfg!(test) {
    Duration::from_secs(5)
} else {
    Duration::from_millis(30)
};

/// One `structuredPatch` hunk.
pub struct Hunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<String>,
}

/// `structuredPatch(…, { context: 3, maxEditLength: 4000, timeout })`:
/// `None` when the edit is too long or the deadline passes.
pub fn structured_patch(before: &str, after: &str, deadline: Instant) -> Option<Vec<Hunk>> {
    use similar::{Algorithm, ChangeTag, TextDiff};
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .deadline(deadline)
        .diff_lines(before, after);
    if Instant::now() >= deadline {
        return None;
    }
    let edits = diff
        .ops()
        .iter()
        .filter(|op| op.tag() != similar::DiffTag::Equal)
        .map(|op| op.old_range().len() + op.new_range().len())
        .sum::<usize>();
    if edits > 4000 {
        return None;
    }
    let mut hunks = Vec::new();
    for group in diff.grouped_ops(3) {
        let (Some(first), Some(last)) = (group.first(), group.last()) else {
            continue;
        };
        let old_range = first.old_range().start..last.old_range().end;
        let new_range = first.new_range().start..last.new_range().end;
        let mut lines = Vec::new();
        for op in &group {
            for change in diff.iter_changes(op) {
                let prefix = match change.tag() {
                    ChangeTag::Equal => ' ',
                    ChangeTag::Delete => '-',
                    ChangeTag::Insert => '+',
                };
                let value = change.value();
                lines.push(format!(
                    "{prefix}{}",
                    value.strip_suffix('\n').unwrap_or(value)
                ));
                if change.missing_newline() {
                    lines.push("\\ No newline at end of file".into());
                }
            }
        }
        hunks.push(Hunk {
            old_start: old_range.start + 1,
            old_lines: old_range.len(),
            new_start: new_range.start + 1,
            new_lines: new_range.len(),
            lines,
        });
    }
    Some(hunks)
}

/// `createAgentFileChangeEvidence(entries)`.
pub fn create_agent_file_change_evidence(entries: &[Value]) -> Vec<Value> {
    let deadline = Instant::now() + DIFF_BUDGET;
    let mut remaining_preview = MAX_PREVIEW;
    let mut remaining_blocks = 100usize;
    let mut out = Vec::new();
    for entry in entries.iter().take(MAX_FILES) {
        let Some(path) = entry
            .get("path")
            .and_then(Value::as_str)
            .filter(|p| !js::trim(p).is_empty())
        else {
            continue;
        };
        let kind = entry
            .get("kind")
            .filter(|k| js::truthy(k))
            .cloned()
            .unwrap_or(Value::from("update"));
        let mut change = Obj::new()
            .set("path", js::head16(path, 4096))
            .set("kind", kind);
        let mut preview = String::new();
        let mut counts: Option<(usize, usize)> = None;
        let mut is_patch = false;
        let text = |key: &str| entry.get(key).and_then(Value::as_str);
        let fragments = entry.get("fragments").and_then(Value::as_array);
        if let Some(source) = text("diff") {
            is_patch = true;
            preview = js::head16(source, MAX_SOURCE).to_string();
            let long = js::len16(source) > MAX_SOURCE;
            counts = if long { None } else { count_diff_lines(source) };
            if long {
                change.insert("truncated", true);
            }
        } else if fragments.is_some() || (text("before").is_some() && text("after").is_some()) {
            let single = [entry.clone()];
            let fragments: &[Value] = fragments.map(Vec::as_slice).unwrap_or(&single);
            let mut remaining_source = MAX_SOURCE as i64;
            let (mut additions, mut deletions) = (0, 0);
            let mut truncated = false;
            is_patch = true;
            let fragment_scope = text("scope") == Some("fragment");
            for fragment in fragments.iter().take(100) {
                let (Some(before), Some(after)) = (
                    fragment.get("before").and_then(Value::as_str),
                    fragment.get("after").and_then(Value::as_str),
                ) else {
                    truncated = true;
                    continue;
                };
                remaining_source -= (js::len16(before) + js::len16(after)) as i64;
                if remaining_source < 0 || Instant::now() >= deadline {
                    truncated = true;
                    break;
                }
                // `timeout: Math.max(1, deadline - performance.now())`.
                let call_deadline = deadline.max(Instant::now() + Duration::from_millis(1));
                let Some(hunks) = structured_patch(before, after, call_deadline) else {
                    truncated = true;
                    continue;
                };
                let fragment_preview = hunks
                    .iter()
                    .map(|hunk| {
                        for line in &hunk.lines {
                            if line.starts_with('+') {
                                additions += 1;
                            }
                            if line.starts_with('-') {
                                deletions += 1;
                            }
                        }
                        // A replacement fragment does not establish absolute file line numbers.
                        let header = if fragment_scope {
                            "@@".to_string()
                        } else {
                            format!(
                                "@@ -{},{} +{},{} @@",
                                hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
                            )
                        };
                        let lines = hunk
                            .lines
                            .iter()
                            .filter(|line| !fragment_scope || !line.starts_with('\\'));
                        std::iter::once(&header)
                            .chain(lines)
                            .cloned()
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                if !preview.is_empty() && !fragment_preview.is_empty() {
                    preview.push('\n');
                }
                preview.push_str(&fragment_preview);
            }
            if fragments.len() > 100 {
                truncated = true;
            }
            if truncated {
                change.insert("truncated", true);
            } else {
                counts = Some((additions, deletions));
            }
        } else if let Some(after) = text("after") {
            // Write can overwrite an existing file. Its new text alone cannot prove a diff.
            preview = js::head16(after, MAX_SOURCE).to_string();
            if js::len16(after) > MAX_SOURCE {
                change.insert("truncated", true);
            }
        }
        if let Some(basis) = entry.get("basis").filter(|b| js::truthy(b)) {
            change.insert("basis", basis.clone());
        }
        let safe_preview = redact_secret_text(&preview);
        let blocks = if is_patch {
            file_change_blocks(&safe_preview)
        } else {
            None
        };
        if let Some((additions, deletions)) = counts
            && blocks.is_some()
            && !entry.get("unknownMultiplicity").is_some_and(js::truthy)
        {
            change.insert("additions", additions);
            change.insert("deletions", deletions);
        }
        // Raw text and structured blocks share one budget, including their duplicated text.
        let bounded = bound_file_change_blocks(
            blocks.as_deref().unwrap_or_default(),
            remaining_preview / 2,
            remaining_blocks,
        );
        remaining_blocks = remaining_blocks.saturating_sub(bounded.blocks.len());
        change.insert("blocks", bounded.blocks);
        remaining_preview = remaining_preview.saturating_sub(bounded.used);
        if bounded.truncated || js::len16(&safe_preview) > remaining_preview {
            change.insert("truncated", true);
        }
        let diff = js::head16(&safe_preview, remaining_preview).to_string();
        remaining_preview -= js::len16(&diff);
        change.insert("diff", diff);
        out.push(change.build());
    }
    out
}

static FILE_HEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:diff --git |Index: |\*\*\* (?:Update|Add|Delete) File:)").expect("file header")
});

fn count_diff_lines(source: &str) -> Option<(usize, usize)> {
    if source.is_empty() {
        return None;
    }
    let (mut additions, mut deletions) = (0, 0);
    let mut in_hunk = false;
    let mut recognized = false;
    for line in source
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
    {
        if line.starts_with("@@") {
            in_hunk = true;
            recognized = true;
            continue;
        }
        if FILE_HEADER.is_match(line) {
            in_hunk = false;
            continue;
        }
        if !in_hunk && (line.starts_with("--- ") || line.starts_with("+++ ")) {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
            recognized = true;
        }
        if line.starts_with('-') {
            deletions += 1;
            recognized = true;
        }
    }
    recognized.then_some((additions, deletions))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn fragments_become_display_blocks_with_counts() {
        let evidence = create_agent_file_change_evidence(&[json!({
            "path": "a.md", "before": "one\ntwo\n", "after": "one\nthree\n", "scope": "fragment", "basis": "request",
        })]);
        assert_eq!(evidence.len(), 1);
        let change = &evidence[0];
        assert_eq!(change["kind"], "update");
        assert_eq!(change["additions"], 1);
        assert_eq!(change["deletions"], 1);
        assert_eq!(
            change["blocks"],
            json!([{"removed": "two", "added": "three"}])
        );
        assert_eq!(change["diff"], "@@\n one\n-two\n+three");
    }

    // `tests/unit/agent/references/electron.agent-file-change-evidence.test.mjs`.

    fn one(entry: Value) -> Value {
        create_agent_file_change_evidence(&[entry]).remove(0)
    }

    #[test]
    fn computes_real_changed_lines_without_counting_unchanged_context() {
        for (before, after, additions, deletions) in [
            ("", "added\n", 1, 0),
            ("removed\n", "", 0, 1),
            ("same\n", "same\n", 0, 0),
            ("  old\n\nend\n", "  new\n\nend\n", 1, 1),
        ] {
            let change = one(json!({"path": "file", "before": before, "after": after}));
            assert_eq!(
                (change["additions"].clone(), change["deletions"].clone()),
                (json!(additions), json!(deletions)),
                "{before:?} -> {after:?}"
            );
        }
    }

    #[test]
    fn preserves_whitespace_and_does_not_invent_absolute_line_numbers_for_fragments() {
        let change = one(
            json!({"path": "file", "before": "  old\n", "after": "  new\n", "scope": "fragment"}),
        );
        assert_eq!(change["diff"], "@@\n-  old\n+  new");
        assert_eq!(
            change["blocks"],
            json!([{"removed": "  old", "added": "  new"}])
        );
    }

    #[test]
    fn keeps_separate_changed_regions_paired_without_painting_unchanged_context() {
        let change = one(
            json!({"path": "file", "diff": "--- a/file\n+++ b/file\n@@ -1,3 +1,3 @@\n-old\n+new\n context\n-first\n+second\n@@ -90 +90 @@\n-last\n+end"}),
        );
        assert_eq!(
            change["blocks"],
            json!([{"removed": "old", "added": "new"}, {"removed": "first", "added": "second"}, {"removed": "last", "added": "end"}])
        );
    }

    #[test]
    fn distinguishes_an_edited_blank_line_from_an_absent_side() {
        for (diff, block) in [
            ("+", json!({"added": ""})),
            ("-", json!({"removed": ""})),
            ("+added", json!({"added": "added"})),
            ("-removed", json!({"removed": "removed"})),
        ] {
            assert_eq!(
                one(json!({"path": "file", "diff": diff}))["blocks"],
                json!([block])
            );
        }
    }

    #[test]
    fn leaves_unknown_write_bodies_and_binary_evidence_neutral() {
        assert_eq!(
            one(json!({"path": "file", "after": "+this is literal file content"}))["blocks"],
            json!([])
        );
        let binary = one(json!({"path": "file", "diff": "Binary files differ"}));
        assert_eq!(binary["blocks"], json!([]));
        assert_eq!(binary["diff"], "Binary files differ");
        assert!(binary.get("additions").is_none());
    }

    #[test]
    fn distinguishes_diff_file_headers_from_content_beginning_with_triple_signs() {
        let change = one(
            json!({"path": "file", "diff": "--- a/file\n+++ b/file\n@@ -1 +1 @@\n--- content\n+++ content"}),
        );
        assert_eq!(
            (change["additions"].clone(), change["deletions"].clone()),
            (json!(1), json!(1))
        );
    }

    #[test]
    fn keeps_unknown_counts_absent_for_path_only_overwritten_write_and_replace_all_requests() {
        for entry in [
            json!({"path": "file"}),
            json!({"path": "file", "after": "new file content"}),
            json!({"path": "file", "before": "old", "after": "new", "unknownMultiplicity": true}),
        ] {
            assert!(one(entry).get("additions").is_none());
        }
    }

    #[test]
    fn bounds_large_work_and_marks_omitted_previews_without_claiming_a_partial_count_as_the_total()
    {
        let large = one(json!({"path": "file", "diff": "+line\n".repeat(30_000)}));
        assert!(large["diff"].as_str().unwrap().len() <= 24 * 1024);
        assert_eq!(large["truncated"], true);
        assert!(large.get("additions").is_none());
        let many = create_agent_file_change_evidence(
            &(0..200)
                .map(|i| json!({"path": format!("file-{i}"), "diff": "+line\n".repeat(1000)}))
                .collect::<Vec<_>>(),
        );
        assert_eq!(many.len(), 100);
        let diff_total: usize = many.iter().map(|c| c["diff"].as_str().unwrap().len()).sum();
        assert!(diff_total <= 24 * 1024);
        let block_total: usize = many
            .iter()
            .flat_map(|c| c["blocks"].as_array().unwrap().iter())
            .map(|b| {
                b.get("removed").and_then(Value::as_str).map_or(0, str::len)
                    + b.get("added").and_then(Value::as_str).map_or(0, str::len)
            })
            .sum();
        assert!(diff_total + block_total <= 24 * 1024);
        assert_eq!(many.last().unwrap()["truncated"], true);
        let blank_edits = create_agent_file_change_evidence(&vec![
            json!({"path": "file", "diff": "+\n context\n".repeat(101)});
            100
        ]);
        assert_eq!(
            blank_edits
                .iter()
                .map(|c| c["blocks"].as_array().unwrap().len())
                .sum::<usize>(),
            100
        );
        assert_eq!(blank_edits.last().unwrap()["truncated"], true);
    }

    #[test]
    fn redacts_secrets_in_generated_previews() {
        let change =
            one(json!({"path": "file", "before": "", "after": "password=example-private-value\n"}));
        let diff = change["diff"].as_str().unwrap();
        assert!(diff.contains("[redacted]") && !diff.contains("example-private-value"));
        assert!(
            !change["blocks"]
                .to_string()
                .contains("example-private-value")
        );
    }

    #[test]
    fn native_diffs_are_counted_and_written_files_are_not() {
        let evidence = create_agent_file_change_evidence(&[
            json!({"path": "a.md", "diff": "--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y"}),
            json!({"path": "b.md", "after": "new text"}),
            json!({"path": "  "}),
        ]);
        assert_eq!(evidence.len(), 2);
        assert_eq!(
            (
                evidence[0]["additions"].clone(),
                evidence[0]["deletions"].clone()
            ),
            (json!(1), json!(1))
        );
        assert_eq!(evidence[1]["blocks"], json!([]));
        assert_eq!(evidence[1]["diff"], "new text");
        assert!(evidence[1].get("additions").is_none());
    }
}
