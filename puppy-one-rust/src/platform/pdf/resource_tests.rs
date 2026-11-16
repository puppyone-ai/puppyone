#![cfg(test)]
use super::{Failure, Source, resource::admit};
use std::io::{Read, Seek, SeekFrom, Write};

#[test]
fn pdf_signature_admission_matches_the_ts_header_window_and_version_pattern() {
    for header in [
        b"".as_slice(),
        b"%PDF-",
        b"%PDF-x.y",
        b"%PDF-9.0",
        b"%PDF-1.x",
        b"<html>%PDF-no</html>",
    ] {
        assert!(
            matches!(
                admit(Source::Bytes(header.to_vec()), 4096),
                Err(Failure::Resource)
            ),
            "{header:?}"
        );
    }
    for header in [
        b"%PDF-1.7 structurally broken".as_slice(),
        b"prefix %PDF-2.0 arbitrary",
        b"%PDF-1.0",
    ] {
        assert!(
            admit(Source::Bytes(header.to_vec()), 4096).is_ok(),
            "{header:?}"
        );
    }
    for offset in [1016, 1017, 1024] {
        let mut bytes = vec![b'x'; offset];
        bytes.extend(b"%PDF-1.7");
        assert_eq!(admit(Source::Bytes(bytes), 4096).is_ok(), offset == 1016);
    }
}

#[test]
fn pdf_admission_and_later_reads_use_one_descriptor_with_a_fixed_end() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("file.pdf");
    let original = b"%PDF-1.7 original";
    std::fs::write(&path, original).unwrap();
    let mut admitted = admit(Source::File(path.clone()), 1024).unwrap();
    std::fs::rename(&path, temp.path().join("moved.pdf")).unwrap();
    std::fs::write(&path, b"%PDF-1.7 replaced").unwrap();
    std::fs::OpenOptions::new()
        .append(true)
        .open(temp.path().join("moved.pdf"))
        .unwrap()
        .write_all(b"unadmitted append")
        .unwrap();
    let mut bytes = Vec::new();
    admitted.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, original);
    assert_eq!(
        admitted.seek(SeekFrom::End(0)).unwrap(),
        original.len() as u64
    );
    assert!(admitted.seek(SeekFrom::End(1)).is_err());
}

#[test]
fn pdf_admits_sparse_files_at_the_manifest_limit_and_refuses_growth_before_reading() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("large.pdf");
    let mut file = std::fs::File::create(&path).unwrap();
    file.write_all(b"%PDF-1.7").unwrap();
    let limit = 512 * 1024 * 1024;
    for size in [101 * 1024 * 1024, limit] {
        file.set_len(size).unwrap();
        let mut admitted = admit(Source::File(path.clone()), limit).unwrap();
        let mut chunk = [0; 64 * 1024];
        assert_eq!(admitted.read(&mut chunk).unwrap(), chunk.len());
        assert!(chunk.starts_with(b"%PDF-1.7"));
        assert_eq!(admitted.seek(SeekFrom::End(0)).unwrap(), size);
    }
    file.set_len(limit + 1).unwrap();
    assert!(matches!(
        admit(Source::File(path), limit),
        Err(Failure::Limit)
    ));
}

#[test]
fn pdf_reader_admission_is_lazy_and_every_exit_releases_its_owned_reader() {
    use std::{
        io::{self, Cursor},
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
    };
    struct Counted {
        bytes: Cursor<Vec<u8>>,
        reads: Arc<AtomicUsize>,
        drops: Arc<AtomicUsize>,
    }
    impl Drop for Counted {
        fn drop(&mut self) {
            self.drops.fetch_add(1, Ordering::SeqCst);
        }
    }
    impl Read for Counted {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.bytes.read(buf)
        }
    }
    impl Seek for Counted {
        fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
            self.bytes.seek(from)
        }
    }
    for (bytes, budget, expected) in [
        (b"%PDF-1.7 broken".as_slice(), 100, None),
        (b"%PDF-1.7", 1, Some(Failure::Limit)),
        (b"not a pdf", 100, Some(Failure::Resource)),
    ] {
        let reads = Arc::new(AtomicUsize::new(0));
        let drops = Arc::new(AtomicUsize::new(0));
        let reader = Counted {
            bytes: Cursor::new(bytes.to_vec()),
            reads: reads.clone(),
            drops: drops.clone(),
        };
        let source = Source::Reader(Box::new(move || Ok(Box::new(reader))));
        assert_eq!(reads.load(Ordering::SeqCst), 0);
        let result = admit(source, budget);
        assert_eq!(result.as_ref().err().copied(), expected);
        if expected == Some(Failure::Limit) {
            assert_eq!(reads.load(Ordering::SeqCst), 0);
        }
        drop(result);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn pdf_open_deadline_includes_blocked_provider_admission_and_suppresses_late_failures() {
    use std::{sync::mpsc, time::Duration};
    let (started_tx, started_rx) = mpsc::channel();
    let (finish_tx, finish_rx) = mpsc::channel();
    let (requests, inbox) = mpsc::channel();
    let (tx, rx) = async_channel::unbounded();
    let caller = std::thread::current().id();
    let source = Source::Reader(Box::new(move || {
        started_tx.send(std::thread::current().id()).unwrap();
        finish_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        Err(Failure::Resource)
    }));
    let worker = std::thread::spawn(move || {
        super::run(
            source,
            1024,
            crate::platform::tasks::Owner::new("test", "pdf-admission", 1),
            inbox,
            tx,
            Duration::from_millis(25),
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        )
    });
    assert_ne!(
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
        caller
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        match rx.try_recv() {
            Ok(super::Reply::Failed(Failure::Timeout)) => break,
            Ok(_) => panic!("Unexpected admission reply"),
            Err(async_channel::TryRecvError::Closed) => panic!("Deadline was not reported"),
            Err(_) => {
                assert!(std::time::Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(1));
            }
        }
    }
    finish_tx.send(()).unwrap();
    drop(requests);
    worker.join().unwrap();
    assert!(matches!(
        rx.try_recv(),
        Err(async_channel::TryRecvError::Closed)
    ));
}

#[test]
fn dropping_a_pdf_document_closes_publication_while_provider_admission_is_pending() {
    use std::{sync::mpsc, time::Duration};
    let (started_tx, started_rx) = mpsc::channel();
    let (finish_tx, finish_rx) = mpsc::channel();
    let (finished_tx, finished_rx) = mpsc::channel();
    let (tx, rx) = async_channel::unbounded();
    let source = Source::Reader(Box::new(move || {
        started_tx.send(()).unwrap();
        finish_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        finished_tx.send(()).unwrap();
        Err(Failure::Resource)
    }));
    let document = super::Document::open_with_timeout(
        source,
        1024,
        crate::platform::tasks::Owner::new("test", "pdf-retired", 1),
        tx,
        Duration::from_millis(25),
    );
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    drop(document);
    assert!(
        rx.is_closed(),
        "UI publication must close before provider work can complete"
    );
    assert!(matches!(
        rx.try_recv(),
        Err(async_channel::TryRecvError::Closed)
    ));
    finish_tx.send(()).unwrap();
    finished_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(matches!(
        rx.try_recv(),
        Err(async_channel::TryRecvError::Closed)
    ));
}
