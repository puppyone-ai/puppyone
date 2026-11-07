//! Single preference owner, analogous to preferencesStore + preferencesPersistence.
//! Views dispatch changes. This controller coalesces them behind one native write.
use super::preference_types::Preferences;
use crate::platform::preference_storage::{self, Event, Write};
use gpui::*;
#[derive(Clone)]
pub struct PreferencesChanged;

/// A selected part of the preferences (`useDesktopPreference(selector)`): it
/// reports a change only when the selected value differs from the last one
/// it saw, so a write to another field does not reach its owner.
pub struct Slice<T> {
    last: Option<T>,
}
impl<T: PartialEq> Default for Slice<T> {
    fn default() -> Self {
        Self { last: None }
    }
}
impl<T: PartialEq> Slice<T> {
    /// The new value when it differs from the last one (always the first
    /// time); it is remembered either way.
    pub fn changed(&mut self, next: T) -> Option<&T> {
        if self.last.as_ref() == Some(&next) {
            return None;
        }
        self.last = Some(next);
        self.last.as_ref()
    }
}

/// Runs `on_change` when the part `select` reads changes; writes to other
/// fields (and the writer's acknowledgements) do not reach it.
pub fn observe_slice<V: 'static, T: PartialEq + 'static>(
    store: &Entity<PreferencesStore>,
    select: impl Fn(&PreferencesStore) -> T + 'static,
    mut on_change: impl FnMut(&mut V, &T, &mut Context<V>) + 'static,
    cx: &mut Context<V>,
) -> Subscription {
    // The current value is what the observer already shows: only a later
    // change reaches it.
    let mut slice = Slice::default();
    slice.changed(select(store.read(cx)));
    cx.subscribe(store, move |this, store, _: &PreferencesChanged, cx| {
        let next = select(store.read(cx));
        if let Some(value) = slice.changed(next) {
            on_change(this, value, cx);
        }
    })
}

pub struct PreferencesStore {
    pub state: Preferences,
    pub loaded: bool,
    pub error: Option<String>,
    revision: u64,
    persisted: u64,
    active: bool,
    writer: Option<std::sync::mpsc::Sender<Write>>,
}
impl EventEmitter<PreferencesChanged> for PreferencesStore {}
impl PreferencesStore {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let (writer, rx) = preference_storage::start();
        cx.spawn(async move |this, cx| {
            while let Ok(event) = rx.recv().await {
                if this.update(cx, |s, cx| s.receive(event, cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        Self {
            state: Preferences::default(),
            loaded: false,
            error: None,
            revision: 0,
            persisted: 0,
            active: false,
            writer: Some(writer),
        }
    }
    pub fn memory() -> Self {
        Self {
            state: Preferences::default(),
            loaded: true,
            error: None,
            revision: 0,
            persisted: 0,
            active: false,
            writer: None,
        }
    }
    pub fn change(&mut self, edit: impl FnOnce(&mut Preferences), cx: &mut Context<Self>) {
        if !self.loaded {
            return;
        }
        let before = self.state.clone();
        edit(&mut self.state);
        self.state.create_new.normalize();
        if self.state == before {
            return;
        }
        self.revision += 1;
        self.error = None;
        self.pump();
        cx.emit(PreferencesChanged);
        cx.notify();
    }
    pub fn drained(&self) -> bool {
        self.writer.is_none() || (self.loaded && !self.active && self.persisted == self.revision)
    }
    pub fn retry(&mut self, cx: &mut Context<Self>) {
        self.error = None;
        self.pump();
        cx.notify();
    }
    fn pump(&mut self) {
        if self.active || !self.loaded || self.error.is_some() || self.revision == self.persisted {
            return;
        }
        if let Some(writer) = &self.writer {
            match writer.send(Write {
                revision: self.revision,
                value: serde_json::to_value(&self.state).expect("preference value"),
            }) {
                Ok(()) => self.active = true,
                Err(_) => {
                    self.error =
                        Some(crate::localization::t("native.preferences.storageStopped").into())
                }
            }
        }
    }
    fn receive(&mut self, event: Event, cx: &mut Context<Self>) {
        match event {
            Event::Loaded(result) => {
                match result {
                    Ok(Some(v)) => match Preferences::from_stored(v) {
                        Ok(p) => self.state = p,
                        Err(e) => self.error = Some(e.to_string()),
                    },
                    Ok(None) => {}
                    Err(e) => self.error = Some(e),
                }
                self.loaded = true;
                cx.emit(PreferencesChanged);
            }
            Event::Fresh(imported) => {
                self.loaded = true;
                // A first launch starts from the Electron product's
                // preferences and keeps them as its own from then on.
                if let Some(data) = imported {
                    self.state = super::electron_preferences::import(&data);
                    self.revision += 1;
                    self.pump();
                }
                cx.emit(PreferencesChanged);
            }
            Event::Saved(revision, result) => {
                self.active = false;
                match result {
                    Ok(()) => self.persisted = revision,
                    Err(e) => self.error = Some(e),
                }
                self.pump();
            }
        }
        cx.notify();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[gpui::test]
    fn preference_changes_coalesce_while_write_is_in_flight_and_quit_waits(
        cx: &mut TestAppContext,
    ) {
        let (tx, rx) = std::sync::mpsc::channel();
        let store = cx.new(|_| PreferencesStore {
            writer: Some(tx),
            ..PreferencesStore::memory()
        });
        store.update(cx, |s, cx| {
            s.change(|p| p.dark = false, cx);
            s.change(|p| p.locale = "zh-Hans".into(), cx);
            s.change(|p| p.project_switcher_rail = true, cx);
            assert!(!s.drained());
        });
        let first = rx.try_recv().unwrap();
        assert_eq!(first.revision, 1);
        assert!(rx.try_recv().is_err());
        store.update(cx, |s, cx| {
            s.receive(Event::Saved(first.revision, Ok(())), cx)
        });
        let latest = rx.try_recv().unwrap();
        assert_eq!(latest.revision, 3);
        assert_eq!(latest.value["locale"], "zh-Hans");
        assert_eq!(latest.value["project_switcher_rail"], true);
        store.update(cx, |s, cx| {
            s.receive(Event::Saved(latest.revision, Ok(())), cx);
            assert!(s.drained());
        });
    }
    #[gpui::test]
    fn failed_preferences_keep_changes_and_retry_the_latest_revision(cx: &mut TestAppContext) {
        let (tx, rx) = std::sync::mpsc::channel();
        let store = cx.new(|_| PreferencesStore {
            writer: Some(tx),
            ..PreferencesStore::memory()
        });
        store.update(cx, |s, cx| s.change(|p| p.dark = false, cx));
        let first = rx.try_recv().unwrap();
        store.update(cx, |s, cx| {
            s.receive(
                Event::Saved(first.revision, Err("read-only profile".into())),
                cx,
            );
            assert!(!s.state.dark);
            assert!(!s.drained());
            s.retry(cx);
        });
        let retry = rx.try_recv().unwrap();
        assert_eq!(retry.revision, first.revision);
        assert_eq!(retry.value["dark"], false);
    }
    #[gpui::test]
    fn a_slice_hears_only_changes_to_what_it_selects(cx: &mut TestAppContext) {
        struct Owner {
            heard: Vec<bool>,
        }
        let store = cx.new(|_| PreferencesStore::memory());
        let owner = cx.new(|cx| {
            observe_slice(
                &store,
                |s| s.state.sidebar_collapsed,
                |o: &mut Owner, collapsed, _| o.heard.push(*collapsed),
                cx,
            )
            .detach();
            Owner { heard: vec![] }
        });
        // Events arrive after each update, reading the state then.
        let change = |edit: fn(&mut Preferences), cx: &mut TestAppContext| {
            store.update(cx, |s, cx| s.change(edit, cx));
        };
        change(|p| p.sidebar_collapsed = true, cx);
        // Other fields are not heard.
        change(|p| p.locale = "zh-Hans".into(), cx);
        change(|p| p.explorer_width = 260., cx);
        change(|p| p.sidebar_collapsed = false, cx);
        owner.read_with(cx, |o, _| assert_eq!(o.heard, vec![true, false]));
    }
    #[test]
    fn preferences_roundtrip_preserves_menu_placement_and_defaults_new_fields() {
        let mut p: Preferences =
            serde_json::from_str(r#"{"locale":"zh-Hans","dark":false}"#).unwrap();
        p.create_new.move_entry(
            crate::features::create_new::create_entry_menu_registry::Entry::Text,
            crate::features::create_new::create_entry_menu_registry::Placement::Main,
            0,
        );
        let restored: Preferences =
            serde_json::from_value(serde_json::to_value(&p).unwrap()).unwrap();
        assert_eq!(p, restored);
        assert!(restored.header_changes);
    }
}
