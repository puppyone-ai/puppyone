//! Host identity and document fallback must govern the real asset cache.
use super::setup_with_focus;
use crate::editor::{
    markdown::{MarkdownExtension, SetAssets, platform::assets, shared::media::MediaSource},
    registry::DocumentAssets,
    view::extension::config_transaction,
};
use gpui::TestAppContext;
use std::{
    io::Cursor,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[gpui::test]
fn document_media_preserves_host_identity_and_separates_unnamed_document_scopes(
    cx: &mut TestAppContext,
) {
    let source = "prefix ![alt](shared.png)\n\nafter";
    for (mode, workspace, expected_scopes) in [
        (
            "explicit",
            "workspace:acme",
            ["workspace:acme", "workspace:acme"],
        ),
        ("fallback", "", ["doc:notes/one.md", "doc:notes/two.md"]),
    ] {
        let reads = Arc::new(Mutex::new(Vec::new()));
        let (view, visual) = setup_with_focus(cx, source, false);
        let mut capabilities = Vec::new();
        let target = MediaSource::Workspace(PathBuf::from("notes/shared.png"));
        for (index, document) in ["notes/one.md", "notes/two.md"].iter().enumerate() {
            let size = if mode == "explicit" {
                24
            } else {
                32 + index as u32 * 16
            };
            let mut png = Cursor::new(Vec::new());
            image::DynamicImage::new_rgba8(size, 12)
                .write_to(&mut png, image::ImageFormat::Png)
                .unwrap();
            let png = png.into_inner();
            let observed = reads.clone();
            let media = DocumentAssets {
                workspace: workspace.into(),
                document: document.into(),
                read: Arc::new(move |path| {
                    observed.lock().unwrap().push((index, path.to_path_buf()));
                    Some(png.clone())
                }),
            };
            capabilities.push(media.clone());
            assert_eq!(
                assets::resolve_key(&target, Some(&media))
                    .unwrap()
                    .workspace_id,
                expected_scopes[index]
            );
            assert_eq!(
                target.key(Some(&media)),
                format!("workspace:{}:notes/shared.png", expected_scopes[index])
            );
            view.update(visual, |v, cx| {
                v.dispatch(config_transaction(SetAssets(Some(media))), cx)
            });
            for _ in 0..3 {
                visual.run_until_parked();
                visual.update(|w, cx| w.draw(cx).clear(cx));
            }
            let painted = visual
                .debug_bounds("editor-inline-image")
                .expect("document image ready");
            assert_eq!(
                f32::from(painted.size.width),
                size as f32,
                "document capability must not inherit another document's bitmap"
            );
            view.read_with(visual, |v, _| {
                let capability = v
                    .extension::<MarkdownExtension>()
                    .unwrap()
                    .assets
                    .as_ref()
                    .unwrap();
                assert_eq!(capability.workspace, workspace);
                assert_eq!(capability.document, PathBuf::from(document));
                assert_eq!(v.text(), source);
                assert_eq!(v.state().revision, 0);
            });
        }
        let expected = if mode == "explicit" {
            vec![(0, PathBuf::from("notes/shared.png"))]
        } else {
            vec![
                (0, PathBuf::from("notes/shared.png")),
                (1, PathBuf::from("notes/shared.png")),
            ]
        };
        assert_eq!(*reads.lock().unwrap(), expected);
        if mode == "fallback" {
            let second_key = assets::resolve_key(&target, Some(&capabilities[1])).unwrap();
            visual.update(|_, cx| assets::retry(&target, Some(&capabilities[0]), cx));
            for _ in 0..3 {
                visual.run_until_parked();
                visual.update(|w, cx| w.draw(cx).clear(cx));
            }
            assert_eq!(
                assets::resolve_key(&target, Some(&capabilities[1])).unwrap(),
                second_key
            );
            assert_eq!(
                *reads.lock().unwrap(),
                expected,
                "retrying the first document keeps the second cached"
            );
            view.update(visual, |v, cx| {
                v.dispatch(
                    config_transaction(SetAssets(Some(capabilities[0].clone()))),
                    cx,
                )
            });
            for _ in 0..3 {
                visual.run_until_parked();
                visual.update(|w, cx| w.draw(cx).clear(cx));
            }
            assert_eq!(
                f32::from(
                    visual
                        .debug_bounds("editor-inline-image")
                        .unwrap()
                        .size
                        .width
                ),
                32.
            );
            let mut reread = expected;
            reread.push((0, PathBuf::from("notes/shared.png")));
            assert_eq!(
                *reads.lock().unwrap(),
                reread,
                "only the retried document reloads"
            );
        }
    }
}

#[test]
fn document_asset_identity_preserves_host_values_and_trims_only_the_fallback_path() {
    for (workspace, document, expected) in [
        (" workspace:host ", " note.md ", " workspace:host "),
        ("/workspace/root", "note.md", "/workspace/root"),
        ("", "  notes/中文.md \n", "doc:notes/中文.md"),
        ("", "", "workspace:anonymous"),
        ("", " \t\n", "workspace:anonymous"),
    ] {
        let capability = DocumentAssets {
            workspace: workspace.into(),
            document: document.into(),
            read: Arc::new(|_| panic!("identity must not read document assets")),
        };
        assert_eq!(capability.workspace_identity(), expected);
        assert_eq!(capability.workspace, workspace);
        assert_eq!(capability.document, PathBuf::from(document));
    }
}
