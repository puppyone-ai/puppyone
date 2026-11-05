//! `tests/integration/agent/references/electron.agent-attachment-store.test.mjs`
//! and `electron.agent-reference-authorization.test.mjs`.
use super::agent_attachment_store::{
    AgentAttachmentStore, AttachmentStoreOptions, FileSnapshot, limits,
};
use crate::agent::agent_reference_authorization::{
    ReferenceBudget, authorize_agent_references, limits as reference_limits,
    workspace_draft_references,
};
use crate::agent::application::tests_support::run_local;
use crate::agent::contract::js;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::Cell;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::rc::Rc;

fn root() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("puppyone-agent-staging-")
        .tempdir()
        .unwrap()
}

fn store_at(path: &Path) -> AgentAttachmentStore {
    AgentAttachmentStore::new(AttachmentStoreOptions {
        root_path: path.to_path_buf(),
        ..Default::default()
    })
    .unwrap()
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn request(owner: i64, workspace: &str, epoch: &str) -> Value {
    json!({ "ownerId": owner, "workspaceRoot": workspace, "epoch": epoch })
}

fn with(base: &Value, key: &str, value: Value) -> Value {
    js::with(base, key, value)
}

fn entries(directory: &Path) -> Vec<String> {
    std::fs::read_dir(directory)
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect()
}

const PNG: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

#[test]
fn gives_pathless_images_the_same_private_snapshot_deduplication_and_owner_bound_lease() {
    run_local(async {
        let root = root();
        let store = store_at(&root.path().join("staging"));
        let base = request(7, &text(root.path()), "clipboard");
        let inline = json!([{ "name": "clipboard.png", "bytes": js::uint8array(&PNG) }]);
        let draft = store
            .stage(&with(&base, "sources", inline.clone()))
            .await
            .unwrap()
            .remove(0);
        assert_eq!(draft["displayName"], "clipboard.png");
        assert_eq!(draft["mime"], "image/png");
        assert_eq!(draft["status"], "ready");
        assert_eq!(draft["size"], 8);
        assert!(draft.get("path").is_none() && draft.get("bytes").is_none());
        let duplicate = store
            .stage(&with(&base, "sources", inline))
            .await
            .unwrap()
            .remove(0);
        assert_eq!(duplicate, draft);
        let authorized = store
            .authorize(&with(&base, "references", json!([draft])))
            .await
            .unwrap()
            .remove(0);
        let path = PathBuf::from(authorized["path"].as_str().unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), PNG);
        assert_eq!(
            entries(path.parent().unwrap()),
            [path.file_name().unwrap().to_string_lossy()]
        );
        let foreign = with(
            &with(&base, "ownerId", json!(8)),
            "references",
            json!([draft]),
        );
        assert!(store.authorize(&foreign).await.is_err());
        let tokens = json!([draft["token"]]);
        store
            .lease(&with(
                &with(&base, "tokens", tokens.clone()),
                "leaseId",
                json!("clipboard-turn"),
            ))
            .await
            .unwrap();
        assert_eq!(
            store
                .revoke(&with(&base, "tokens", tokens.clone()))
                .unwrap(),
            json!({ "revoked": 0 })
        );
        store.revoke_leased(&with(&base, "tokens", tokens)).unwrap();
        assert!(!path.exists());
        store.close().await;
    });
}

#[test]
fn validates_inline_sources_and_enforces_their_byte_budget_in_main() {
    run_local(async {
        let root = root();
        let store = store_at(&root.path().join("staging"));
        let base = request(7, &text(root.path()), "clipboard");
        let rejected = regex::Regex::new(r"(?i)invalid|empty").unwrap();
        for source in [
            json!({ "name": "image.png", "bytes": "not bytes" }),
            json!({ "name": "../image.png", "bytes": js::uint8array(&[1]) }),
            json!({ "name": "image.png", "bytes": js::uint8array(&[]) }),
        ] {
            let failure = store
                .stage(&with(&base, "sources", json!([source])))
                .await
                .unwrap_err();
            assert!(rejected.is_match(&failure.message));
        }
        let large = vec![0u8; limits::MAX_REFERENCE_BYTES as usize + 1];
        let oversized = store
            .stage(&with(
                &base,
                "sources",
                json!([{ "name": "large.png", "bytes": js::uint8array(&large) }]),
            ))
            .await
            .unwrap_err();
        assert!(oversized.message.contains("25 MB"));
        let fake = store
            .stage(&with(
                &base,
                "sources",
                json!([{ "name": "fake.png", "bytes": js::uint8array(&[1, 2, 3]) }]),
            ))
            .await
            .unwrap();
        assert_eq!(fake[0]["mime"], "application/octet-stream");
        store.close().await;
    });
}

#[test]
fn revokes_one_roots_grants_without_touching_sibling_root_attachments() {
    run_local(async {
        let root = root();
        let source = root.path().join("note.txt");
        std::fs::write(&source, "note").unwrap();
        let store = store_at(&root.path().join("staging"));
        let a = request(7, "/workspace-a", "draft-a");
        let b = request(7, "/workspace-b", "draft-b");
        let paths = json!([text(&source)]);
        let first = store
            .stage(&with(&a, "sourcePaths", paths.clone()))
            .await
            .unwrap()
            .remove(0);
        let second = store
            .stage(&with(&b, "sourcePaths", paths))
            .await
            .unwrap()
            .remove(0);
        store.revoke_workspace(7, "/workspace-a").unwrap();
        assert!(
            store
                .authorize(&with(&a, "references", json!([first])))
                .await
                .is_err()
        );
        assert_eq!(
            store
                .authorize(&with(&b, "references", json!([second])))
                .await
                .unwrap()
                .len(),
            1
        );
        store.close().await;
    });
}

#[test]
fn creates_an_immutable_private_snapshot_and_binds_its_opaque_grant_to_owner_workspace_and_epoch() {
    run_local(async {
        let root = root();
        let workspace = tempfile::tempdir().unwrap();
        let source = root.path().join("photo.png");
        let mut original = PNG.to_vec();
        original.extend_from_slice(b"original");
        std::fs::write(&source, &original).unwrap();
        let store = store_at(&root.path().join("staging"));
        let base = request(7, &text(workspace.path()), "draft-a");
        let paths = json!([text(&source)]);
        let draft = store
            .stage(&with(&base, "sourcePaths", paths.clone()))
            .await
            .unwrap()
            .remove(0);
        assert_eq!(draft["kind"], "staged-attachment");
        assert_eq!(draft["displayName"], "photo.png");
        assert_eq!(draft["mime"], "image/png");
        assert!(
            regex::Regex::new(r"^[A-Za-z0-9_-]{32,}$")
                .unwrap()
                .is_match(draft["token"].as_str().unwrap())
        );
        assert!(draft.get("path").is_none());
        assert!(!draft.to_string().contains(&text(&source)));
        let duplicate = store
            .stage(&with(&base, "sourcePaths", paths))
            .await
            .unwrap()
            .remove(0);
        assert_eq!(duplicate, draft);
        std::fs::write(&source, "changed after staging").unwrap();
        let references = json!([draft]);
        for wrong in [
            with(&base, "ownerId", json!(8)),
            with(
                &base,
                "workspaceRoot",
                json!(format!("{}-other", text(workspace.path()))),
            ),
            with(&base, "epoch", json!("draft-b")),
        ] {
            assert!(
                store
                    .authorize(&with(&wrong, "references", references.clone()))
                    .await
                    .is_err()
            );
        }
        let authorized = store
            .authorize(&with(&base, "references", references))
            .await
            .unwrap()
            .remove(0);
        let path = PathBuf::from(authorized["path"].as_str().unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        store.close().await;
    });
}

#[test]
fn rejects_symlinks_directories_oversized_files_and_mime_extension_disagreement() {
    run_local(async {
        let root = root();
        let workspace = tempfile::tempdir().unwrap();
        let regular = root.path().join("plain.txt");
        let link = root.path().join("link.txt");
        let directory = root.path().join("folder");
        let oversized = root.path().join("oversized.bin");
        let fake = root.path().join("fake.png");
        std::fs::write(&regular, "text").unwrap();
        std::os::unix::fs::symlink(&regular, &link).unwrap();
        std::fs::create_dir(&directory).unwrap();
        std::fs::File::create(&oversized)
            .unwrap()
            .set_len(limits::MAX_REFERENCE_BYTES + 1)
            .unwrap();
        std::fs::write(&fake, "not a png").unwrap();
        let store = store_at(&root.path().join("staging"));
        let base = request(1, &text(workspace.path()), "draft");
        let staged = |path: &Path| with(&base, "sourcePaths", json!([text(path)]));
        assert!(
            store
                .stage(&staged(&link))
                .await
                .unwrap_err()
                .message
                .contains("non-symbolic-link")
        );
        assert!(
            store
                .stage(&staged(&directory))
                .await
                .unwrap_err()
                .message
                .contains("regular")
        );
        assert!(
            store
                .stage(&staged(&oversized))
                .await
                .unwrap_err()
                .message
                .contains("25 MB")
        );
        assert_eq!(
            store.stage(&staged(&fake)).await.unwrap()[0]["mime"],
            "application/octet-stream"
        );
        store.close().await;
    });
}

#[test]
fn preserves_plain_text_and_svg_semantics_for_harness_specific_admission() {
    run_local(async {
        let root = root();
        let workspace = tempfile::tempdir().unwrap();
        let markdown = root.path().join("README.md");
        let source = root.path().join("app.ts");
        let svg = root.path().join("logo.svg");
        std::fs::write(&markdown, "# Read me").unwrap();
        std::fs::write(&source, "export const value = 1;").unwrap();
        std::fs::write(&svg, "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>").unwrap();
        let store = store_at(&root.path().join("staging"));
        let staged = store
            .stage(&with(
                &request(9, &text(workspace.path()), "text-draft"),
                "sourcePaths",
                json!([text(&markdown), text(&source), text(&svg)]),
            ))
            .await
            .unwrap();
        let shapes: Vec<(String, String)> = staged
            .iter()
            .map(|d| {
                (
                    d["displayName"].as_str().unwrap().into(),
                    d["mime"].as_str().unwrap().into(),
                )
            })
            .collect();
        assert_eq!(
            shapes,
            [
                ("README.md".to_string(), "text/markdown".to_string()),
                ("app.ts".into(), "text/typescript".into()),
                ("logo.svg".into(), "image/svg+xml".into()),
            ]
        );
        store.close().await;
    });
}

#[test]
fn enforces_aggregate_count_and_byte_budgets_across_separate_staging_calls() {
    run_local(async {
        let root = root();
        let workspace = tempfile::tempdir().unwrap();
        let sources: Vec<String> = (0..=limits::MAX_REFERENCES)
            .map(|index| {
                let source = root.path().join(format!("file-{index}.txt"));
                std::fs::write(&source, format!("value-{index}")).unwrap();
                text(&source)
            })
            .collect();
        let count_store = store_at(&root.path().join("count-staging"));
        let base = request(2, &text(workspace.path()), "count-draft");
        count_store
            .stage(&with(
                &base,
                "sourcePaths",
                json!(sources[..limits::MAX_REFERENCES]),
            ))
            .await
            .unwrap();
        let over = count_store
            .stage(&with(
                &base,
                "sourcePaths",
                json!([sources.last().unwrap()]),
            ))
            .await
            .unwrap_err();
        assert!(over.message.contains("32-file"));
        let full = root.path().join("full.bin");
        let extra = root.path().join("extra.bin");
        std::fs::File::create(&full)
            .unwrap()
            .set_len(limits::MAX_TOTAL_REFERENCE_BYTES)
            .unwrap();
        std::fs::write(&extra, "x").unwrap();
        let byte_store = store_at(&root.path().join("byte-staging"));
        let bytes = request(3, &text(workspace.path()), "byte-draft");
        byte_store
            .stage(&with(&bytes, "sourcePaths", json!([text(&full)])))
            .await
            .unwrap();
        let total = byte_store
            .stage(&with(&bytes, "sourcePaths", json!([text(&extra)])))
            .await
            .unwrap_err();
        assert!(total.message.contains("25 MB total"));
        count_store.close().await;
        byte_store.close().await;
    });
}

#[test]
fn detects_a_source_toctou_change_and_rolls_a_partial_batch_back_transactionally() {
    run_local(async {
        let root = root();
        let workspace = tempfile::tempdir().unwrap();
        let source = root.path().join("moving.txt");
        let invalid = root.path().join("folder");
        std::fs::write(&source, "snapshot").unwrap();
        std::fs::create_dir(&invalid).unwrap();
        let calls = Rc::new(Cell::new(0));
        let counter = calls.clone();
        let store = AgentAttachmentStore::new(AttachmentStoreOptions {
            root_path: root.path().join("staging"),
            source_stat: Some(Rc::new(move |file: &std::fs::File| {
                let mut snapshot = FileSnapshot::of(&file.metadata()?);
                counter.set(counter.get() + 1);
                if counter.get() > 1 {
                    snapshot.size += 1;
                }
                Ok(snapshot)
            })),
            ..Default::default()
        })
        .unwrap();
        let base = request(1, &text(workspace.path()), "draft");
        let changed = store
            .stage(&with(&base, "sourcePaths", json!([text(&source)])))
            .await
            .unwrap_err();
        assert!(changed.message.contains("changed"));
        let normal = store_at(&root.path().join("transactional"));
        let partial = normal
            .stage(&with(
                &base,
                "sourcePaths",
                json!([text(&source), text(&invalid)]),
            ))
            .await
            .unwrap_err();
        assert!(partial.message.contains("regular"));
        let directories = entries(&root.path().join("transactional"));
        assert!(entries(&root.path().join("transactional").join(&directories[0])).is_empty());
        store.close().await;
        normal.close().await;
    });
}

#[test]
fn expires_revokes_and_sweeps_snapshots_without_relying_on_renderer_cleanup() {
    run_local(async {
        let root = root();
        let workspace = tempfile::tempdir().unwrap();
        let source = root.path().join("note.txt");
        let staging = root.path().join("staging");
        let orphan = staging.join("old-process");
        std::fs::write(&source, "note").unwrap();
        std::fs::create_dir_all(&orphan).unwrap();
        std::fs::write(orphan.join("leak.snapshot"), "old").unwrap();
        std::fs::File::open(&orphan)
            .unwrap()
            .set_modified(std::time::UNIX_EPOCH)
            .unwrap();
        let clock = Rc::new(Cell::new(limits::DEFAULT_TTL_MS + 1));
        let now = clock.clone();
        let store = AgentAttachmentStore::new(AttachmentStoreOptions {
            root_path: staging,
            now: Some(Rc::new(move || now.get())),
            ..Default::default()
        })
        .unwrap();
        store.initialize().await.unwrap();
        assert!(!orphan.exists());
        let ws = text(workspace.path());
        let paths = json!([text(&source)]);

        let base = request(3, &ws, "draft");
        let draft = store
            .stage(&with(&base, "sourcePaths", paths.clone()))
            .await
            .unwrap()
            .remove(0);
        let authorized = store
            .authorize(&with(&base, "references", json!([draft])))
            .await
            .unwrap()
            .remove(0);
        store
            .revoke(&with(&base, "tokens", json!([draft["token"]])))
            .unwrap();
        assert!(!Path::new(authorized["path"].as_str().unwrap()).exists());
        assert!(
            store
                .authorize(&with(&base, "references", json!([draft])))
                .await
                .is_err()
        );

        let expiring = store
            .stage(&with(&base, "sourcePaths", paths.clone()))
            .await
            .unwrap()
            .remove(0);
        clock.set(clock.get() + limits::DEFAULT_TTL_MS + 1);
        assert!(
            store
                .authorize(&with(&base, "references", json!([expiring])))
                .await
                .is_err()
        );

        let leased_base = request(4, &ws, "leased-draft");
        let leased = store
            .stage(&with(&leased_base, "sourcePaths", paths.clone()))
            .await
            .unwrap()
            .remove(0);
        let leased_input = store
            .authorize(&with(&leased_base, "references", json!([leased])))
            .await
            .unwrap()
            .remove(0);
        let leased_tokens = with(&leased_base, "tokens", json!([leased["token"]]));
        store
            .lease(&with(&leased_tokens, "leaseId", json!("lease-test")))
            .await
            .unwrap();
        assert_eq!(
            store.revoke(&leased_tokens).unwrap(),
            json!({ "revoked": 0 })
        );
        clock.set(clock.get() + limits::DEFAULT_TTL_MS + 1);
        store.sweep_expired().await;
        let leased_path = PathBuf::from(leased_input["path"].as_str().unwrap());
        assert!(leased_path.exists());
        store
            .release_lease(&with(&leased_tokens, "leaseId", json!("lease-test")))
            .unwrap();
        clock.set(clock.get() + limits::DEFAULT_TTL_MS + 1);
        store.sweep_expired().await;
        assert!(!leased_path.exists());

        let terminal_base = request(5, &ws, "terminal-draft");
        let terminal = store
            .stage(&with(&terminal_base, "sourcePaths", paths))
            .await
            .unwrap()
            .remove(0);
        let terminal_input = store
            .authorize(&with(&terminal_base, "references", json!([terminal])))
            .await
            .unwrap()
            .remove(0);
        let terminal_tokens = with(&terminal_base, "tokens", json!([terminal["token"]]));
        store
            .lease(&with(&terminal_tokens, "leaseId", json!("terminal-lease")))
            .await
            .unwrap();
        assert_eq!(
            store.revoke_leased(&terminal_tokens).unwrap(),
            json!({ "revoked": 1 })
        );
        assert!(!Path::new(terminal_input["path"].as_str().unwrap()).exists());
        store.close().await;
    });
}

// ---------------------------------------------------------------------------
// Agent attachment and context authorization.

fn canonical(path: &Path) -> String {
    text(&std::fs::canonicalize(path).unwrap())
}

#[test]
fn canonicalizes_workspace_files_deduplicates_them_and_derives_renderer_independent_metadata() {
    run_local(async {
        let root = root();
        let filename = root.path().join("notes.md");
        std::fs::write(&filename, "hello").unwrap();
        let mut budget = ReferenceBudget::default();
        let result = authorize_agent_references(
            &text(root.path()),
            &[json!({ "path": text(&filename) }), json!(text(&filename))],
            &mut budget,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.len(), 1);
        let entry = &result[0];
        for (key, value) in [
            ("authorized", json!(true)),
            ("kind", json!("workspace-entry")),
            ("entryType", json!("file")),
            ("path", json!(canonical(&filename))),
            ("relativePath", json!("notes.md")),
            ("displayName", json!("notes.md")),
            ("name", json!("notes.md")),
            ("mime", json!("text/markdown")),
            ("size", json!(5)),
            ("status", json!("ready")),
        ] {
            assert_eq!(entry[key], value, "{key}");
        }
        assert!(entry.get("snapshotUrl").is_none());
        assert_eq!(reference_limits::MAX_REFERENCES, 32);
        assert_eq!(
            reference_limits::MAX_TOTAL_REFERENCE_BYTES,
            25 * 1024 * 1024
        );
    });
}

#[test]
fn resolves_relative_workspace_paths_but_fails_closed_for_symlinks_escaping_the_workspace() {
    run_local(async {
        let root = root();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.txt");
        let link = root.path().join("escape.txt");
        std::fs::write(&secret, "secret").unwrap();
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        std::fs::write(root.path().join("relative.txt"), "inside").unwrap();
        let mut budget = ReferenceBudget::default();
        let relative = authorize_agent_references(
            &text(root.path()),
            &[json!({ "path": "relative.txt" })],
            &mut budget,
            None,
        )
        .await
        .unwrap();
        assert_eq!(relative[0]["relativePath"], "relative.txt");
        assert_eq!(relative[0]["entryType"], "file");
        let escaped = authorize_agent_references(
            &text(root.path()),
            &[json!({ "path": text(&link) })],
            &mut budget,
            None,
        )
        .await
        .unwrap_err();
        assert!(escaped.message.contains("inside the assigned workspace"));
    });
}

#[test]
fn authorizes_directory_identity_without_recursively_reading_its_contents() {
    run_local(async {
        let root = root();
        std::fs::create_dir(root.path().join("src")).unwrap();
        std::fs::write(root.path().join("src/secret.txt"), "not snapshotted").unwrap();
        let mut budget = ReferenceBudget::default();
        let result =
            authorize_agent_references(&text(root.path()), &[json!("src")], &mut budget, None)
                .await
                .unwrap();
        assert_eq!(result[0]["kind"], "workspace-entry");
        assert_eq!(result[0]["entryType"], "directory");
        assert_eq!(result[0]["relativePath"], "src");
        assert_eq!(result[0]["size"], 0);
    });
}

#[test]
fn keeps_workspace_identity_portable_across_session_roots_and_withholds_absolute_paths_from_renderer_drafts()
 {
    run_local(async {
        let (first_root, second_root) = (root(), root());
        for (root, content) in [(&first_root, "first"), (&second_root, "second")] {
            std::fs::create_dir(root.path().join("docs")).unwrap();
            std::fs::write(root.path().join("docs/notes.md"), content).unwrap();
        }
        let reference = json!({ "relativePath": "docs/notes.md", "entryType": "file" });
        let mut budget = ReferenceBudget::default();
        let first = authorize_agent_references(
            &text(first_root.path()),
            std::slice::from_ref(&reference),
            &mut budget,
            None,
        )
        .await
        .unwrap()
        .remove(0);
        let second =
            authorize_agent_references(&text(second_root.path()), &[reference], &mut budget, None)
                .await
                .unwrap()
                .remove(0);
        assert_eq!(first["id"], second["id"]);
        assert_ne!(first["path"], second["path"]);
        let draft = workspace_draft_references(std::slice::from_ref(&first)).remove(0);
        assert_eq!(draft["id"], first["id"]);
        assert_eq!(draft["relativePath"], "docs/notes.md");
        assert_eq!(draft["displayName"], "notes.md");
        assert!(draft.get("path").is_none());
    });
}

#[test]
fn rejects_forged_absolute_and_traversal_identities_before_filesystem_authorization() {
    run_local(async {
        let root = root();
        for forged in [
            "../outside.md",
            "/private/outside.md",
            "C:private\\outside.md",
        ] {
            let mut budget = ReferenceBudget::default();
            let failure = authorize_agent_references(
                &text(root.path()),
                &[json!({ "relativePath": forged, "entryType": "file" })],
                &mut budget,
                None,
            )
            .await
            .unwrap_err();
            assert!(
                failure.message.contains("workspace-relative identity"),
                "{forged}"
            );
        }
    });
}

#[test]
fn shares_one_byte_and_file_count_budget_across_attachments_and_context() {
    run_local(async {
        let root = root();
        let attachment = root.path().join("image.png");
        let context = root.path().join("context.md");
        std::fs::write(&attachment, "image").unwrap();
        std::fs::write(&context, "context").unwrap();
        let mut budget = ReferenceBudget::default();
        authorize_agent_references(
            &text(root.path()),
            &[json!(text(&attachment))],
            &mut budget,
            None,
        )
        .await
        .unwrap();
        authorize_agent_references(
            &text(root.path()),
            &[json!(text(&context))],
            &mut budget,
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            budget,
            ReferenceBudget {
                remaining_bytes: reference_limits::MAX_TOTAL_REFERENCE_BYTES - 12,
                remaining_references: reference_limits::MAX_REFERENCES - 2,
            }
        );
    });
}
