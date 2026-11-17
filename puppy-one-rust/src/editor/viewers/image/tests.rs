use super::*;
use core::prelude::v1::test;
use std::{cell::Cell, path::Path, rc::Rc};

const PNG: &[u8] = include_bytes!("../../../../fixtures/editor/sample.png");
const AVIF: &[u8] = include_bytes!("../../../../fixtures/media/red.avif");
const SVG: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>"#;
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
fn preview(resource: PreviewResource, cx: &mut Context<ImagePreview>) -> ImagePreview {
    let mut view = ImagePreview::new(
        resource
            .identity
            .path
            .as_path()
            .to_string_lossy()
            .into_owned(),
        1.,
        cx,
    );
    view.resource = Some(resource);
    view
}
fn decoded(resource: &PreviewResource) -> DecodedMedia {
    decode_resource(
        resource,
        &resource.identity.path.as_path().to_string_lossy(),
        2048,
        &AtomicBool::new(false),
    )
    .unwrap()
}
fn bitmap(view: &ImagePreview) -> Arc<RenderImage> {
    match &view.media {
        Some(LoadedMedia::Bitmap(image)) => image.clone(),
        _ => panic!("no decoded bitmap"),
    }
}
fn draw(cx: &mut VisualTestContext) {
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

#[test]
fn local_images_cannot_bypass_the_source_budget() {
    let dir = tempfile::tempdir().unwrap();
    let name = "oversized.png";
    std::fs::File::create(dir.path().join(name))
        .unwrap()
        .set_len(source_budget() + 1)
        .unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new(name)).unwrap();
    assert!(source(&resource, name, &AtomicBool::new(false)).is_none());
    assert!(decode_resource(&resource, name, 2048, &AtomicBool::new(false)).is_err());
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
    assert_eq!(
        source(&resource, "image.png", &AtomicBool::new(false))
            .unwrap()
            .bytes,
        PNG
    );
    assert!(matches!(decoded(&resource), DecodedMedia::Bitmap(_)));
    std::fs::remove_file(kept.join("image.png")).unwrap();
    std::os::unix::fs::symlink(root.join("image.png"), kept.join("image.png")).unwrap();
    assert!(source(&resource, "image.png", &AtomicBool::new(false)).is_none());
}
#[test]
fn image_snapshots_use_registered_aliases_and_refuse_cancelled_or_revoked_reads() {
    for name in ["photo.APNG", "photo.pjpeg", "photo.ico", "photo.svg"] {
        let resource = snapshot(name, PNG);
        let admitted = source(&resource, name, &AtomicBool::new(false)).unwrap();
        assert_eq!(admitted.bytes, PNG);
        assert_eq!(admitted.svg, name.ends_with("svg"));
        assert!(source(&resource, name, &AtomicBool::new(true)).is_none());
    }
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("image.png"), PNG).unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("image.png")).unwrap();
    let admitted = source(&resource, "image.png", &AtomicBool::new(false)).unwrap();
    std::fs::write(dir.path().join("image.png"), b"later revision").unwrap();
    assert_eq!(admitted.bytes, PNG);
    ws.revoke();
    assert!(source(&resource, "image.png", &AtomicBool::new(false)).is_none());
}
#[cfg(target_os = "macos")]
#[gpui::test]
fn hosted_avif_decodes_again_when_the_provider_delivers_a_replacement(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let resource = snapshot("picture.avif", AVIF);
    let view = cx.new(|cx| preview(resource.clone(), cx));
    let mut previous = None;
    for _ in 0..2 {
        cx.update(|cx| ImageSurface { view: view.clone() }.rebind_resource(&resource, cx));
        assert!(view.read_with(cx, |v, _| v.pending.is_some()));
        cx.run_until_parked();
        let image = view.read_with(cx, |v, _| {
            assert!(v.pending.is_none());
            assert!(v.natural_size.0 > 0);
            bitmap(v)
        });
        if let Some(old) = previous {
            assert!(!Arc::ptr_eq(&old, &image));
        }
        previous = Some(image);
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
        let mut v = preview(resource.clone(), cx);
        v.load(Some(resource), cx);
        v
    });
    cx.run_until_parked();
    draw(cx);
    let old = view.read_with(cx, |v, _| bitmap(v));
    std::fs::write(
        &path,
        include_bytes!("../../../../fixtures/editor/broken.png"),
    )
    .unwrap();
    let replacement = ws.resource(Path::new("image.png")).unwrap();
    cx.update(|_, cx| ImageSurface { view: view.clone() }.rebind_resource(&replacement, cx));
    assert!(view.read_with(cx, |v, _| v.media.is_none()));
    cx.run_until_parked();
    draw(cx);
    view.read_with(cx, |v, _| {
        assert!(v.media.is_none() && v.failure.is_some());
        assert_eq!(v.resource.as_ref(), Some(&replacement));
    });
    assert!(cx.debug_bounds("image-retry").is_some());
    drop(old);
}
#[gpui::test]
fn a_late_avif_transcode_cannot_replace_the_new_png_resource(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let old = snapshot("old.avif", AVIF);
    let new = snapshot("new.png", PNG);
    let view = cx.new(|cx| preview(old, cx));
    let (send, receive) = async_channel::bounded(1);
    view.update(cx, |v, cx| {
        v.start_load(cx, |_| async move { receive.recv().await.unwrap() })
    });
    cx.run_until_parked();
    let cancel = view.read_with(cx, |v, _| v.pending.as_ref().unwrap().0.clone());
    send.try_send(Ok(decoded(&snapshot("old.svg", SVG))))
        .unwrap_or_else(|_| panic!("worker disappeared"));
    drop(send);
    cx.update(|cx| ImageSurface { view: view.clone() }.rebind_resource(&new, cx));
    assert!(cancel.load(Ordering::Acquire));
    cx.run_until_parked();
    view.read_with(cx, |v, _| {
        bitmap(v);
        assert_eq!(v.resource.as_ref(), Some(&new));
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
        std::fs::write(dir.path().join("image.svg"), SVG).unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(Path::new("image.svg")).unwrap();
        let payload = decoded(&resource);
        let (view, cx) = cx.add_window_view(|_, cx| preview(resource, cx));
        let (send, receive) = async_channel::bounded(1);
        view.update(cx, |v, cx| {
            v.start_load(cx, |_| async move { receive.recv().await.unwrap() })
        });
        cx.run_until_parked();
        if pending {
            ws.revoke();
        }
        send.try_send(Ok(payload))
            .unwrap_or_else(|_| panic!("worker disappeared"));
        cx.run_until_parked();
        let admitted = if !pending {
            draw(cx);
            let image = view.read_with(cx, |v, cx| match &v.media {
                Some(LoadedMedia::Svg(i)) => {
                    assert!(i.is_asset_cached(cx));
                    i.clone()
                }
                _ => panic!("missing SVG"),
            });
            ws.revoke();
            Some(image)
        } else {
            None
        };
        draw(cx);
        view.read_with(cx, |v, _| assert!(v.media.is_none() && v.pending.is_none()));
        assert!(cx.debug_bounds("image-retry").is_some());
        if let Some(image) = admitted {
            cx.update(|_, cx| assert!(!image.is_asset_cached(cx)));
        }
    }
}
#[gpui::test]
fn disposing_the_image_view_cancels_its_owned_worker_and_receiver(cx: &mut TestAppContext) {
    let view = cx.new(|cx| preview(snapshot("photo.png", PNG), cx));
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
    assert!(
        send.try_send(Err(DecodeError::Failed("closed".into())))
            .is_err()
    );
    cx.executor().allow_parking();
    let resource = snapshot("photo.svg", SVG);
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut v = preview(resource.clone(), cx);
        v.load(Some(resource), cx);
        v
    });
    cx.run_until_parked();
    draw(cx);
    let image = view.read_with(cx, |v, cx| match &v.media {
        Some(LoadedMedia::Svg(i)) => {
            assert!(i.is_asset_cached(cx));
            i.clone()
        }
        _ => panic!("missing SVG"),
    });
    let weak = view.downgrade();
    cx.update(|w, _| w.remove_window());
    drop(view);
    cx.cx.update(|_| {});
    cx.run_until_parked();
    assert!(weak.upgrade().is_none());
    cx.cx.update(|cx| assert!(!image.is_asset_cached(cx)));
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
        let mut v = preview(resource.clone(), cx);
        v.load(Some(resource), cx);
        v
    });
    let retries = Rc::new(Cell::new(0));
    let count = retries.clone();
    let _sub = cx.update(|_, cx| {
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
    draw(cx);
    let retry = cx.debug_bounds("image-retry").unwrap();
    cx.simulate_click(retry.center(), Modifiers::none());
    cx.run_until_parked();
    assert_eq!(retries.get(), 1);
    std::fs::write(&path, PNG).unwrap();
    let replacement = ws.resource(Path::new("image.png")).unwrap();
    cx.update(|_, cx| ImageSurface { view: view.clone() }.rebind_resource(&replacement, cx));
    cx.run_until_parked();
    draw(cx);
    assert!(cx.debug_bounds("image-retry").is_none());
    view.read_with(cx, |v, _| {
        bitmap(v);
    });
}
