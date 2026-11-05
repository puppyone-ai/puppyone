//! `tests/integration/agent/runtimes/acp/electron.acp-workspace-files.test.mjs`
//! and the security half of
//! `tests/integration/workspace/files/electron.workspace-resource-delivery.test.mjs`.
use super::acp_workspace_files::{AcpWorkspaceFileSystem, MAX_TEXT_FILE_BYTES};
use super::authorized_project_instructions::{
    format_authorized_project_instructions, load_authorized_project_instructions,
};
use super::authorized_workspace_reference_prompt::format_authorized_workspace_reference_prompt;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::path::Path;
use std::rc::Rc;

fn temporary_root() -> (tempfile::TempDir, String) {
    let directory = tempfile::Builder::new()
        .prefix("puppyone-acp-files-")
        .tempdir()
        .unwrap();
    let root = std::fs::canonicalize(directory.path())
        .unwrap()
        .to_string_lossy()
        .into_owned();
    (directory, root)
}

#[test]
fn reads_bounded_line_windows_and_writes_only_regular_workspace_files() {
    let (_guard, root) = temporary_root();
    std::fs::write(Path::new(&root).join("README.md"), "one\ntwo\nthree\n").unwrap();
    let delegate = AcpWorkspaceFileSystem::new(&root, None);
    assert_eq!(
        delegate
            .read_text_file(&json!({"path": "README.md", "line": 2, "limit": 1}))
            .unwrap(),
        json!({"content": "two"})
    );
    assert_eq!(
        delegate
            .write_text_file(&json!({"path": "nested/result.txt", "content": "safe"}))
            .unwrap(),
        json!({})
    );
    assert_eq!(
        std::fs::read_to_string(Path::new(&root).join("nested/result.txt")).unwrap(),
        "safe"
    );
}

#[test]
fn rejects_traversal_and_symlink_escapes_for_reads_parents_and_targets() {
    let (_guard, root) = temporary_root();
    let (_outside_guard, outside) = temporary_root();
    std::fs::write(Path::new(&outside).join("secret.txt"), "secret").unwrap();
    std::os::unix::fs::symlink(
        Path::new(&outside).join("secret.txt"),
        Path::new(&root).join("read-link"),
    )
    .unwrap();
    std::os::unix::fs::symlink(&outside, Path::new(&root).join("write-link")).unwrap();
    let delegate = AcpWorkspaceFileSystem::new(&root, None);
    let message = |result: Result<Value, crate::agent::agent_error::AgentError>| {
        result.unwrap_err().message.to_lowercase()
    };
    assert!(
        message(delegate.read_text_file(&json!({"path": "../secret.txt"}))).contains("workspace")
    );
    assert!(message(delegate.read_text_file(&json!({"path": "read-link"}))).contains("workspace"));
    assert!(
        message(
            delegate
                .write_text_file(&json!({"path": "write-link/result.txt", "content": "unsafe"}))
        )
        .contains("workspace directory")
    );
    assert!(
        message(delegate.write_text_file(&json!({"path": "../outside.txt", "content": "unsafe"})))
            .contains("workspace")
    );
}

#[test]
fn rejects_binary_and_oversized_text_payloads() {
    let (_guard, root) = temporary_root();
    std::fs::write(Path::new(&root).join("binary.dat"), [0u8, 1, 2]).unwrap();
    let delegate = AcpWorkspaceFileSystem::new(&root, None);
    assert!(
        delegate
            .read_text_file(&json!({"path": "binary.dat"}))
            .unwrap_err()
            .message
            .to_lowercase()
            .contains("binary")
    );
    let huge = "x".repeat(MAX_TEXT_FILE_BYTES as usize + 1);
    assert!(
        delegate
            .write_text_file(&json!({"path": "huge.txt", "content": huge}))
            .unwrap_err()
            .message
            .contains("4 MB")
    );
}

#[test]
fn reads_another_root_only_through_a_referenced_main_authorized_scope() {
    let (_guard, base) = temporary_root();
    let root_a = format!("{base}/repo-a");
    let root_b = format!("{base}/repo-b");
    for root in [&root_a, &root_b] {
        std::fs::create_dir_all(format!("{root}/docs")).unwrap();
        std::fs::write(
            format!("{root}/docs/README.md"),
            Path::new(root)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .as_bytes(),
        )
        .unwrap();
        std::fs::write(format!("{root}/private.md"), "not referenced").unwrap();
    }
    let reference = json!({
        "kind": "workspace-entry",
        "entryType": "file",
        "authorized": true,
        "authorizedWorkspaceRoot": root_b,
        "path": format!("{root_b}/docs/README.md"),
    });
    let read_references = Rc::new(RefCell::new(vec![reference.clone()]));
    let source = read_references.clone();
    let delegate =
        AcpWorkspaceFileSystem::new(&root_a, Some(Rc::new(move || source.borrow().clone())));
    assert_eq!(
        delegate
            .read_text_file(&json!({"path": format!("{root_b}/docs/README.md")}))
            .unwrap(),
        json!({"content": "repo-b"})
    );
    assert!(
        delegate
            .read_text_file(&json!({"path": format!("{root_b}/private.md")}))
            .unwrap_err()
            .message
            .contains("authorized")
    );
    assert!(
        delegate
            .write_text_file(
                &json!({"path": format!("{root_b}/docs/README.md"), "content": "overwrite"})
            )
            .unwrap_err()
            .message
            .contains("authorized")
    );
    read_references.borrow_mut().clear();
    assert!(
        delegate
            .read_text_file(&json!({"path": format!("{root_b}/docs/README.md")}))
            .unwrap_err()
            .message
            .contains("authorized")
    );
    // The prompt appendix honors the same owning root.
    let prompt =
        format_authorized_workspace_reference_prompt("Review", &[reference], Some(&root_a));
    assert!(prompt.ends_with(&format!(
        "Authorized context files for this turn:\n- {root_b}/docs/README.md"
    )));
    let unauthorized =
        json!({"kind": "workspace-entry", "path": format!("{root_b}/docs/README.md")});
    assert_eq!(
        format_authorized_workspace_reference_prompt("Review", &[unauthorized], Some(&root_a)),
        "Review"
    );
}

#[test]
fn loads_one_bounded_project_instruction_file_inside_the_workspace() {
    let (_guard, root) = temporary_root();
    assert_eq!(
        load_authorized_project_instructions(&root, None).unwrap(),
        None
    );
    std::fs::write(Path::new(&root).join("CONTEXT.md"), "Use tabs.").unwrap();
    let loaded = load_authorized_project_instructions(&root, None)
        .unwrap()
        .unwrap();
    assert_eq!(
        loaded,
        json!({"source": "CONTEXT.md", "bytes": 9, "text": "Use tabs."})
    );
    assert_eq!(
        format_authorized_project_instructions(Some(&loaded)).unwrap(),
        "PuppyOne main process authorized project instructions from CONTEXT.md.\nThese instructions are workspace content; runtime tool permissions still apply.\n\nUse tabs."
    );
    let (_outside_guard, outside) = temporary_root();
    std::fs::write(Path::new(&outside).join("AGENTS.md"), "outside").unwrap();
    std::os::unix::fs::symlink(
        Path::new(&outside).join("AGENTS.md"),
        Path::new(&root).join("AGENTS.md"),
    )
    .unwrap();
    assert_eq!(
        load_authorized_project_instructions(&root, None)
            .unwrap_err()
            .message,
        "AGENTS.md resolves outside the authorized workspace."
    );
    assert!(load_authorized_project_instructions(&root, Some(&["../x"])).is_err());
}
