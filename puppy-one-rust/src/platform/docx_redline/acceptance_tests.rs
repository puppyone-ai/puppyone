use super::*;
use std::{cell::Cell, io::Write, sync::atomic::Ordering, time::Instant};

fn paragraph(text: &str) -> String {
    format!("<w:p><w:r><w:t>{text}</w:t></w:r></w:p>")
}
fn xml(body: &str) -> String {
    format!(
        "<w:document xmlns:w=\"{}\"><w:body>{body}</w:body></w:document>",
        WORDPROCESSING[0]
    )
}
fn block(text: &str) -> Block {
    Block {
        kind: BlockKind::Paragraph,
        text: text.into(),
    }
}

#[test]
fn canonical_blocks_and_namespace_prefixes_preserve_word_semantics() {
    let body = [
        "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Release</w:t></w:r><w:r><w:t> notes</w:t></w:r></w:p>",
        "<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>First item</w:t></w:r></w:p>",
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    ].concat();
    assert_eq!(
        normalize(&xml(&body)).unwrap(),
        vec![
            Block {
                kind: BlockKind::Heading,
                text: "Release notes".into()
            },
            Block {
                kind: BlockKind::ListItem,
                text: "First item".into()
            },
            Block {
                kind: BlockKind::TableRow,
                text: "Name | Status".into()
            },
        ]
    );
    let strict = format!(
        "<doc:document xmlns:doc=\"{}\"><doc:body><doc:p data-note=\"1 > 0\"><doc:pPr><doc:pStyle doc:val=\"Heading2\"/></doc:pPr><!-- > --><doc:r><doc:t>Portable prefix</doc:t></doc:r></doc:p></doc:body></doc:document>",
        WORDPROCESSING[1]
    );
    assert_eq!(
        normalize(&strict).unwrap(),
        vec![Block {
            kind: BlockKind::Heading,
            text: "Portable prefix".into()
        }]
    );
}

#[test]
fn deleted_content_and_malformed_packages_never_become_partial_models() {
    let source = xml(
        "<w:p><w:del><w:r><w:t>Removed</w:t></w:r></w:del><w:moveFrom><w:r><w:t>Moved</w:t></w:r></w:moveFrom><w:r><w:t>Visible</w:t></w:r></w:p>",
    );
    assert_eq!(normalize(&source).unwrap(), vec![block("Visible")]);
    assert!(
        normalize("<!DOCTYPE x><x/>")
            .unwrap_err()
            .contains("document type")
    );
    let malformed = format!("<w:document xmlns:w=\"{}\"><w:p>", WORDPROCESSING[0]);
    assert!(normalize(&malformed).unwrap_err().contains("malformed"));
    assert!(build(Some(&[1, 2, 3]), Some(&test_docx(&paragraph("valid")))).is_err());
    assert!(
        build(
            Some(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            None
        )
        .unwrap_err()
        .contains("Encrypted or password")
    );
}

#[test]
fn located_word_changes_keep_insertions_and_one_sided_documents_distinct() {
    let before = test_docx(
        &[
            paragraph("Stable introduction"),
            paragraph("The release is ready for internal testing."),
            paragraph("Stable ending"),
        ]
        .concat(),
    );
    let after = test_docx(
        &[
            paragraph("Stable introduction"),
            paragraph("The release is ready for broad customer testing."),
            paragraph("New deployment note"),
            paragraph("Stable ending"),
        ]
        .concat(),
    );
    let model = build(Some(&before), Some(&after)).unwrap();
    assert_eq!(model.state, State::Ready);
    assert_eq!(
        (
            model.stats.blocks_added,
            model.stats.blocks_modified,
            model.stats.blocks_changed
        ),
        (1, 1, 2)
    );
    assert!(model.stats.words_added > 0 && model.stats.words_deleted > 0);
    assert_eq!(
        (model.changes[0].before, model.changes[0].after),
        (Some(1), Some(1))
    );
    assert!(
        model.changes[0]
            .segments
            .iter()
            .any(|s| s.kind == SegmentKind::Remove && s.text.contains("internal"))
    );
    assert!(
        model.changes[0]
            .segments
            .iter()
            .any(|s| s.kind == SegmentKind::Add && s.text.contains("broad customer"))
    );
    assert_eq!(
        (model.changes[1].kind, model.changes[1].after),
        (ChangeKind::Added, Some(2))
    );
    let revision = test_docx(&paragraph("Only revision"));
    let added = build(None, Some(&revision)).unwrap();
    let deleted = build(Some(&revision), None).unwrap();
    assert_eq!((added.state, added.stats.blocks_added), (State::Added, 1));
    assert_eq!(
        (deleted.state, deleted.stats.blocks_deleted),
        (State::Deleted, 1)
    );
    let changes = align(
        &[block("alpha"), block("omega")],
        &[block("alpha"), block("inserted"), block("omega")],
    );
    assert_eq!(changes.len(), 1);
    assert_eq!(
        (changes[0].kind, changes[0].after),
        (ChangeKind::Added, Some(1))
    );
}

#[test]
fn semantic_character_and_block_budgets_reject_expansion() {
    let source = xml(&paragraph(&"x".repeat(MAX_TEXT_CHARACTERS + 1)));
    assert!(normalize(&source).unwrap_err().contains("character budget"));
    let source = xml(&paragraph("x").repeat(MAX_BLOCKS + 1));
    assert!(normalize(&source).unwrap_err().contains("block budget"));
    let source = xml(&paragraph(&"😀".repeat(MAX_TEXT_CHARACTERS / 2 + 1)));
    assert!(normalize(&source).unwrap_err().contains("character budget"));
}

#[test]
fn archive_claims_are_checked_before_expansion_and_presentation_is_capped() {
    fn sizes(mut package: Vec<u8>, size: u32) -> Vec<u8> {
        let entries: Vec<_> = package
            .windows(4)
            .enumerate()
            .filter_map(|(i, bytes)| (bytes == [0x50, 0x4b, 0x01, 0x02]).then_some(i))
            .collect();
        for entry in entries {
            package[entry + 24..entry + 28].copy_from_slice(&size.to_le_bytes());
        }
        package
    }
    let document = xml(&paragraph("body"));
    let one = stored_package(&[("word/document.xml", document.as_bytes())]);
    assert!(
        parse(&sizes(one.clone(), MAX_ENTRY_BYTES as u32 + 1))
            .unwrap_err()
            .contains("entry exceeds")
    );
    assert!(
        parse(&sizes(one, 1))
            .unwrap_err()
            .contains("stored entry size")
    );
    let total = stored_package(&[
        ("word/document.xml", document.as_bytes()),
        ("a", b"a"),
        ("b", b"b"),
        ("c", b"c"),
        ("d", b"d"),
    ]);
    assert!(
        parse(&sizes(total, MAX_ENTRY_BYTES as u32))
            .unwrap_err()
            .contains("package exceeds")
    );
    let revision = test_docx(&paragraph("added body").repeat(MAX_PRESENTED_CHANGES + 1));
    let model = build(None, Some(&revision)).unwrap();
    assert!(model.truncated);
    assert_eq!(model.changes.len(), MAX_PRESENTED_CHANGES);
    assert_eq!(model.stats.blocks_added, MAX_PRESENTED_CHANGES + 1);
}

#[test]
fn cancellation_precedes_package_parsing_and_processing_has_a_20_second_limit() {
    assert_eq!(control::TIMEOUT.as_millis(), 20_000);
    assert_eq!(
        build_cancellable(Some(b"invalid"), None, &AtomicBool::new(true)).unwrap_err(),
        control::CANCELLED
    );
    let cancel = AtomicBool::new(false);
    let started = Instant::now();
    let now = Cell::new(started);
    let clock = || now.get();
    let budget = Budget::with_clock(&cancel, Some(control::TIMEOUT), &clock);
    now.set(started + control::TIMEOUT);
    assert_eq!(
        build_with(Some(b"invalid"), None, &budget).unwrap_err(),
        control::TIMED_OUT
    );
}

fn interrupts<T>(work: impl Fn(&Budget<'_>) -> Result<T, String>) {
    for cancellation in [false, true] {
        let cancel = AtomicBool::new(false);
        let started = Instant::now();
        let calls = Cell::new(0usize);
        let clock = || {
            let call = calls.get();
            calls.set(call + 1);
            if call >= 2 {
                if cancellation {
                    cancel.store(true, Ordering::Release);
                } else {
                    return started + control::TIMEOUT;
                }
            }
            started
        };
        let budget = Budget::with_clock(&cancel, Some(control::TIMEOUT), &clock);
        let error = work(&budget)
            .err()
            .expect("in-progress work must stop without a partial result");
        assert_eq!(
            error,
            if cancellation {
                control::CANCELLED
            } else {
                control::TIMED_OUT
            }
        );
        assert!(calls.get() >= 3, "deadline crosses inside the stage");
    }
}

#[test]
fn decompression_normalization_and_alignment_stop_after_they_have_started() {
    let source = xml(&paragraph(&"body ".repeat(40_000)));
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(source.as_bytes()).unwrap();
    let compressed = encoder.finish().unwrap();
    interrupts(|budget| inflate(&compressed, source.len() as u64, budget, &mut Vec::new()));
    interrupts(|budget| normalize_with(&source, budget));
    let left = [block("a shared sentence"), block("another shared sentence")];
    let right = [
        block("a revised sentence"),
        block("another revised sentence"),
    ];
    interrupts(|budget| unique_anchors(&left, &right, budget));
    interrupts(|budget| align_gap(&left, &right, 0, 2, 0, 2, budget));
    interrupts(|budget| align_large_gap(&left, &right, 0, 0, budget));
    interrupts(|budget| diff_words("a shared sentence", "a revised sentence", budget));
    let before = test_docx(&paragraph("a shared sentence"));
    let after = test_docx(&paragraph("a revised sentence"));
    assert_eq!(
        build(Some(&before), Some(&after)).unwrap(),
        build_cancellable(Some(&before), Some(&after), &AtomicBool::new(false)).unwrap()
    );
}
