#![cfg(test)]
use super::*;
use core::prelude::v1::test;

#[test]
fn office_admission_grants_a_private_snapshot_without_sibling_file_access() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("report.docx"), b"document").unwrap();
    std::fs::write(dir.path().join("private.txt"), b"not granted").unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("report.docx")).unwrap();
    let served = OfficeInput {
        name: "report.docx".into(),
        extension: "docx".into(),
        resource: Some(resource),
    }
    .serve(&AtomicBool::new(false));
    assert!(served.file_error.is_none());
    assert_ne!(
        served.root.as_deref(),
        Some(dir.path()),
        "Office must not grant the document's parent folder"
    );
    assert!(served.temporary.is_some());
    assert_eq!(
        std::fs::read(served.root.as_ref().unwrap().join("report.docx")).unwrap(),
        b"document"
    );
    assert!(!served.root.as_ref().unwrap().join("private.txt").exists());
}

fn input(resource: PreviewResource, name: &str) -> OfficeInput {
    OfficeInput {
        name: name.into(),
        extension: extension_of(name),
        resource: Some(resource),
    }
}
fn view(resource: PreviewResource) -> OfficeView {
    OfficeView {
        name: "report.docx".into(),
        extension: "docx".into(),
        dark: false,
        resource: Some(resource),
        frame: None,
        boot: serde_json::Value::Null,
        root: None,
        _served: None,
        _inbox: None,
        pending: None,
        load_epoch: 0,
        _loading: None,
    }
}

#[cfg(unix)]
#[test]
fn office_admission_uses_the_retained_provider_root_and_never_reopens_the_display_path() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("root");
    let kept = dir.path().join("kept");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("report.docx"), b"authorized snapshot").unwrap();
    let ws = crate::workspace::Workspace::open(&root).unwrap();
    let resource = ws.resource(Path::new("report.docx")).unwrap();
    std::fs::rename(&root, &kept).unwrap();
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("report.docx"), b"replacement root").unwrap();
    let served = input(resource.clone(), "report.docx").serve(&AtomicBool::new(false));
    assert_eq!(
        std::fs::read(served.root.unwrap().join("report.docx")).unwrap(),
        b"authorized snapshot"
    );
    std::fs::remove_file(kept.join("report.docx")).unwrap();
    std::os::unix::fs::symlink(root.join("report.docx"), kept.join("report.docx")).unwrap();
    let rejected = input(resource, "report.docx").serve(&AtomicBool::new(false));
    assert!(
        rejected.file_error.is_some() && rejected.root.is_none() && rejected.temporary.is_none()
    );
}

#[test]
fn office_admission_rejects_oversized_missing_revoked_and_precancelled_inputs_before_serving() {
    for case in ["oversized", "missing", "revoked", "cancelled"] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("report.docx");
        std::fs::write(&path, b"snapshot").unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(Path::new("report.docx")).unwrap();
        match case {
            "oversized" => std::fs::File::create(&path)
                .unwrap()
                .set_len(viewer_budget("office-preview") + 1)
                .unwrap(),
            "missing" => std::fs::remove_file(&path).unwrap(),
            "revoked" => ws.revoke(),
            _ => {}
        }
        let served = input(resource, "report.docx").serve(&AtomicBool::new(case == "cancelled"));
        assert!(
            served.root.is_none()
                && served.temporary.is_none()
                && served.file_url.is_none()
                && served.file_error.is_some(),
            "{case}"
        );
    }
    let provider = Arc::new(crate::workspace::testing::Resources::default());
    provider.bytes.lock().unwrap().insert(
        "report.docx".into(),
        vec![0; viewer_budget("office-preview") as usize + 1],
    );
    let ws = crate::workspace::Workspace::from_provider(provider).unwrap();
    assert!(
        input(
            ws.resource(Path::new("report.docx")).unwrap(),
            "report.docx"
        )
        .serve(&AtomicBool::new(false))
        .root
        .is_none()
    );
}

#[gpui::test]
fn office_private_protocol_serves_exact_bytes_ranges_and_retires_all_resources_with_the_lease(
    cx: &mut TestAppContext,
) {
    use crate::platform::webview::{entry_url, respond_request};
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("report.docx"), b"0123456789").unwrap();
    std::fs::write(dir.path().join("private.txt"), b"not granted").unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("report.docx")).unwrap();
    let view = cx.new(|cx| {
        let mut v = view(resource);
        v.load(cx);
        v
    });
    cx.run_until_parked();
    let (content, url, folder) = view.read_with(cx, |v, _| {
        (
            v.content(None).prepare(),
            v.boot["fileUrl"].as_str().unwrap().to_owned(),
            v.root.clone().unwrap(),
        )
    });
    let head = respond_request(&content, true, "HEAD", &url, None, None);
    assert_eq!(head.status, 200);
    assert_eq!(head.length, Some(10));
    assert!(head.body.is_empty());
    let part = respond_request(&content, true, "GET", &url, None, Some("bytes=2-4"));
    assert_eq!(part.status, 206);
    assert_eq!(part.body, b"234");
    assert_eq!(part.content_range.as_deref(), Some("bytes 2-4/10"));
    assert_eq!(
        respond_request(
            &content,
            true,
            "GET",
            &local_url_for("private.txt"),
            None,
            None
        )
        .status,
        404
    );
    std::fs::write(dir.path().join("report.docx"), b"new revision").unwrap();
    assert_eq!(
        respond_request(&content, true, "GET", &url, None, None).body,
        b"0123456789"
    );
    ws.revoke();
    for (local, url) in [
        (true, url),
        (false, entry_url()),
        (false, url_for("__assets__/office-viewer.js")),
    ] {
        for method in ["HEAD", "GET", "OPTIONS"] {
            assert_eq!(
                respond_request(&content, local, method, &url, None, None).status,
                403
            );
        }
    }
    view.update(cx, |v, cx| v.set_dark(true, cx));
    view.read_with(cx, |v, _| {
        assert!(v.root.is_none() && v.frame.is_none() && v._served.is_none())
    });
    assert!(!folder.exists());
}

#[gpui::test]
fn office_revocation_discards_a_completed_preparation_and_old_frame_ipc(cx: &mut TestAppContext) {
    use std::{cell::Cell, rc::Rc};
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("report.docx"), b"snapshot").unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("report.docx")).unwrap();
    let prepared = input(resource.clone(), "report.docx").serve(&AtomicBool::new(false));
    let folder = prepared.root.clone().unwrap();
    let view = cx.new(|_| view(resource));
    let (send, receive) = async_channel::bounded(1);
    view.update(cx, |v, cx| {
        v.start_load(cx, |_| async move { receive.recv().await.unwrap() })
    });
    cx.run_until_parked();
    let old_epoch = view.read_with(cx, |v, _| v.load_epoch);
    ws.revoke();
    send.try_send(prepared).unwrap();
    cx.run_until_parked();
    assert!(!folder.exists());
    view.read_with(cx, |v, _| {
        assert!(v.pending.is_none() && v.frame.is_none() && v.root.is_none())
    });
    let retries = Rc::new(Cell::new(0));
    let count = retries.clone();
    let _subscription = cx.update(|cx| {
        OfficeSurface { view: view.clone() }.subscribe(
            Rc::new(move |e, _| {
                if matches!(e, SurfaceEvent::RetryInput) {
                    count.set(count.get() + 1);
                }
            }),
            cx,
        )
    });
    view.update(cx, |v, cx| v.receive_for(old_epoch, Inbound::Retry, cx));
    assert_eq!(retries.get(), 0);
    let current = view.read_with(cx, |v, _| v.load_epoch);
    view.update(cx, |v, cx| v.receive_for(current, Inbound::Retry, cx));
    assert_eq!(retries.get(), 1);
}

#[gpui::test]
fn office_revocation_shows_native_retry_and_a_fresh_provider_can_recover(cx: &mut TestAppContext) {
    use std::{cell::Cell, rc::Rc};
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("report.docx"), b"snapshot").unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("report.docx")).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut v = view(resource);
        v.load(cx);
        v
    });
    cx.run_until_parked();
    let folder = view.read_with(cx, |v, _| v.root.clone().unwrap());
    let retries = Rc::new(Cell::new(0));
    let count = retries.clone();
    let _subscription = cx.update(|_, cx| {
        OfficeSurface { view: view.clone() }.subscribe(
            Rc::new(move |e, _| {
                if matches!(e, SurfaceEvent::RetryInput) {
                    count.set(count.get() + 1);
                }
            }),
            cx,
        )
    });
    ws.revoke();
    cx.update(|window, cx| {
        window.draw(cx).clear(cx);
    });
    let button = cx.debug_bounds("office-retry").unwrap();
    assert!(!folder.exists());
    cx.simulate_click(button.center(), Modifiers::none());
    cx.run_until_parked();
    assert_eq!(retries.get(), 1);
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("report.docx")).unwrap();
    cx.update(|_, cx| OfficeSurface { view: view.clone() }.rebind_resource(&resource, cx));
    cx.run_until_parked();
    view.read_with(cx, |v, _| {
        assert!(v.resource_is_live() && v.frame.is_some() && v.boot["fileError"].is_null());
        assert_eq!(
            std::fs::read(v.root.as_ref().unwrap().join("report.docx")).unwrap(),
            b"snapshot"
        );
    });
}
