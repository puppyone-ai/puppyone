use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn disconnected_host_events_settle_scanning_as_failed(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let (host, _actual_events) = Host::with_factory(super::fixtures::service);
    let (sender, events) = tokio::sync::mpsc::unbounded_channel();
    let store = cx.update(|cx| install(host, events, cx));
    assert!(store.read_with(cx, |s, _| s.scanning));
    drop(sender);
    cx.run_until_parked();
    store.read_with(cx, |s, _| {
        assert!(
            !s.scanning,
            "a closed host cannot produce a future completion"
        );
        assert!(s.failed);
        assert!(s.inventory().observations.is_empty());
    });
    cx.update(App::shutdown);
}
