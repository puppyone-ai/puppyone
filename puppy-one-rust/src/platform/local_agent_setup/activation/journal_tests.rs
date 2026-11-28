use super::*;
use core::prelude::v1::test;
use std::sync::atomic::AtomicUsize;

fn receipt(revision: u64) -> Snapshot {
    Snapshot {
        epoch: "fixture".into(),
        revision,
        operations: vec![],
    }
}
fn revision(journal: &Journal) -> u64 {
    let value: Value = serde_json::from_slice(&std::fs::read(&journal.path).unwrap()).unwrap();
    value["snapshot"]["revision"].as_u64().unwrap()
}

#[test]
fn failed_writer_start_preserves_the_newest_pending_receipt_for_the_next_enqueue() {
    let directory = tempfile::tempdir().unwrap();
    let attempts = Arc::new(AtomicUsize::new(0));
    let count = attempts.clone();
    let mut journal = Journal::new(directory.path().join("journal.json"));
    let launch = journal.spawn.clone();
    journal.spawn = Arc::new(move |work| {
        if count.fetch_add(1, Ordering::SeqCst) < 2 {
            return Err(std::io::Error::other("injected thread creation failure"));
        }
        launch(work)
    });
    let journal = Arc::new(journal);
    journal.enqueue(receipt(4));
    journal.enqueue(receipt(2));
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    assert!(!journal.path.exists());
    {
        let queue = journal.queued.lock().unwrap();
        assert!(!queue.running, "failed starts must release the writer slot");
        assert_eq!(queue.latest.as_ref().unwrap().revision, 4);
    }
    journal.enqueue(receipt(3));
    journal.flush();
    assert_eq!(attempts.load(Ordering::SeqCst), 3);
    assert_eq!(revision(&journal), 4);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn failed_disk_writes_do_not_advance_the_receipt_or_poison_later_writes() {
    let directory = tempfile::tempdir().unwrap();
    let parent = directory.path().join("parent");
    std::fs::write(&parent, b"preserve existing file").unwrap();
    let journal = Arc::new(Journal::new(parent.join("journal.json")));
    journal.enqueue(receipt(7));
    journal.flush();
    assert_eq!(*journal.written.lock().unwrap(), 0);
    assert_eq!(std::fs::read(&parent).unwrap(), b"preserve existing file");
    std::fs::remove_file(&parent).unwrap();
    journal.enqueue(receipt(8));
    journal.flush();
    assert_eq!(revision(&journal), 8);
    assert_eq!(*journal.written.lock().unwrap(), 8);
    let before = std::fs::read(&journal.path).unwrap();
    journal.enqueue(receipt(6));
    journal.flush();
    assert_eq!(std::fs::read(&journal.path).unwrap(), before);
    assert_eq!(std::fs::read_dir(parent).unwrap().count(), 1);
}
