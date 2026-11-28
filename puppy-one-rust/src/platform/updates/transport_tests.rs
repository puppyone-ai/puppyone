//! Real HTTP admission, including responses that never send their final chunk.
use super::*;
use base64::Engine as _;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{Arc, mpsc},
    thread::JoinHandle,
};

struct Feed {
    config: Configuration,
    sent: mpsc::Receiver<()>,
    release: Option<mpsc::Sender<()>>,
    stopped: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl Feed {
    fn new(response: Vec<u8>, hold_open: bool) -> Self {
        let path = format!(
            "/feed/{}",
            platform_feed_filename("dev", crate::platform::os::Os::current())
        );
        Self::at(path, response, hold_open)
    }

    fn at(path: impl Into<String>, response: Vec<u8>, hold_open: bool) -> Self {
        let path = path.into();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let (sent, received) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let stopped = Arc::new(AtomicBool::new(false));
        let stop = stopped.clone();
        let worker = std::thread::spawn(move || {
            let mut socket = loop {
                if stop.load(Ordering::Acquire) {
                    return;
                }
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    Err(error) => panic!("feed accept: {error}"),
                }
            };
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            socket
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                if socket.read(&mut byte).unwrap_or(0) == 0 {
                    return;
                }
                request.push(byte[0]);
                assert!(request.len() <= 8192, "bounded request headers");
            }
            assert!(request.starts_with(format!("GET {path} HTTP/1.1\r\n").as_bytes()));
            // Early rejection may close the socket while an oversized response
            // is still being written. Both sides must still retire cleanly.
            let _ = socket.write_all(&response);
            let _ = socket.flush();
            let _ = sent.send(());
            if hold_open {
                let _ = wait.recv_timeout(Duration::from_secs(10));
            }
        });
        Self {
            config: Configuration {
                channel: Channel::Dev,
                current_version: "0.4.4-dev.ga".into(),
                feed: Some(url::Url::parse(&format!("http://{address}/feed")).unwrap()),
                update_channel: Some("dev"),
                force_dev: true,
            },
            sent: received,
            release: Some(release),
            stopped,
            worker: Some(worker),
        }
    }

    fn release(&mut self) {
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
    }
}

impl Drop for Feed {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        self.release();
        if let Some(worker) = self.worker.take() {
            let joined = worker.join();
            if !std::thread::panicking() {
                joined.unwrap();
            }
        }
    }
}

fn test_payload_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "puppyone-0.4.5-dev.gb-win-x64-setup.exe"
    } else if cfg!(target_os = "linux") {
        "puppyone-0.4.5-dev.gb-linux-x64.AppImage"
    } else {
        "update.zip"
    }
}

fn metadata() -> Vec<u8> {
    let digest = base64::engine::general_purpose::STANDARD.encode([1; 64]);
    let name = test_payload_name();
    format!(
        "version: 0.4.5-dev.gb\nfiles:\n  - url: {name}\n    sha512: {digest}\n    size: 9\npath: {name}\nsha512: {digest}\nreleaseDate: '2026-11-17T00:00:00Z'\n# 中文\n"
    ).into_bytes()
}

fn chunked(body: &[u8], terminate: bool) -> Vec<u8> {
    let mut response =
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_vec();
    // Split one UTF-8 character across separate HTTP chunks.
    let split = body.iter().position(|byte| !byte.is_ascii()).unwrap_or(0);
    for chunk in [
        &body[..split + 1],
        &body[split + 1..split + 2],
        &body[split + 2..],
    ] {
        write!(response, "{:x}\r\n", chunk.len()).unwrap();
        response.extend_from_slice(chunk);
        response.extend_from_slice(b"\r\n");
    }
    if terminate {
        response.extend_from_slice(b"0\r\n\r\n");
    }
    response
}

#[test]
fn metadata_at_the_exact_byte_limit_accepts_chunked_utf8_and_resolves_the_payload() {
    let mut body = metadata();
    body.extend_from_slice(b"#");
    body.resize(feed::MAX_METADATA_BYTES, b' ');
    let feed = Feed::new(chunked(&body, true), false);
    let candidate = check(&feed.config).unwrap();
    assert_eq!(candidate.version, "0.4.5-dev.gb");
    assert_eq!(candidate.size, 9);
    assert_eq!(
        candidate.sha512,
        base64::engine::general_purpose::STANDARD.encode([1; 64])
    );
    assert_eq!(
        candidate.url,
        feed.config
            .feed
            .as_ref()
            .unwrap()
            .join(&format!("feed/{}", test_payload_name()))
            .unwrap()
    );
}

#[test]
fn oversized_metadata_is_rejected_before_the_server_finishes_its_body() {
    let mut body = metadata();
    body.resize(feed::MAX_METADATA_BYTES + 1, b' ');
    let mut close_delimited = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
    close_delimited.extend_from_slice(&body);
    for response in [
        chunked(&body, false),
        close_delimited,
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes(),
    ] {
        let mut feed = Feed::new(response, true);
        let config = feed.config.clone();
        let (sent, received) = mpsc::channel();
        let client = std::thread::spawn(move || sent.send(check(&config)).unwrap());
        feed.sent.recv_timeout(Duration::from_secs(5)).unwrap();
        let early = received.recv_timeout(Duration::from_secs(2));
        // Release and join before asserting, including the regression path.
        feed.release();
        let outcome = early
            .as_ref()
            .ok()
            .cloned()
            .unwrap_or_else(|| received.recv_timeout(Duration::from_secs(5)).unwrap());
        client.join().unwrap();
        assert!(
            early.is_ok(),
            "metadata admission waited for an unbounded body to finish"
        );
        assert_eq!(outcome.unwrap_err(), "The update metadata is too large.");
    }
}

#[test]
fn metadata_transport_rejects_non_text_and_non_success_statuses() {
    for (response, message) in [
        (b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n\xff\xfe".to_vec(), "not text"),
        (b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(), "404"),
        (b"HTTP/1.1 302 Found\r\nLocation: https://example.invalid/foreign\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(), "302"),
    ] {
        let feed = Feed::new(response, false);
        let error = check(&feed.config).unwrap_err();
        assert!(error.contains(message), "{error}");
    }
}

fn archive_candidate(feed: &Feed, body: &[u8]) -> Candidate {
    use sha2::Digest as _;
    Candidate {
        version: "0.4.5-dev.gb".into(),
        url: feed
            .config
            .feed
            .as_ref()
            .unwrap()
            .join("feed/update.zip")
            .unwrap(),
        size: body.len() as u64,
        sha512: base64::engine::general_purpose::STANDARD.encode(sha2::Sha512::digest(body)),
    }
}

fn complete_response(body: &[u8]) -> Vec<u8> {
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    response.extend_from_slice(body);
    response
}

fn entries(directory: &Path) -> Vec<String> {
    let mut entries: Vec<_> = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_str().unwrap().to_owned())
        .collect();
    entries.sort();
    entries
}

#[test]
fn download_preserves_windows_exe_and_linux_appimage_extensions() {
    let directory = tempfile::tempdir().unwrap();
    let cancel = AtomicBool::new(false);
    for (filename, expected_ext) in [
        ("puppyone-0.4.5-win-x64-setup.exe", "exe"),
        ("puppyone-0.4.5-linux-x64.AppImage", "AppImage"),
    ] {
        let bytes = b"payload-bytes";
        let feed = Feed::at(format!("/feed/{filename}"), complete_response(bytes), false);
        use sha2::Digest as _;
        let candidate = Candidate {
            version: "0.4.5".into(),
            url: feed
                .config
                .feed
                .as_ref()
                .unwrap()
                .join(&format!("feed/{filename}"))
                .unwrap(),
            size: bytes.len() as u64,
            sha512: base64::engine::general_purpose::STANDARD.encode(sha2::Sha512::digest(bytes)),
        };
        let path = download(&feed.config, &candidate, directory.path(), |_| {}, &cancel).unwrap();
        assert_eq!(
            path.extension().and_then(|e| e.to_str()),
            Some(expected_ext),
            "{filename} -> {}",
            path.display()
        );
    }
}

#[test]
fn verified_archives_have_independent_owners_and_leave_existing_files_untouched() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("update.zip"),
        b"existing verified download",
    )
    .unwrap();
    let bytes = b"a valid archive payload";
    let first = Feed::at("/feed/update.zip", complete_response(bytes), false);
    let candidate = archive_candidate(&first, bytes);
    let cancel = AtomicBool::new(false);
    let mut progress = Vec::new();
    let archive = download(
        &first.config,
        &candidate,
        directory.path(),
        |p| progress.push(p),
        &cancel,
    )
    .unwrap();
    assert_eq!(std::fs::read(&archive).unwrap(), bytes);
    assert_eq!(
        std::fs::read(directory.path().join("update.zip")).unwrap(),
        b"existing verified download"
    );
    assert!(!progress.is_empty());
    assert_eq!(progress.last().unwrap().percent, 100.);
    assert_eq!(progress.last().unwrap().transferred, bytes.len() as f64);
    for (index, value) in progress.iter().enumerate() {
        assert!(value.percent.is_finite() && value.percent > 0. && value.percent <= 100.);
        assert!(value.bytes_per_second.is_finite() && value.bytes_per_second > 0.);
        assert_eq!(value.total, bytes.len() as f64);
        if index > 0 {
            assert!(value.transferred > progress[index - 1].transferred);
        }
    }
    let second = Feed::at("/feed/update.zip", complete_response(bytes), false);
    let other = download(
        &second.config,
        &archive_candidate(&second, bytes),
        directory.path(),
        |_| {},
        &cancel,
    )
    .unwrap();
    assert_ne!(archive.to_path_buf(), other.to_path_buf());
    assert_eq!(std::fs::read(&archive).unwrap(), bytes);
    let first_path = archive.to_path_buf();
    drop(archive);
    assert!(
        !first_path.exists(),
        "the retired owner leaves no downloaded archive"
    );
    assert_eq!(std::fs::read(&other).unwrap(), bytes);
    drop(other);
    assert_eq!(entries(directory.path()), ["update.zip"]);
}

#[test]
fn every_failed_download_cleans_only_its_partial_archive() {
    for (response, expected) in [
        (complete_response(b"tampered"), "SHA-512"),
        (complete_response(b"too much data"), "larger"),
        (complete_response(b"short"), "smaller"),
        (b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nshort".to_vec(), ""),
        (b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(), "404"),
        (b"HTTP/1.1 302 Found\r\nLocation: https://example.invalid/foreign\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(), "302"),
    ] {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("keep"), b"unrelated").unwrap();
        let feed = Feed::at("/feed/update.zip", response, false);
        let candidate = archive_candidate(&feed, b"expected");
        let error = download(&feed.config, &candidate, directory.path(), |_| {}, &AtomicBool::new(false)).unwrap_err();
        assert!(error.contains(expected), "{error}");
        assert_eq!(entries(directory.path()), ["keep"], "{error}");
        assert_eq!(std::fs::read(directory.path().join("keep")).unwrap(), b"unrelated");
    }
}

#[test]
fn cancellation_interrupts_both_stalled_headers_and_stalled_chunks() {
    for response in [
        Vec::new(),
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\nabc\r\n"
            .to_vec(),
    ] {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("keep"), b"unrelated").unwrap();
        let mut feed = Feed::at("/feed/update.zip", response, true);
        let candidate = archive_candidate(&feed, b"abcdefgh");
        let config = feed.config.clone();
        let path = directory.path().to_path_buf();
        let cancel = Arc::new(AtomicBool::new(false));
        let signal = cancel.clone();
        let (sent, received) = mpsc::channel();
        let client = std::thread::spawn(move || {
            let result = download(&config, &candidate, &path, |_| {}, &signal);
            sent.send(result.map(|archive| archive.to_path_buf()))
                .unwrap();
        });
        feed.sent.recv_timeout(Duration::from_secs(5)).unwrap();
        cancel.store(true, Ordering::Relaxed);
        let early = received.recv_timeout(Duration::from_secs(2));
        feed.release();
        let outcome = early
            .as_ref()
            .ok()
            .cloned()
            .unwrap_or_else(|| received.recv_timeout(Duration::from_secs(5)).unwrap());
        client.join().unwrap();
        assert!(early.is_ok(), "cancellation waited for the server");
        assert_eq!(outcome.unwrap_err(), "The download was cancelled.");
        assert_eq!(entries(directory.path()), ["keep"]);
    }
}

#[test]
fn cancelled_or_out_of_budget_downloads_do_not_touch_the_destination() {
    let feed = Feed::at("/feed/update.zip", Vec::new(), false);
    let root = tempfile::tempdir().unwrap();
    let destination = root.path().join("not-created");
    let mut candidate = archive_candidate(&feed, b"expected");
    for (size, cancel, expected) in [
        (MAX_ARCHIVE_BYTES + 1, false, "too large"),
        (0, false, "empty"),
        (8, true, "cancelled"),
    ] {
        candidate.size = size;
        let result = download(
            &feed.config,
            &candidate,
            &destination,
            |_| panic!("no progress before admission"),
            &AtomicBool::new(cancel),
        );
        assert!(result.unwrap_err().contains(expected));
        assert!(!destination.exists());
    }
}
