#![cfg(test)]
use super::*;
use std::{
    io::{self, Read, Seek, SeekFrom},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
#[derive(Default)]
struct Counts {
    opens: usize,
    reads: usize,
    bytes: usize,
    drops: usize,
}
struct Provider {
    length: u64,
    physical: u64,
    wrong_seek: bool,
    revoke_during_read: bool,
    fail: Option<io::ErrorKind>,
    live: Arc<AtomicBool>,
    counts: Arc<Mutex<Counts>>,
}
impl Provider {
    fn new(length: u64) -> Self {
        Self {
            length,
            physical: length,
            wrong_seek: false,
            revoke_during_read: false,
            fail: None,
            live: Arc::new(AtomicBool::new(true)),
            counts: Arc::default(),
        }
    }
}
struct Reader {
    source: Arc<Provider>,
    position: u64,
}
impl Read for Reader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        let n = self
            .source
            .physical
            .saturating_sub(self.position)
            .min(bytes.len() as u64) as usize;
        for (index, byte) in bytes[..n].iter_mut().enumerate() {
            *byte = ((self.position + index as u64) % 251) as u8;
        }
        self.position += n as u64;
        let mut count = self.source.counts.lock().unwrap();
        count.reads += 1;
        count.bytes += n;
        if self.source.revoke_during_read {
            self.source.live.store(false, Ordering::Release);
        }
        Ok(n)
    }
}
impl Seek for Reader {
    fn seek(&mut self, seek: SeekFrom) -> io::Result<u64> {
        let target = match seek {
            SeekFrom::Start(n) => Some(n),
            SeekFrom::End(n) => self.source.length.checked_add_signed(n),
            SeekFrom::Current(n) => self.position.checked_add_signed(n),
        }
        .ok_or(io::ErrorKind::InvalidInput)?;
        self.position = target;
        Ok(if self.source.wrong_seek {
            target + 1
        } else {
            target
        })
    }
}
impl Drop for Reader {
    fn drop(&mut self) {
        self.source.counts.lock().unwrap().drops += 1;
    }
}
impl ResourceSource for Arc<Provider> {
    fn read(&self, _: &Path) -> Option<Vec<u8>> {
        panic!("streaming must not fetch legacy whole bytes")
    }
    fn is_live(&self) -> bool {
        self.live.load(Ordering::Acquire)
    }
    fn mime(&self, _: &Path) -> Option<&'static str> {
        Some("audio/mpeg")
    }
    fn open(&self, _: &Path) -> io::Result<Option<ResourceStream>> {
        self.counts.lock().unwrap().opens += 1;
        if let Some(kind) = self.fail {
            return Err(kind.into());
        }
        Ok(Some(ResourceStream {
            length: self.length,
            reader: Box::new(Reader {
                source: self.clone(),
                position: 0,
            }),
        }))
    }
}
fn content(source: impl ResourceSource + 'static, max: u64) -> PreparedContent {
    Content {
        root: None,
        source: Some(Source(Arc::new(source))),
        entry: Entry::Html("entry".into()),
        max_bytes: max,
        assets: vec![],
        ipc: None,
        policy: None,
        frames: None,
        disk_assets: None,
        locked: true,
    }
    .prepare()
}
fn get(content: &PreparedContent, method: &str, range: Option<&str>) -> ProtocolResponse {
    respond_request(
        content,
        true,
        method,
        &local_url_for("recording"),
        None,
        range,
    )
}

#[test]
fn provider_head_and_small_ranges_never_buffer_the_whole_admitted_resource() {
    let source = Arc::new(Provider::new(2 * 1024 * 1024 * 1024));
    let content = content(source.clone(), 16);
    let head = get(&content, "HEAD", Some("invalid"));
    assert_eq!(head.status, 200);
    assert_eq!(head.length, Some(source.length));
    assert!(head.body.is_empty());
    assert_eq!(head.mime, "audio/mpeg");
    {
        let count = source.counts.lock().unwrap();
        assert_eq!((count.reads, count.bytes, count.drops), (0, 0, 1));
    }
    let part = get(&content, "GET", Some("bytes=123-126"));
    assert_eq!(part.status, 206);
    assert_eq!(part.body, [123, 124, 125, 126]);
    assert_eq!(
        part.content_range.as_deref(),
        Some("bytes 123-126/2147483648")
    );
    let count = source.counts.lock().unwrap();
    assert_eq!(
        (count.opens, count.reads, count.bytes, count.drops),
        (2, 1, 4, 2)
    );
}
#[test]
fn provider_ranges_respect_suffixes_empty_files_and_budget_before_body_reads() {
    let source = Arc::new(Provider::new(8));
    let content = content(source.clone(), 4);
    for (header, expected) in [
        ("bytes=-3", vec![5, 6, 7]),
        ("bytes=6-", vec![6, 7]),
        ("bytes=7-99", vec![7]),
    ] {
        let r = get(&content, "GET", Some(header));
        assert_eq!(r.status, 206);
        assert_eq!(r.body, expected);
    }
    let before = source.counts.lock().unwrap().bytes;
    for header in ["bytes=8-", "bytes=-0", "bytes=0-1,3-4"] {
        assert_eq!(get(&content, "GET", Some(header)).status, 416);
    }
    assert_eq!(get(&content, "GET", None).status, 413);
    assert_eq!(get(&content, "GET", Some("bytes=0-4")).status, 413);
    assert_eq!(source.counts.lock().unwrap().bytes, before);
    let empty = Arc::new(Provider::new(0));
    let empty_content = super::stream_tests::content(empty.clone(), 4);
    assert_eq!(get(&empty_content, "GET", None).status, 200);
    assert_eq!(get(&empty_content, "GET", Some("bytes=0-0")).status, 416);
    assert_eq!(empty.counts.lock().unwrap().reads, 0);
}
#[test]
fn provider_stream_errors_and_wrong_extents_never_publish_partial_bytes_or_fall_back() {
    for wrong_seek in [false, true] {
        let mut source = Provider::new(8);
        source.physical = 3;
        source.wrong_seek = wrong_seek;
        let source = Arc::new(source);
        let content = content(source.clone(), 8);
        assert_eq!(get(&content, "GET", None).status, 404);
        assert_eq!(source.counts.lock().unwrap().drops, 1);
    }
    for (kind, status) in [
        (io::ErrorKind::PermissionDenied, 403),
        (io::ErrorKind::FileTooLarge, 413),
        (io::ErrorKind::Unsupported, 501),
    ] {
        let mut source = Provider::new(8);
        source.fail = Some(kind);
        let source = Arc::new(source);
        let content = content(source.clone(), 8);
        assert_eq!(get(&content, "GET", None).status, status);
        assert_eq!(source.counts.lock().unwrap().reads, 0);
    }
}
#[test]
fn revocation_inside_a_provider_read_stops_delivery_and_closes_the_reader() {
    let mut source = Provider::new(128 * 1024);
    source.revoke_during_read = true;
    let source = Arc::new(source);
    let content = content(source.clone(), source.length);
    assert_eq!(get(&content, "GET", None).status, 403);
    assert_eq!(get(&content, "HEAD", None).status, 403);
    let count = source.counts.lock().unwrap();
    assert_eq!(
        (count.opens, count.reads, count.bytes, count.drops),
        (1, 1, 64 * 1024, 1)
    );
}
#[test]
fn cumulative_projection_budgets_charge_actual_range_bytes_and_refuse_new_references_before_open() {
    let source = Arc::new(Provider::new(100));
    let content = content(Budgeted::new(source.clone(), 1, 5), 16);
    assert_eq!(get(&content, "HEAD", None).status, 200);
    assert_eq!(get(&content, "GET", Some("bytes=2-4")).body, [2, 3, 4]);
    assert_eq!(get(&content, "GET", Some("bytes=5-7")).status, 413);
    let before = source.counts.lock().unwrap().opens;
    assert_eq!(
        respond_request(
            &content,
            true,
            "GET",
            &local_url_for("other"),
            None,
            Some("bytes=0-0")
        )
        .status,
        404
    );
    let count = source.counts.lock().unwrap();
    assert_eq!(count.opens, before);
    assert_eq!(count.bytes, 5);
    assert_eq!(count.drops, count.opens);
}

#[test]
fn prepared_responses_deliver_the_first_chunk_without_consuming_the_remaining_gigabytes() {
    for (range, start, status) in [(None, 0_u64, 200), (Some("bytes=123-"), 123_u64, 206)] {
        let source = Arc::new(Provider::new(2 * 1024 * 1024 * 1024));
        let content = content(source.clone(), source.length);
        let mut response =
            prepare_request(&content, true, "GET", &local_url_for("movie"), None, range);
        assert_eq!(response.metadata.status, status);
        assert_eq!(response.metadata.length, Some(source.length - start));
        if range.is_some() {
            assert_eq!(
                response.metadata.content_range.as_deref(),
                Some("bytes 123-2147483647/2147483648")
            );
        }
        assert!(response.metadata.body.is_empty());
        assert_eq!(source.counts.lock().unwrap().reads, 0);
        let mut buffer = vec![0; CHUNK_BYTES * 2];
        assert_eq!(response.body.read(&mut buffer).unwrap(), CHUNK_BYTES);
        assert_eq!(buffer[0], (start % 251) as u8);
        assert_eq!(
            buffer[CHUNK_BYTES - 1],
            ((start + CHUNK_BYTES as u64 - 1) % 251) as u8
        );
        assert_eq!(source.counts.lock().unwrap().bytes, CHUNK_BYTES);
        drop(response);
        let count = source.counts.lock().unwrap();
        assert_eq!((count.reads, count.drops), (1, 1));
    }
}

#[test]
fn prepared_ranges_are_exact_and_released_even_when_the_transport_never_reads_them() {
    let source = Arc::new(Provider::new(100));
    let content = content(source.clone(), 100);
    let mut response = prepare_request(
        &content,
        true,
        "GET",
        &local_url_for("movie"),
        Some(ENTRY_ORIGIN),
        Some("bytes=10-14"),
    );
    assert_eq!(response.metadata.status, 206);
    assert_eq!(
        response.metadata.content_range.as_deref(),
        Some("bytes 10-14/100")
    );
    assert!(response.metadata.cors);
    let mut buffer = [0; 3];
    assert_eq!(response.body.read(&mut buffer).unwrap(), 3);
    assert_eq!(buffer, [10, 11, 12]);
    assert_eq!(response.body.read(&mut buffer).unwrap(), 2);
    assert_eq!(&buffer[..2], [13, 14]);
    assert_eq!(response.body.read(&mut buffer).unwrap(), 0);
    assert_eq!(source.counts.lock().unwrap().drops, 1);
    let unread = prepare_request(&content, true, "GET", &local_url_for("movie"), None, None);
    drop(unread);
    let count = source.counts.lock().unwrap();
    assert_eq!((count.reads, count.bytes, count.drops), (2, 5, 2));
}

#[test]
fn streamed_body_revocation_and_short_reads_are_terminal_and_erase_unpublished_data() {
    for during in [false, true] {
        let mut provider = Provider::new(100);
        provider.revoke_during_read = during;
        let source = Arc::new(provider);
        let content = content(source.clone(), 100);
        let mut response =
            prepare_request(&content, true, "GET", &local_url_for("movie"), None, None);
        if !during {
            content.revoke();
        }
        let mut buffer = [255; 8];
        assert_eq!(
            response.body.read(&mut buffer).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
        assert_eq!(buffer, [0; 8]);
        assert_eq!(source.counts.lock().unwrap().drops, 1);
        assert_eq!(source.counts.lock().unwrap().reads, usize::from(during));
    }
    let mut provider = Provider::new(8);
    provider.physical = 3;
    let source = Arc::new(provider);
    let content = content(source.clone(), 8);
    let mut response = prepare_request(&content, true, "GET", &local_url_for("movie"), None, None);
    let mut buffer = [255; 8];
    assert_eq!(response.body.read(&mut buffer).unwrap(), 3);
    assert_eq!(
        response.body.read(&mut buffer).unwrap_err().kind(),
        io::ErrorKind::UnexpectedEof
    );
    assert_eq!(buffer, [0; 8]);
    assert_eq!(
        response.body.read(&mut buffer).unwrap_err().kind(),
        io::ErrorKind::BrokenPipe
    );
    assert_eq!(source.counts.lock().unwrap().drops, 1);
}

#[test]
fn streamed_local_files_keep_opened_authority_but_fail_if_the_admitted_contents_change() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("video.mp4");
    std::fs::write(&path, b"abcdefgh").unwrap();
    let mut config = content(Arc::new(Provider::new(0)), 8).content;
    config.source = None;
    config.root = Some(root.path().to_path_buf());
    let content = config.prepare();
    let mut response = prepare_request(
        &content,
        true,
        "GET",
        &local_url_for("video.mp4"),
        None,
        None,
    );
    std::fs::rename(&path, root.path().join("original")).unwrap();
    std::fs::write(&path, b"replaced").unwrap();
    let mut buffer = [0; 3];
    assert_eq!(response.body.read(&mut buffer).unwrap(), 3);
    assert_eq!(&buffer, b"abc");
    std::fs::write(root.path().join("original"), b"short").unwrap();
    assert!(response.body.read(&mut buffer).is_err());
    assert_eq!(buffer, [0; 3]);
}
