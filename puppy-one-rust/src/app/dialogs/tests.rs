use super::builtin::settings_size;
use super::*;
use core::prelude::v1::test;
#[test]
fn product_settings_geometry_is_bounded() {
    assert_eq!(settings_size(1280., 800.), (960., 736.));
    assert_eq!(settings_size(640., 480.), (576., 416.));
    assert_eq!(settings_size(1920., 1080.), (960., 760.));
}
#[gpui::test]
fn tasks_share_a_slot_errors_replace_each_other_and_owned_dialogs_close_by_key(
    cx: &mut gpui::TestAppContext,
) {
    // Settings reads the machine's agents on real workers.
    cx.executor().allow_parking();
    let preferences = cx.new(|_| PreferencesStore::memory());
    let (layer, cx) =
        cx.add_window_view(|w, cx| DialogLayer::new(preferences, "window".into(), w, cx));
    let kinds = |layer: &Entity<DialogLayer>, cx: &mut VisualTestContext| {
        layer.read_with(cx, |l, _| {
            l.iter()
                .map(|m| match m {
                    Modal::Task(task) => format!("{task:?}"),
                    Modal::ConfirmQuit => "ConfirmQuit".into(),
                    Modal::Error(error) => format!("Error({error})"),
                    Modal::Owned(o) => format!("{:?}", o.key),
                    _ => "Other".into(),
                })
                .collect::<Vec<_>>()
        })
    };
    layer.update(cx, |l, cx| {
        l.open(Modal::Task(Task::Settings), cx);
        l.open(Modal::ConfirmQuit, cx);
        l.open(Modal::Error("a".into()), cx);
        l.open(Modal::Task(Task::Feedback), cx);
        l.open(Modal::Error("b".into()), cx);
        l.open_owned(
            DialogKey::Rename,
            |_, _, _| div().into_any_element(),
            |_, _| {},
            cx,
        );
        l.open_owned(
            DialogKey::Rename,
            |_, _, _| div().into_any_element(),
            |_, _| {},
            cx,
        );
    });
    assert_eq!(
        kinds(&layer, cx),
        ["ConfirmQuit", "Feedback", "Error(b)", "Rename"]
    );
    layer.update(cx, |l, cx| {
        assert_eq!(l.task(), Some(Task::Feedback));
        assert!(l.close(DialogKey::Rename, cx));
        assert!(!l.contains(DialogKey::Rename));
        // The topmost match closes; the order of the rest is kept.
        assert!(l.remove(|m| matches!(m, Modal::Task(_)), cx).is_some());
    });
    assert_eq!(kinds(&layer, cx), ["ConfirmQuit", "Error(b)"]);
}
