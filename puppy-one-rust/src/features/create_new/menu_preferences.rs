//! The product's v2-v5 persisted menu layouts, converted at first launch.
use super::{Entry, MenuSettings, Placement};
use serde_json::Value;

fn entry(value: &Value) -> Option<Entry> {
    serde_json::from_value::<Entry>(value.clone())
        .ok()
        .filter(|e| Entry::ITEMS.contains(e))
}

impl MenuSettings {
    /// `resolveVisibleCreateNewMenuItems`: native format support is a later
    /// enablement decision; this projection only applies the product experiment.
    pub fn visible(&self, puppy_flow_files: bool) -> (Vec<Entry>, Vec<Entry>) {
        let available = |entry: &Entry| *entry != Entry::Puppyflow || puppy_flow_files;
        let submenu: Vec<_> = self.submenu.iter().copied().filter(available).collect();
        let main = self
            .main
            .iter()
            .copied()
            .filter(|entry| {
                if *entry == Entry::CustomFiles {
                    !submenu.is_empty()
                } else {
                    available(entry)
                }
            })
            .collect();
        (main, submenu)
    }

    /// `parseCreateNewMenuSettings`: placement is retained independently of
    /// native format availability. Importing a preference grants no capability.
    pub fn from_electron(stored: Option<&str>) -> Self {
        let Some(value) = stored
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .filter(Value::is_object)
        else {
            return Self::default();
        };
        if value.get("version").and_then(Value::as_f64) == Some(5.0) {
            let group = |name: &str, main: bool| {
                value
                    .get(name)
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|v| {
                        if main && v.as_str() == Some("customFiles") {
                            Some(Entry::CustomFiles)
                        } else {
                            entry(v)
                        }
                    })
                    .collect()
            };
            let mut layout = Self {
                main: group("main", true),
                submenu: group("submenu", false),
                hidden: group("hidden", false),
            };
            layout.normalize();
            return layout;
        }
        let Some(items) = value.get("items").and_then(Value::as_array) else {
            return Self::default();
        };
        let mut seen = Vec::new();
        let mut legacy = Vec::new();
        for raw in items {
            let Some(kind) = raw.get("kind").and_then(entry) else {
                continue;
            };
            if seen.contains(&kind) {
                continue;
            }
            seen.push(kind);
            let enabled = raw.get("enabled") != Some(&Value::Bool(false));
            let placement = match raw.get("placement").and_then(Value::as_str) {
                Some("main") => Placement::Main,
                Some("submenu") => Placement::Submenu,
                _ if matches!(
                    kind,
                    Entry::Markdown | Entry::Csv | Entry::Html | Entry::Whiteboard
                ) =>
                {
                    Placement::Main
                }
                _ => Placement::Submenu,
            };
            legacy.push((kind, enabled, placement));
        }
        if !items.is_empty() && legacy.is_empty() {
            return Self::default();
        }
        let enabled: Vec<_> = legacy
            .iter()
            .filter_map(|(kind, on, _)| on.then_some(*kind))
            .collect();
        if [
            &[Entry::Markdown, Entry::Csv][..],
            &[Entry::Markdown, Entry::Csv, Entry::Html, Entry::Slides],
            &[
                Entry::Markdown,
                Entry::ContextMap,
                Entry::Csv,
                Entry::Html,
                Entry::Slides,
            ],
        ]
        .contains(&enabled.as_slice())
        {
            return Self::default();
        }
        let mut layout = Self {
            main: vec![],
            submenu: vec![],
            hidden: vec![],
        };
        for (kind, enabled, placement) in legacy {
            layout
                .group_mut(if enabled {
                    placement
                } else {
                    Placement::Hidden
                })
                .push(kind);
        }
        layout.normalize();
        layout
    }
}
