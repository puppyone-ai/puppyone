//! `tests/unit/agent/composer/electron.agent-input-policy.test.mjs`: semantic
//! reference admission and prompt mention compilation.
use crate::agent::application::agent_input_policy::{
    bind_prompt_reference_mention_delivery, compile_agent_prompt_reference_mentions,
    normalize_prompt_reference_mentions, require_supported_agent_references,
};
use serde_json::{Value, json};

fn capabilities() -> Value {
    json!({ "referenceInputs": {
        "schemaVersion": 1,
        "workspace": { "files": true, "directories": true },
        "attachments": {
            "image": { "accepted": true, "mimeTypes": ["image/png"], "maxBytes": 512 },
            "text": { "accepted": true, "mimeTypes": ["text/*"], "maxBytes": 1_024 },
            "audio": { "accepted": false }, "video": { "accepted": false }, "binary": { "accepted": false },
        },
        "limits": { "maxCount": 4, "maxBytesPerReference": 4_096, "maxTotalBytes": 8_192 },
        "steer": false, "attachmentOnly": false,
    }})
}

fn code(result: crate::agent::agent_error::AgentResult<()>) -> Option<String> {
    result.err().and_then(|error| error.code.clone())
}

#[test]
fn admits_references_by_semantic_kind_instead_of_native_transport() {
    let capabilities = capabilities();
    require_supported_agent_references(
        Some(&capabilities),
        &[
            json!({ "kind": "workspace-entry", "entryType": "file", "size": 2_048 }),
            json!({ "kind": "staged-attachment", "name": "notes.md", "mime": "text/markdown", "size": 100 }),
            json!({ "kind": "staged-attachment", "name": "shot.png", "mime": "image/png", "size": 200 }),
        ],
    )
    .expect("admitted");
}

#[test]
fn returns_stable_typed_failures_for_unsupported_kinds_and_native_kind_limits() {
    let capabilities = capabilities();
    assert_eq!(
        code(require_supported_agent_references(
            Some(&capabilities),
            &[json!({ "kind": "staged-attachment", "name": "paper.pdf", "mime": "application/pdf", "size": 100 })],
        ))
        .as_deref(),
        Some("REFERENCE_KIND_UNSUPPORTED")
    );
    assert_eq!(
        code(require_supported_agent_references(
            Some(&capabilities),
            &[json!({ "kind": "staged-attachment", "name": "shot.png", "mime": "image/png", "size": 513 })],
        ))
        .as_deref(),
        Some("REFERENCE_LIMIT_EXCEEDED")
    );
    assert_eq!(
        code(require_supported_agent_references(
            Some(&json!({})),
            &[json!({ "kind": "staged-attachment", "name": "shot.png", "mime": "image/png", "size": 10 })],
        ))
        .as_deref(),
        Some("REFERENCE_RUNTIME_CAPABILITY_MISSING")
    );
}

#[test]
fn compiles_only_authenticated_atomic_mention_ranges_into_native_paths() {
    let references = [json!({
        "authorized": true, "id": "ref-notes", "kind": "staged-attachment",
        "path": "/private/snapshots/a.snapshot", "displayName": "notes.md", "mime": "text/markdown", "size": 10,
    })];
    let prompt = "Review @notes.md and summarize it.";
    let mentions = normalize_prompt_reference_mentions(
        Some(&json!([{ "referenceId": "ref-notes", "start": 7, "end": 16 }])),
        prompt,
        &references,
    )
    .unwrap();
    let delivered =
        bind_prompt_reference_mention_delivery(&references, &mentions, &|_| Some("path"));
    assert_eq!(
        compile_agent_prompt_reference_mentions(prompt, &mentions, &delivered).unwrap(),
        "Review `/private/snapshots/a.snapshot` and summarize it."
    );
    assert_eq!(delivered[0]["inlineMentioned"], true);
    assert_eq!(delivered[0]["mentionDelivery"], "path");
    assert!(references[0].get("inlineMentioned").is_none());
}

#[test]
fn keeps_the_display_mention_in_prompt_text_when_the_harness_negotiated_a_resource_block() {
    let references = [json!({
        "id": "ref-resource", "kind": "workspace-entry", "path": "/workspace/docs/notes.md",
        "relativePath": "docs/notes.md", "displayName": "notes.md", "mime": "text/markdown",
    })];
    let prompt = "Review @docs/notes.md";
    let mentions = normalize_prompt_reference_mentions(
        Some(&json!([{ "referenceId": "ref-resource", "start": 7, "end": 21 }])),
        prompt,
        &references,
    )
    .unwrap();
    let delivered =
        bind_prompt_reference_mention_delivery(&references, &mentions, &|_| Some("resource"));
    assert_eq!(
        compile_agent_prompt_reference_mentions(prompt, &mentions, &delivered).unwrap(),
        prompt
    );
    assert_eq!(delivered[0]["mentionDelivery"], "resource");
    assert!(references[0].get("inlineMentioned").is_none());
}

#[test]
fn rejects_forged_overlapping_missing_and_image_mention_ranges() {
    let file = json!({
        "id": "ref-a", "kind": "workspace-entry", "path": "/workspace/a.md", "relativePath": "a.md",
        "displayName": "a.md", "mime": "text/markdown",
    });
    let with = |edit: Value| {
        let mut reference = file.clone();
        for (key, value) in edit.as_object().unwrap() {
            reference[key] = value.clone();
        }
        reference
    };
    let message = |mentions: Value, prompt: &str, references: &[Value]| {
        normalize_prompt_reference_mentions(Some(&mentions), prompt, references)
            .unwrap_err()
            .message
            .to_lowercase()
    };
    assert!(
        message(
            json!([{ "referenceId": "ref-a", "start": 0, "end": 5 }]),
            "@other.md",
            std::slice::from_ref(&file)
        )
        .contains("does not match")
    );
    assert!(
        message(
            json!([{ "referenceId": "missing", "start": 0, "end": 5 }]),
            "@a.md",
            std::slice::from_ref(&file)
        )
        .contains("not backed")
    );
    assert!(
        message(
            json!([{ "referenceId": "ref-a", "start": 0, "end": 5 }, { "referenceId": "ref-a", "start": 2, "end": 5 }]),
            "@a.md",
            std::slice::from_ref(&file)
        )
        .contains("range")
    );
    let image = with(json!({ "id": "ref-image", "displayName": "image.png", "mime": "image/png" }));
    assert!(
        message(
            json!([{ "referenceId": "ref-image", "start": 0, "end": 10 }]),
            "@image.png",
            &[image]
        )
        .contains("native media")
    );
    let svg = with(
        json!({ "id": "ref-svg", "relativePath": "diagram.svg", "displayName": "diagram.svg", "mime": "image/svg+xml" }),
    );
    assert_eq!(
        normalize_prompt_reference_mentions(
            Some(&json!([{ "referenceId": "ref-svg", "start": 0, "end": 12 }])),
            "@diagram.svg",
            &[svg]
        )
        .unwrap(),
        [json!({ "referenceId": "ref-svg", "start": 0, "end": 12 })]
    );
    let directory = with(json!({
        "id": "ref-directory", "entryType": "directory", "relativePath": "assets.png",
        "displayName": "assets.png", "mime": "inode/directory",
    }));
    assert_eq!(
        normalize_prompt_reference_mentions(
            Some(&json!([{ "referenceId": "ref-directory", "start": 0, "end": 11 }])),
            "@assets.png",
            &[directory]
        )
        .unwrap(),
        [json!({ "referenceId": "ref-directory", "start": 0, "end": 11 })]
    );
}
