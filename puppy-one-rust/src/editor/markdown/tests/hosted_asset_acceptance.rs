//! Hosted documents' absolute asset URLs (`markdownAssetPolicy.test.ts` #0;
//! gap `hosted-absolute-asset-urls`): in a Cloud project, an authored
//! `puppyone-cloud:` URL inside the document's own account/project/scope
//! root loads the same workspace file a relative reference does, from a
//! Markdown image, an HTML block and an inline HTML run. Another root, a URL
//! that leaves the root and a token query never reach the asset broker.
use super::setup_with_focus;
use crate::editor::{
    markdown::SetAssets,
    registry::DocumentAssets,
    view::extension::{SetReadOnly, config_transaction},
};
use gpui::TestAppContext;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// The shape of a Cloud workspace's root identity.
const ROOT: &str = "puppyone-cloud://cloud.example/https/api/v1/owner/project/root/";

fn source() -> String {
    let sibling = ROOT.trim_end_matches('/');
    [
        format!("![in]({ROOT}assets/a.png)"),
        "![relative](../assets/r.png)".to_owned(),
        format!("![token]({ROOT}assets/t.png?token=secret)"),
        format!("![sibling]({sibling}-other/s.png)"),
        format!("![above]({ROOT}../x.png)"),
        "![host](puppyone-cloud://other.example/https/api/v1/owner/project/root/h.png)".to_owned(),
        String::new(),
        format!("<img src=\"{ROOT}assets/block.png\" alt=\"block\">"),
        String::new(),
        format!("Inline <img src=\"{ROOT}assets/run.png\" alt=\"run\"> image."),
    ]
    .join("\n")
}

/// The workspace paths the asset broker is asked for when `source` shows in
/// `notes/doc.md` of the workspace `root`.
fn reads(cx: &mut TestAppContext, root: &str) -> Vec<PathBuf> {
    cx.executor().allow_parking();
    let (view, visual) = setup_with_focus(cx, &source(), false);
    let log = Arc::new(Mutex::new(Vec::new()));
    let observed = log.clone();
    let media = DocumentAssets {
        workspace: root.into(),
        document: "notes/doc.md".into(),
        read: Arc::new(move |path: &Path| {
            observed.lock().unwrap().push(path.to_path_buf());
            None
        }),
    };
    view.update_in(visual, |v, _, cx| {
        v.dispatch(config_transaction(SetAssets(Some(media))), cx);
        v.dispatch(config_transaction(SetReadOnly(true)), cx);
    });
    for _ in 0..4 {
        visual.run_until_parked();
        visual.update(|w, cx| w.draw(cx).clear(cx));
    }
    let mut reads = log.lock().unwrap().clone();
    reads.sort();
    reads.dedup();
    reads
}

#[gpui::test]
fn a_hosted_document_loads_absolute_assets_only_inside_its_own_root(cx: &mut TestAppContext) {
    let paths = |names: &[&str]| names.iter().map(PathBuf::from).collect::<Vec<_>>();
    assert_eq!(
        reads(cx, ROOT),
        paths(&[
            "assets/a.png",
            "assets/block.png",
            "assets/r.png",
            "assets/run.png",
        ])
    );
}

/// Control: a document in a workspace of another kind keeps refusing every
/// absolute `puppyone-cloud:` URL, while its relative reference loads.
#[gpui::test]
fn a_local_document_never_loads_an_absolute_hosted_url(cx: &mut TestAppContext) {
    assert_eq!(
        reads(cx, "workspace:local"),
        [PathBuf::from("assets/r.png")]
    );
}
