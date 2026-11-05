//! `tests/unit/agent/composer/desktop-agent.prompt-mentions.test.ts` and
//! `tests/unit/agent/references/agentWorkspacePath.test.ts`.
use super::agent_prompt_mentions::{
    PromptPart, agent_prompt_mention_text, is_agent_media_reference,
    normalize_agent_prompt_mentions, split_agent_prompt_mentions,
};
use super::agent_workspace_path::resolve_agent_workspace_provider_path;
use crate::agent::contract::js;
use serde_json::json;
use std::collections::HashSet;

#[test]
fn keeps_utf16_ranges_stable_and_presents_a_file_as_one_segment() {
    let prompt = "看一下 @SECURITY.md 然后总结";
    let start = js::len16(&prompt[..prompt.find("@SECURITY.md").expect("mention")]);
    let mentions = normalize_agent_prompt_mentions(
        prompt,
        &[
            json!({ "referenceId": "ref-security", "start": start, "end": start + "@SECURITY.md".len() }),
        ],
        None,
    );
    assert_eq!(
        split_agent_prompt_mentions(prompt, &mentions),
        vec![
            PromptPart::Text("看一下 ".into()),
            PromptPart::Mention {
                text: "@SECURITY.md".into(),
                mention: mentions[0].clone()
            },
            PromptPart::Text(" 然后总结".into()),
        ]
    );
}

#[test]
fn drops_stale_overlapping_and_out_of_range_decorations() {
    let ids: HashSet<String> = ["ref-a", "ref-b", "ref-oob"]
        .iter()
        .map(|id| id.to_string())
        .collect();
    assert_eq!(
        normalize_agent_prompt_mentions(
            "@a.md @b.md",
            &[
                json!({ "referenceId": "ref-a", "start": 0, "end": 5 }),
                json!({ "referenceId": "ref-b", "start": 3, "end": 11 }),
                json!({ "referenceId": "ref-oob", "start": 12, "end": 99 }),
            ],
            Some(&ids),
        ),
        vec![json!({ "referenceId": "ref-a", "start": 0, "end": 5 })]
    );
}

#[test]
fn sanitizes_control_characters_while_preserving_file_names() {
    assert_eq!(
        agent_prompt_mention_text(&json!({
            "id": "external-notes", "kind": "staged-attachment", "displayName": "release\nnotes.md",
            "mime": "text/markdown", "size": 1, "status": "ready",
        })),
        "@release notes.md"
    );
}

#[test]
fn uses_the_portable_workspace_relative_identity() {
    assert_eq!(
        agent_prompt_mention_text(&json!({
            "id": "workspace-guides-notes", "kind": "workspace-entry", "entryType": "file",
            "relativePath": "docs/guides/notes.md", "displayName": "notes.md", "mime": "text/markdown",
            "size": 1, "status": "ready",
        })),
        "@docs/guides/notes.md"
    );
}

#[test]
fn reserves_visual_cards_for_raster_images() {
    assert!(is_agent_media_reference(
        &json!({ "displayName": "capture.png", "mime": "image/png" })
    ));
    assert!(!is_agent_media_reference(
        &json!({ "displayName": "diagram.svg", "mime": "image/svg+xml" })
    ));
    assert!(is_agent_media_reference(
        &json!({ "displayName": "photo.webp" })
    ));
    assert!(!is_agent_media_reference(
        &json!({ "displayName": "notes.md", "mime": "text/markdown" })
    ));
    assert!(!is_agent_media_reference(&json!({
        "kind": "workspace-entry", "entryType": "directory", "displayName": "assets.png", "mime": "inode/directory",
    })));
}

#[test]
fn converts_absolute_paths_inside_the_assigned_workspace_folder() {
    assert_eq!(
        resolve_agent_workspace_provider_path(
            "/Users/example/To-Do-List",
            "/Users/example/To-Do-List/guanqun.md"
        ),
        Some("guanqun.md".into())
    );
}

#[test]
fn keeps_provider_relative_paths_and_resolves_dot_segments() {
    assert_eq!(
        resolve_agent_workspace_provider_path(
            "/Users/example/To-Do-List",
            "docs/./notes/../guanqun.md"
        ),
        Some("docs/guanqun.md".into())
    );
}

#[test]
fn does_not_route_an_absolute_path_through_the_wrong_workspace_folder() {
    assert_eq!(
        resolve_agent_workspace_provider_path(
            "/Users/example/project-a",
            "/Users/example/project-b/guanqun.md"
        ),
        None
    );
    assert_eq!(
        resolve_agent_workspace_provider_path(
            "/Users/example/project-a",
            "../project-b/guanqun.md"
        ),
        None
    );
}

#[test]
fn supports_windows_paths_case_insensitively() {
    assert_eq!(
        resolve_agent_workspace_provider_path(
            "C:\\Users\\Example\\Project",
            "c:\\users\\example\\project\\src\\App.tsx"
        ),
        Some("src/App.tsx".into())
    );
}
