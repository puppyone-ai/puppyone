//! `markdownTableColumnLayoutSession.test.ts` against the native store.
use super::super::continuity::Continuity;
use super::*;
use crate::editor::text::change::Assoc;
use core::prelude::v1::test;

const TABLE: &str = "markdown-table";

fn continuous(old: Range<usize>, new: Range<usize>, change: SequenceChange) -> Vec<Continuity> {
    vec![Continuity {
        feature: TABLE,
        old,
        new,
        change,
    }]
}

fn map(store: &mut Store, continuities: Vec<Continuity>, shift: usize, touched: bool) {
    let map_pos = move |p: usize, _: Assoc| p + shift;
    let touches = move |_: &Range<usize>| touched;
    store.map(&Mapping {
        continuities,
        map_pos: &map_pos,
        touches: &touches,
        inside: &|_| false,
    });
}

fn memory() -> Rc<Preferences<MemoryStorage>> {
    Rc::new(Preferences::new(MemoryStorage::default()))
}

/// `markdownTableColumnLayoutSession.test.ts` #0.
#[test]
fn widths_stay_through_content_edits_source_movement_and_reopening() {
    let persistence = memory();
    let open = |p: &Rc<Preferences<MemoryStorage>>| {
        Store::with(
            MAX_DETACHED,
            Rc::new(|| 0),
            Some(p.clone() as Rc<dyn Persistence>),
        )
    };
    let mut store = open(&persistence);
    let ns = Some("/notes/table.md");
    let first = store.acquire(TABLE, &[120., 180.], None, 20..80, ns, 1);
    store.set_widths(first.id, first.mount, &[160., 200.]);
    map(
        &mut store,
        continuous(20..80, 20..86, SequenceChange::Preserve),
        0,
        true,
    );
    let after_edit = store.acquire(TABLE, &[96., 96.], None, 20..86, ns, 2);
    assert_eq!(after_edit.id, first.id);
    assert_eq!(after_edit.widths, [160., 200.]);
    map(&mut store, vec![], 12, false);
    let after_prefix = store.acquire(TABLE, &[96., 96.], None, 32..98, ns, 2);
    assert_eq!(after_prefix.id, first.id);
    assert_eq!(after_prefix.widths, [160., 200.]);
    let mut reopened = open(&persistence);
    assert_eq!(
        reopened
            .acquire(TABLE, &[96., 96.], None, 32..98, ns, 2)
            .widths,
        [160., 200.]
    );
}

/// #1.
#[test]
fn widths_move_with_their_columns_and_only_inserted_tracks_start_fresh() {
    let mut store = Store::default();
    store.acquire(TABLE, &[120., 180., 220.], None, 0..60, None, 1);
    map(
        &mut store,
        continuous(0..60, 0..70, SequenceChange::Insert { index: 1, count: 1 }),
        0,
        true,
    );
    let s = store.acquire(TABLE, &[96., 104., 96., 96.], None, 0..70, None, 2);
    assert_eq!(s.widths, [120., 48., 180., 220.]);
    map(
        &mut store,
        continuous(0..70, 0..70, SequenceChange::Move { from: 0, to: 2 }),
        0,
        true,
    );
    let s = store.acquire(TABLE, &[96.; 4], None, 0..70, None, 3);
    assert_eq!(s.widths, [48., 180., 120., 220.]);
    map(
        &mut store,
        continuous(0..70, 0..62, SequenceChange::Delete { index: 1, count: 1 }),
        0,
        true,
    );
    let s = store.acquire(TABLE, &[96.; 3], None, 0..62, None, 4);
    assert_eq!(s.widths, [48., 120., 220.]);
}

struct Recorder {
    written: RefCell<Vec<String>>,
    removed: RefCell<Vec<String>>,
}

impl Persistence for Recorder {
    fn read(&self, _: &str, _: usize) -> Option<Vec<f32>> {
        None
    }
    fn write(&self, key: &str, _: &[f32], _: Option<&str>) {
        self.written.borrow_mut().push(key.to_owned());
    }
    fn remove(&self, key: &str) {
        self.removed.borrow_mut().push(key.to_owned());
    }
}

/// #2.
#[test]
fn automatic_tracks_reflow_and_explicit_tracks_stay_fixed() {
    let recorder = Rc::new(Recorder {
        written: RefCell::default(),
        removed: RefCell::default(),
    });
    let mut store = Store::with(
        MAX_DETACHED,
        Rc::new(|| 0),
        Some(recorder.clone() as Rc<dyn Persistence>),
    );
    let s = store.acquire(
        TABLE,
        &[200., 300.],
        Some(640.),
        0..40,
        Some("/notes/table.md"),
        1,
    );
    assert!(!s.explicit);
    assert_eq!(s.auto_layout_width, Some(640.));
    // A new reading width reflows without persisting or turning explicit.
    let s = store
        .set_auto_widths(s.id, s.mount, &[150., 250.], 480.)
        .unwrap();
    assert_eq!(
        (s.widths.as_slice(), s.explicit, s.auto_layout_width),
        (&[150., 250.][..], false, Some(480.))
    );
    assert!(recorder.written.borrow().is_empty());
    // The person's widths persist and stop following the reading column.
    let s = store.set_widths(s.id, s.mount, &[260., 220.]).unwrap();
    assert_eq!(
        (s.widths.as_slice(), s.explicit, s.auto_layout_width),
        (&[260., 220.][..], true, None)
    );
    assert_eq!(recorder.written.borrow().len(), 1);
    assert_eq!(store.set_auto_widths(s.id, s.mount, &[1., 2.], 900.), None);
    // Reset returns to automatic layout and forgets the stored widths.
    let s = store.reset_to_auto(s.id, s.mount).unwrap();
    assert_eq!((s.explicit, s.auto_layout_width), (false, None));
    assert_eq!(*recorder.removed.borrow(), *recorder.written.borrow());
}

/// #3.
#[test]
fn automatic_tracks_relay_out_when_a_column_is_added_or_removed_not_moved() {
    let mut store = Store::default();
    store.acquire(TABLE, &[200., 300.], Some(640.), 0..40, None, 1);
    map(
        &mut store,
        continuous(0..40, 0..40, SequenceChange::Move { from: 0, to: 1 }),
        0,
        true,
    );
    let s = store.acquire(TABLE, &[96., 96.], Some(640.), 0..40, None, 2);
    assert_eq!(
        (s.widths.as_slice(), s.auto_layout_width),
        (&[300., 200.][..], Some(640.))
    );
    map(
        &mut store,
        continuous(0..40, 0..50, SequenceChange::Insert { index: 2, count: 1 }),
        0,
        true,
    );
    let s = store.acquire(TABLE, &[96.; 3], Some(640.), 0..50, None, 3);
    assert_eq!(s.auto_layout_width, None);
}

/// `markdownTableColumnLayoutSession.test.ts` #4 (persistence).
#[test]
fn persisted_widths_restore_only_for_the_same_content_and_column_count() {
    let p = Preferences::new(MemoryStorage::default());
    let matching = persistence_key(Some("/notes/table.md"), 1, 10).unwrap();
    let other = persistence_key(Some("/notes/table.md"), 2, 10).unwrap();
    p.write(&matching, &[140., 320.], None);
    assert_eq!(p.read(&matching, 2), Some(vec![140., 320.]));
    assert_eq!(p.read(&other, 2), None);
    assert_eq!(p.read(&matching, 3), None);
    p.write(&other, &[160., 340.], Some(&matching));
    assert_eq!(p.read(&matching, 2), None);
    assert_eq!(p.read(&other, 2), Some(vec![160., 340.]));
}
