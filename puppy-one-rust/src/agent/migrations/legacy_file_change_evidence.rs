//! `electron/main/agent/migrations/legacy-file-change-evidence.mjs`: read
//! compatibility for v1 journal entries that predate canonical edit evidence.
//! The journal stays intact; only its display projection is enriched.
use crate::agent::contract::js::{self, Obj};
use crate::agent::runtime::agent_file_change_evidence::create_agent_file_change_evidence;
use serde_json::Value;

/// `legacyFileChangeEvidence(payload)`.
pub fn legacy_file_change_evidence(payload: &Value) -> Option<Vec<Value>> {
    let changes_array = payload.get("changes").and_then(Value::as_array);
    let changes: &[Value] = changes_array.map(Vec::as_slice).unwrap_or_default();
    let has_diff = |change: &Value| change.get("diff").is_some_and(Value::is_string);
    let has_blocks = |change: &Value| change.get("blocks").is_some_and(Value::is_array);
    if changes.iter().any(|c| has_diff(c) && !has_blocks(c)) {
        // Older canonical journals retained diff text without display blocks.
        // Interpret it once in Main; do not push historical patch parsing into
        // the Renderer.
        let valid: Vec<usize> = changes
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                c.get("path")
                    .and_then(Value::as_str)
                    .is_some_and(|p| !js::trim(p).is_empty())
            })
            .map(|(index, _)| index)
            .take(100)
            .collect();
        let write = payload.get("tool") == Some(&Value::from("write"));
        let inputs: Vec<Value> = valid
            .iter()
            .map(|index| {
                let change = &changes[*index];
                let text_key = if write && change.get("basis") == Some(&Value::from("request")) {
                    "after"
                } else {
                    "diff"
                };
                Obj::new()
                    .opt("path", change.get("path").cloned())
                    .opt("kind", change.get("kind").cloned())
                    .opt(text_key, change.get("diff").cloned())
                    .opt("basis", change.get("basis").cloned())
                    .build()
            })
            .collect();
        let projected = create_agent_file_change_evidence(&inputs);
        return Some(
            changes
                .iter()
                .enumerate()
                .map(|(index, change)| {
                    if has_blocks(change) {
                        return change.clone();
                    }
                    let Some(evidence) = valid
                        .iter()
                        .position(|v| *v == index)
                        .and_then(|i| projected.get(i))
                    else {
                        return change.clone();
                    };
                    let mut out = Obj::from(change)
                        .set("diff", evidence["diff"].clone())
                        .set("blocks", evidence["blocks"].clone());
                    if evidence.get("truncated") == Some(&Value::Bool(true)) {
                        out.insert("truncated", true);
                    }
                    out.build()
                })
                .collect(),
        );
    }
    if changes.len() > 1
        || (changes_array.is_some()
            && changes
                .iter()
                .all(|c| c.as_object().is_some_and(|m| m.contains_key("diff"))))
    {
        return None;
    }
    let empty = Value::Object(Default::default());
    let input = payload
        .get("input")
        .filter(|v| v.is_object() || v.is_array())
        .unwrap_or(&empty);
    let first_path = changes.first().and_then(|c| c.get("path"));
    let path = [
        payload.get("path"),
        input.get("path"),
        input.get("file_path"),
        input.get("filePath"),
        input.get("file"),
    ]
    .into_iter()
    .flatten()
    .find(|v| js::truthy(v))
    .or(first_path)
    .filter(|v| js::truthy(v))?;
    let coalesce = |values: &[Option<&Value>]| {
        values
            .iter()
            .flatten()
            .find(|v| !v.is_null())
            .map(|v| (*v).clone())
    };
    let before = coalesce(&[
        input.get("old_string"),
        input.get("oldString"),
        input.get("oldText"),
    ]);
    let after = coalesce(&[
        input.get("new_string"),
        input.get("newString"),
        input.get("newText"),
    ]);
    let diff = coalesce(&[
        payload.get("diff"),
        payload.get("patch"),
        input.get("diff"),
        input.get("patch"),
    ]);
    let diff_is_text = diff.as_ref().is_some_and(Value::is_string);
    if !diff_is_text
        && !(before.as_ref().is_some_and(Value::is_string)
            && after.as_ref().is_some_and(Value::is_string))
    {
        return None;
    }
    let evidence = create_agent_file_change_evidence(&[Obj::new()
        .set("path", path.clone())
        .opt("before", before)
        .opt("after", after)
        .opt("diff", diff)
        .set("scope", "fragment")
        .set("basis", if diff_is_text { "native" } else { "request" })
        .set(
            "unknownMultiplicity",
            input.get("replace_all") == Some(&Value::Bool(true)),
        )
        .build()]);
    let evidence = evidence.into_iter().next()?;
    let mut out = Obj::from(&evidence);
    if let Some(first) = changes.first() {
        out = out.spread(first);
    }
    let mut out = out.set("diff", evidence["diff"].clone());
    if evidence.get("truncated") == Some(&Value::Bool(true)) {
        out.insert("truncated", true);
    }
    Some(vec![out.build()])
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn edit_arguments_become_display_evidence() {
        let evidence = legacy_file_change_evidence(&json!({
            "input": {"file_path": "a.md", "old_string": "one", "new_string": "two"},
        }))
        .unwrap();
        assert_eq!(evidence[0]["path"], "a.md");
        assert_eq!(
            evidence[0]["blocks"],
            json!([{"removed": "one", "added": "two"}])
        );
        assert_eq!(evidence[0]["basis"], "request");
        assert!(legacy_file_change_evidence(&json!({"changes": []})).is_none());
        assert!(legacy_file_change_evidence(&json!({"input": {"file_path": "a.md"}})).is_none());
    }

    #[test]
    fn enriches_older_multi_file_diffs_without_changing_their_counts_or_clearing_semantics() {
        let payload = json!({"tool": "edit", "changes": [
            {"path": "file", "diff": "@@\n-old\n+new", "additions": 5, "deletions": 4, "truncated": true},
            {"path": "file", "diff": "@@\n-other\n+next"},
        ]});
        let result = legacy_file_change_evidence(&payload).unwrap();
        assert_eq!(result[0]["additions"], 5);
        assert_eq!(result[0]["deletions"], 4);
        assert_eq!(result[0]["truncated"], true);
        assert_eq!(
            result[0]["blocks"],
            json!([{"removed": "old", "added": "new"}])
        );
        assert_eq!(
            result[1]["blocks"],
            json!([{"removed": "other", "added": "next"}])
        );
        assert!(result[1].get("additions").is_none());
        assert!(payload["changes"][0].get("blocks").is_none());
        let mut cleared = payload.clone();
        cleared["changes"] = json!([]);
        assert!(legacy_file_change_evidence(&cleared).is_none());
    }

    #[test]
    fn diff_only_changes_gain_blocks() {
        let evidence = legacy_file_change_evidence(&json!({
            "changes": [{"path": "a.md", "diff": "@@\n-a\n+b"}, {"path": "b.md", "blocks": []}],
        }))
        .unwrap();
        assert_eq!(
            evidence[0]["blocks"],
            json!([{"removed": "a", "added": "b"}])
        );
        assert_eq!(evidence[1], json!({"path": "b.md", "blocks": []}));
    }
}
