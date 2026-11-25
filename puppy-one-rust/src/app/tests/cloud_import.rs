//! A drop into a hosted Project says how many files came in, once; a local
//! workspace keeps its quiet behaviour.
use super::*;
use crate::app::explorer::SessionEvent;
use core::prelude::v1::test;
use gpui::TestAppContext;
use std::time::Duration;

fn emit(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    imported: usize,
    failed: usize,
    cloud: bool,
) {
    let session = view.read_with(cx, |s, _| s.explorer.session.clone());
    session.update(cx, |_, cx| {
        cx.emit(SessionEvent::FilesImported {
            imported,
            failed,
            cloud,
        })
    });
    draw(cx);
}
fn added(n: usize) -> String {
    crate::localization::tf("native.cloudImport.added", &[("count", n.into())])
}
fn failed(n: usize) -> String {
    crate::localization::tf("native.cloudImport.failed", &[("count", n.into())])
}
fn shows(cx: &mut VisualTestContext, text: &str) -> bool {
    cx.debug_bounds(Box::leak(
        format!("floating-notice-message:{text}").into_boxed_str(),
    ))
    .is_some()
}
fn open_folder(view: &Entity<Shell>, cx: &mut VisualTestContext) -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), "a").unwrap();
    let root = temp.path().canonicalize().unwrap();
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.clone())))
    });
    settle_cloud(view, cx, "the folder", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
    });
    temp
}

#[gpui::test]
fn a_cloud_drop_shows_its_count_once_and_goes_after_four_seconds(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let _dir = open_folder(&view, cx);
    emit(&view, cx, 3, 0, true);
    assert!(shows(cx, &added(3)));
    cx.executor().advance_clock(Duration::from_millis(3900));
    draw(cx);
    assert!(shows(cx, &added(3)));
    cx.executor().advance_clock(Duration::from_millis(200));
    cx.run_until_parked();
    draw(cx);
    assert!(!shows(cx, &added(3)));
}

#[gpui::test]
fn a_partial_drop_says_what_could_not_be_added(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let _dir = open_folder(&view, cx);
    emit(&view, cx, 2, 1, true);
    assert!(shows(cx, &format!("{} {}", added(2), failed(1))));
    emit(&view, cx, 0, 2, true);
    assert!(shows(cx, &failed(2)));
}

#[gpui::test]
fn the_notice_waits_while_the_pointer_is_on_it(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let _dir = open_folder(&view, cx);
    emit(&view, cx, 1, 0, true);
    let cloud = view.read_with(cx, |s, _| s.cloud.clone());
    cloud.update(cx, |c, cx| c.import_notice_hover(true, cx));
    cx.executor().advance_clock(Duration::from_secs(5));
    cx.run_until_parked();
    draw(cx);
    assert!(shows(cx, &added(1)));
    cloud.update(cx, |c, cx| c.import_notice_hover(false, cx));
    draw(cx);
    assert!(!shows(cx, &added(1)));
}

#[gpui::test]
fn a_local_drop_shows_no_notice(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let _dir = open_folder(&view, cx);
    emit(&view, cx, 3, 1, false);
    assert!(!shows(cx, &added(3)));
    assert!(!shows(cx, &format!("{} {}", added(3), failed(1))));
}
