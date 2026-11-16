use super::*;
use core::prelude::v1::test;
use std::{cell::Cell, path::Path, rc::Rc};

const PNG: &[u8] = include_bytes!("../../../../fixtures/editor/sample.png");
const AVIF: &[u8] = include_bytes!("../../../../fixtures/media/red.avif");
fn snapshot(name: &str, bytes: &[u8]) -> PreviewResource {
    let provider = Arc::new(crate::workspace::testing::Resources::default());
    provider
        .bytes
        .lock()
        .unwrap()
        .insert(name.into(), bytes.to_vec());
    crate::workspace::Workspace::from_provider(provider)
        .unwrap()
        .resource(Path::new(name))
        .unwrap()
}
fn owned_source(resource: &PreviewResource, name: &str) -> Arc<Image> {
    source(resource, name, &AtomicBool::new(false)).expect("admitted image snapshot")
}

#[test]
fn local_images_cannot_bypass_the_source_budget() {
    let dir = tempfile::tempdir().unwrap();
    let name = "oversized.png";
    let file = std::fs::File::create(dir.path().join(name)).unwrap();
    file.set_len(source_budget() + 1).unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new(name)).unwrap();
    assert!(source(&resource, name, &AtomicBool::new(false)).is_none());
    assert_eq!(source_budget(), 128 * 1024 * 1024);
}

#[cfg(unix)]
#[test]
fn image_reads_keep_provider_authority_after_root_replacement_and_reject_link_substitution() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("root");
    let kept = dir.path().join("kept");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("image.png"), PNG).unwrap();
    let ws = crate::workspace::Workspace::open(&root).unwrap();
    let resource = ws.resource(Path::new("image.png")).unwrap();
    std::fs::rename(&root, &kept).unwrap();
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("image.png"), b"wrong authority").unwrap();
    assert_eq!(owned_source(&resource, "image.png").bytes(), PNG);
    std::fs::remove_file(kept.join("image.png")).unwrap();
    std::os::unix::fs::symlink(root.join("image.png"), kept.join("image.png")).unwrap();
    assert!(source(&resource, "image.png", &AtomicBool::new(false)).is_none());
}

#[test]
fn image_snapshots_use_registered_aliases_and_refuse_cancelled_or_revoked_reads() {
    for (name, expected) in [
        ("photo.APNG", ImageFormat::Png),
        ("photo.pjpeg", ImageFormat::Jpeg),
        ("photo.ico", ImageFormat::Ico),
        ("photo.svg", ImageFormat::Svg),
    ] {
        let resource = snapshot(name, PNG);
        assert_eq!(owned_source(&resource, name).format(), expected);
        assert!(source(&resource, name, &AtomicBool::new(true)).is_none());
    }
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("image.png"), PNG).unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("image.png")).unwrap();
    let admitted = owned_source(&resource, "image.png");
    std::fs::write(dir.path().join("image.png"), b"later revision").unwrap();
    assert_eq!(admitted.bytes(), PNG);
    ws.revoke();
    assert!(source(&resource, "image.png", &AtomicBool::new(false)).is_none());
}

#[cfg(target_os = "macos")]
#[gpui::test]
fn hosted_avif_decodes_again_when_the_provider_delivers_a_replacement(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let resource = snapshot("picture.avif", AVIF);
    let view = cx.new(|cx| ImagePreview::new(Some(resource.clone()), cx));
    for _ in 0..2 {
        cx.update(|cx| {
            ImageSurface { view: view.clone() }.rebind_resource(&resource, cx);
            assert!(view.read(cx).pending.is_some());
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(view.pending.is_none());
            let Some(ImageSource::Image(image)) = &view.image else {
                panic!("no owned PNG")
            };
            assert_eq!(image.format(), ImageFormat::Png);
            assert!(image.bytes().starts_with(b"\x89PNG\r\n\x1a\n"));
        });
    }
}

#[gpui::test]
fn an_external_replacement_at_the_same_path_evicts_the_decoded_image(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("image.png");
    std::fs::write(&path, PNG).unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("image.png")).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut view = ImagePreview::new(Some(resource), cx);
        view.load("image.png", cx);
        view
    });
    cx.run_until_parked();
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    let old = view.read_with(cx, |view, cx| {
        let old = view.image.clone().unwrap();
        assert!(old.is_asset_cached(cx));
        old
    });
    let broken = include_bytes!("../../../../fixtures/editor/broken.png");
    std::fs::write(&path, broken).unwrap();
    let replacement = ws.resource(Path::new("image.png")).unwrap();
    cx.update(|_, cx| {
        ImageSurface { view: view.clone() }.rebind_resource(&replacement, cx);
        assert!(!old.is_asset_cached(cx));
        assert!(view.read(cx).image.is_none());
    });
    cx.run_until_parked();
    view.read_with(cx, |view, _| {
        let Some(ImageSource::Image(image)) = &view.image else {
            panic!("missing new snapshot")
        };
        assert_eq!(image.bytes(), broken);
    });
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    cx.run_until_parked();
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    assert!(
        cx.debug_bounds("image-retry").is_some(),
        "the real decoder must reject damaged bytes"
    );
}

#[gpui::test]
fn a_late_avif_transcode_cannot_replace_the_new_png_resource(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let old = snapshot("old.avif", AVIF);
    let new = snapshot("new.png", PNG);
    let view = cx.new(|cx| ImagePreview::new(Some(old), cx));
    let (send, receive) = async_channel::bounded(1);
    view.update(cx, |v, cx| {
        v.start_load(cx, |_| async move { receive.recv().await.unwrap() })
    });
    cx.run_until_parked();
    let cancelled = view.read_with(cx, |v, _| v.pending.as_ref().unwrap().0.clone());
    send.try_send(Some(Arc::new(Image::from_bytes(
        ImageFormat::Png,
        b"obsolete".to_vec(),
    ))))
    .unwrap();
    drop(send);
    cx.update(|cx| ImageSurface { view: view.clone() }.rebind_resource(&new, cx));
    assert!(cancelled.load(Ordering::Acquire));
    cx.run_until_parked();
    view.read_with(cx, |v, _| {
        let Some(ImageSource::Image(image)) = &v.image else {
            panic!("missing current snapshot")
        };
        assert_eq!(image.bytes(), PNG);
        assert_eq!(v.resource.as_ref().unwrap(), &new);
        assert!(v.pending.is_none());
    });
}

#[gpui::test]
fn revocation_discards_a_pending_image_and_retires_an_already_cached_image(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    for pending in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("image.png"), PNG).unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(Path::new("image.png")).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| ImagePreview::new(Some(resource), cx));
        let (send, receive) = async_channel::bounded(1);
        view.update(cx, |v, cx| {
            v.start_load(cx, |_| async move { receive.recv().await.unwrap() })
        });
        cx.run_until_parked();
        let payload = Arc::new(Image::from_bytes(ImageFormat::Png, PNG.to_vec()));
        if pending {
            ws.revoke();
        }
        send.try_send(Some(payload)).unwrap();
        cx.run_until_parked();
        if !pending {
            cx.update(|window, cx| {
                let _ = window.draw(cx);
            });
            assert!(view.read_with(cx, |v, cx| v.image.as_ref().unwrap().is_asset_cached(cx)));
            ws.revoke();
        }
        cx.update(|window, cx| {
            let _ = window.draw(cx);
        });
        view.read_with(cx, |v, _| assert!(v.image.is_none() && v.pending.is_none()));
        assert!(cx.debug_bounds("image-retry").is_some());
    }
}

#[gpui::test]
fn disposing_the_image_view_cancels_its_owned_worker_and_receiver(cx: &mut TestAppContext) {
    let view = cx.new(|cx| ImagePreview::new(Some(snapshot("photo.png", PNG)), cx));
    let (send, receive) = async_channel::bounded(1);
    let (tokens, token_receiver) = async_channel::bounded(1);
    view.update(cx, |v, cx| {
        v.start_load(cx, move |cancel| async move {
            tokens.send(cancel).await.unwrap();
            receive.recv().await.unwrap()
        })
    });
    cx.run_until_parked();
    let cancel = token_receiver.try_recv().unwrap();
    let weak = view.downgrade();
    assert!(!cancel.load(Ordering::Acquire));
    drop(view);
    cx.update(|_| {});
    cx.run_until_parked();
    assert!(weak.upgrade().is_none());
    assert!(cancel.load(Ordering::Acquire));
    assert!(send.try_send(None).is_err());

    cx.executor().allow_parking();
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut view = ImagePreview::new(Some(snapshot("photo.png", PNG)), cx);
        view.load("photo.png", cx);
        view
    });
    cx.run_until_parked();
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    let image = view.read_with(cx, |v, cx| {
        let image = v.image.clone().unwrap();
        assert!(image.is_asset_cached(cx));
        image
    });
    let weak = view.downgrade();
    cx.update(|window, _| window.remove_window());
    drop(view);
    cx.cx.update(|_| {});
    cx.run_until_parked();
    assert!(weak.upgrade().is_none());
    cx.cx.update(|cx| {
        assert!(
            !image.is_asset_cached(cx),
            "closed preview retained its decoded asset"
        )
    });
}

#[gpui::test]
fn image_retry_click_reacquires_input_and_loads_new_authorized_bytes(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("image.png");
    std::fs::write(&path, PNG).unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("image.png")).unwrap();
    std::fs::remove_file(&path).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut view = ImagePreview::new(Some(resource), cx);
        view.load("image.png", cx);
        view
    });
    let retries = Rc::new(Cell::new(0));
    let count = retries.clone();
    let _subscription = cx.update(|_, cx| {
        ImageSurface { view: view.clone() }.subscribe(
            Rc::new(move |event, _| {
                if matches!(event, SurfaceEvent::RetryInput) {
                    count.set(count.get() + 1);
                }
            }),
            cx,
        )
    });
    cx.run_until_parked();
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    let retry = cx.debug_bounds("image-retry").unwrap();
    cx.simulate_click(retry.center(), Modifiers::none());
    cx.run_until_parked();
    assert_eq!(retries.get(), 1);
    std::fs::write(&path, PNG).unwrap();
    let replacement = ws.resource(Path::new("image.png")).unwrap();
    cx.update(|_, cx| ImageSurface { view: view.clone() }.rebind_resource(&replacement, cx));
    cx.run_until_parked();
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    cx.run_until_parked();
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    assert!(cx.debug_bounds("image-retry").is_none());
    view.read_with(cx, |v, cx| {
        assert!(v.image.as_ref().unwrap().is_asset_cached(cx))
    });
}
