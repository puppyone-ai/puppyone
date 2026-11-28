use super::*;
use crate::platform::webview::{PreparedContent, ProtocolResponse, respond_request};
use core::prelude::v1::test;

fn prepared(source: &Source, budget: u64) -> PreparedContent {
    Content {
        root: None,
        source: Some(source.protocol.clone()),
        entry: Entry::Html("media entry".into()),
        max_bytes: budget,
        assets: vec![],
        ipc: None,
        policy: None,
        frames: None,
        disk_assets: None,
        locked: false,
    }
    .prepare()
}
fn request(
    content: &PreparedContent,
    name: &str,
    method: &str,
    range: Option<&str>,
) -> ProtocolResponse {
    respond_request(content, false, method, &url_for(name), None, range)
}
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

#[test]
fn media_pages_reference_the_served_file_with_controls() {
    let page = media_page(
        Kind::Video,
        "puppyone-preview://local/a%20b.mp4",
        "BG",
        "INSET",
        "No <video>",
    );
    assert!(page.contains(r#"<video controls preload="auto""#) && page.contains("a%20b.mp4"));
    assert!(page.contains("No &lt;video&gt;</video>"));
    assert!(page.contains(r#"postMessage("failed")"#));
    assert!(media_page(Kind::Audio, "x", "BG", "INSET", "").contains("<audio controls"));
    for (kind, name) in [(Kind::Audio, "sound.mp3"), (Kind::Video, "movie.mp4")] {
        assert_eq!(kind.budget(), crate::editor::registry::source_budget(name));
    }
}

#[cfg(unix)]
#[test]
fn media_ranges_keep_provider_directory_authority_and_never_grant_sibling_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("root");
    let kept = dir.path().join("kept");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("movie.mp4"), b"0123456789").unwrap();
    std::fs::write(root.join("private.txt"), b"private").unwrap();
    let ws = crate::workspace::Workspace::open(&root).unwrap();
    let resource = ws.resource(Path::new("movie.mp4")).unwrap();
    std::fs::rename(&root, &kept).unwrap();
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("movie.mp4"), b"replacement").unwrap();
    let source = source(&resource, "movie.mp4", Kind::Video.budget()).unwrap();
    let content = prepared(&source, Kind::Video.budget());
    assert!(content.root.is_none());
    let part = request(&content, "movie.mp4", "GET", Some("bytes=2-4"));
    assert_eq!(part.status, 206);
    assert_eq!(part.body, b"234");
    assert_eq!(part.mime, "video/mp4");
    assert_eq!(request(&content, "private.txt", "GET", None).status, 404);
    assert_eq!(request(&content, "../movie.mp4", "GET", None).status, 404);
    std::fs::remove_file(kept.join("movie.mp4")).unwrap();
    std::os::unix::fs::symlink(root.join("movie.mp4"), kept.join("movie.mp4")).unwrap();
    assert_eq!(request(&content, "movie.mp4", "GET", None).status, 404);
}

#[test]
fn media_manifest_limits_are_checked_before_reading_sparse_audio_or_video() {
    for (kind, name) in [(Kind::Audio, "sound.mp3"), (Kind::Video, "movie.mp4")] {
        let dir = tempfile::tempdir().unwrap();
        let file = std::fs::File::create(dir.path().join(name)).unwrap();
        file.set_len(kind.budget()).unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(Path::new(name)).unwrap();
        let source = source(&resource, name, kind.budget()).unwrap();
        let content = prepared(&source, kind.budget());
        let head = request(&content, name, "HEAD", None);
        assert_eq!(head.status, 200);
        assert_eq!(head.length, Some(kind.budget()));
        assert!(head.body.is_empty());
        let last = request(
            &content,
            name,
            "GET",
            Some(&format!("bytes={}-", kind.budget() - 1)),
        );
        assert_eq!(last.status, 206);
        assert_eq!(last.body, [0]);
        file.set_len(kind.budget() + 1).unwrap();
        assert_eq!(request(&content, name, "HEAD", None).status, 413);
        assert_eq!(
            request(&content, name, "GET", Some("bytes=0-0")).status,
            413
        );
    }
}

#[test]
fn hosted_media_keeps_the_acquired_snapshot_and_retired_sources_reject_cloned_protocols() {
    let resource = snapshot("a #片.mp3", b"old bytes");
    assert!(source(&resource, "a #片.mp3", 8).is_none());
    let owner = source(&resource, "a #片.mp3", 9).unwrap();
    let content = prepared(&owner, 9);
    assert_eq!(
        request(&content, "a #片.mp3", "GET", Some("bytes=-5")).body,
        b"bytes"
    );
    let replacement = snapshot("a #片.mp3", b"new bytes");
    let new_owner = source(&replacement, "a #片.mp3", 9).unwrap();
    let new_content = prepared(&new_owner, 9);
    assert_eq!(
        request(&content, "a #片.mp3", "GET", None).body,
        b"old bytes"
    );
    assert_eq!(
        request(&new_content, "a #片.mp3", "GET", None).body,
        b"new bytes"
    );
    drop(owner);
    assert_eq!(request(&content, "a #片.mp3", "GET", None).status, 403);
    assert_eq!(request(&content, "__entry__", "GET", None).status, 403);
    assert_eq!(request(&new_content, "a #片.mp3", "GET", None).status, 200);
}

#[test]
fn extensionless_media_preserves_the_provider_mime_without_copying_to_a_file() {
    use crate::workspace::{contracts::*, ports::*, testing::Resources};
    struct Typed(Resources);
    impl DataPort for Typed {
        fn descriptor(&self) -> Descriptor {
            self.0.descriptor()
        }
        fn list(&self, path: &RelativePath) -> Result<Vec<Entry>> {
            self.0.list(path)
        }
    }
    impl DocumentStoragePort for Typed {
        fn read(&self, _: &RelativePath) -> Result<TextSnapshot> {
            Err(Error::unsupported())
        }
        fn write(&self, _: &RelativePath, _: &Revision, _: &str) -> Result<WriteResult> {
            Err(Error::unsupported())
        }
    }
    impl ResourcePort for Typed {
        fn preview(&self, _: &RelativePath) -> Result<PreviewData> {
            Ok(PreviewData::Bytes {
                mime: "Audio/OGG; codecs=opus".into(),
                bytes: b"snapshot".to_vec().into(),
            })
        }
    }
    impl ResourceWatchPort for Typed {
        fn watch(&self, _: &RelativePath, _: &Revision, _: Notify) -> Result<WatchSubscription> {
            Err(Error::unsupported())
        }
    }
    let ws =
        crate::workspace::Workspace::from_provider(Arc::new(Typed(Resources::default()))).unwrap();
    let resource = ws.resource(Path::new("recording")).unwrap();
    let owner = source(&resource, "recording", 8).unwrap();
    let content = prepared(&owner, 8);
    let head = request(&content, "recording", "HEAD", None);
    assert_eq!(head.status, 200);
    assert_eq!(head.mime, "audio/ogg");
    assert_eq!(
        request(&content, "recording", "GET", None).body,
        b"snapshot"
    );
}

#[gpui::test]
fn media_rebinding_and_disposal_retire_protocols_and_ignore_old_frame_failures(
    cx: &mut TestAppContext,
) {
    let original = snapshot("sound.mp3", b"original");
    let replacement = snapshot("sound.mp3", b"replacement");
    let view = cx.new(|cx| {
        let mut v = MediaView::new("sound.mp3".into(), Kind::Audio, Some(original), false);
        v.load(cx);
        v
    });
    let old = view.read_with(cx, |v, cx| {
        v.content(v._source.as_ref().unwrap(), None, cx).prepare()
    });
    let epoch = view.read_with(cx, |v, _| v.generation);
    cx.update(|cx| MediaSurface { view: view.clone() }.rebind_resource(&replacement, cx));
    view.update(cx, |v, cx| v.receive_failure(epoch, cx));
    assert_eq!(request(&old, "sound.mp3", "GET", None).status, 403);
    let current = view.read_with(cx, |v, cx| {
        assert!(!v.failed && v.frame.is_some());
        v.content(v._source.as_ref().unwrap(), None, cx).prepare()
    });
    assert_eq!(
        request(&current, "sound.mp3", "GET", None).body,
        b"replacement"
    );
    let weak = view.downgrade();
    drop(view);
    cx.update(|_| {});
    cx.run_until_parked();
    assert!(weak.upgrade().is_none());
    assert_eq!(request(&current, "sound.mp3", "GET", None).status, 403);
}

#[gpui::test]
fn a_current_media_failure_retires_its_requests_and_retry_rebinds_a_fresh_source(
    cx: &mut TestAppContext,
) {
    use std::{cell::Cell, rc::Rc};
    let resource = snapshot("sound.mp3", b"snapshot");
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut v = MediaView::new(
            "sound.mp3".into(),
            Kind::Audio,
            Some(resource.clone()),
            false,
        );
        v.load(cx);
        v
    });
    let old = view.read_with(cx, |v, cx| {
        v.content(v._source.as_ref().unwrap(), None, cx).prepare()
    });
    let count = Rc::new(Cell::new(0));
    let received = count.clone();
    let _subscription = cx.update(|_, cx| {
        MediaSurface { view: view.clone() }.subscribe(
            Rc::new(move |e, _| {
                if matches!(e, SurfaceEvent::RetryInput) {
                    received.set(received.get() + 1);
                }
            }),
            cx,
        )
    });
    view.update(cx, |v, cx| v.receive_failure(v.generation, cx));
    cx.update(|window, cx| {
        window.draw(cx).clear(cx);
    });
    let retry = cx.debug_bounds("media-retry").unwrap();
    cx.simulate_click(retry.center(), Modifiers::none());
    cx.run_until_parked();
    assert_eq!(count.get(), 1);
    assert_eq!(request(&old, "sound.mp3", "GET", None).status, 403);
    cx.update(|_, cx| MediaSurface { view: view.clone() }.rebind_resource(&resource, cx));
    let current = view.read_with(cx, |v, cx| {
        assert!(!v.failed && v.frame.is_some());
        v.content(v._source.as_ref().unwrap(), None, cx).prepare()
    });
    assert_eq!(
        request(&current, "sound.mp3", "GET", None).body,
        b"snapshot"
    );
}

#[gpui::test]
fn revoked_media_clears_the_frame_and_exposes_native_retry(cx: &mut TestAppContext) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("movie.mp4"), b"snapshot").unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("movie.mp4")).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut v = MediaView::new("movie.mp4".into(), Kind::Video, Some(resource), false);
        v.load(cx);
        v
    });
    let content = view.read_with(cx, |v, cx| {
        v.content(v._source.as_ref().unwrap(), None, cx).prepare()
    });
    ws.revoke();
    assert_eq!(request(&content, "movie.mp4", "HEAD", None).status, 403);
    cx.update(|window, cx| {
        window.draw(cx).clear(cx);
    });
    assert!(cx.debug_bounds("media-retry").is_some());
    view.read_with(cx, |v, _| {
        assert!(v.failed && v.frame.is_none() && v._source.is_none())
    });
}
