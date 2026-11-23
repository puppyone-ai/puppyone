//! View preferences kept between openings (the product's `localStorage`
//! view preferences): one JSON document per preference in the editor's
//! data directory. Best effort: a failed read or write never blocks editing.
use crate::editor::markdown::platform::sessions::column_layout::Storage;
use std::path::PathBuf;

/// A preference document in the editor's data directory.
pub struct FileStorage(PathBuf);

impl FileStorage {
    /// `name` under `<data dir>/editor/`.
    pub fn named(name: &str) -> Self {
        Self(crate::platform::data_dir().join("editor").join(name))
    }
}

impl Storage for FileStorage {
    fn get(&self) -> Option<String> {
        std::fs::read_to_string(&self.0).ok()
    }

    fn set(&self, value: &str) {
        if let Some(parent) = self.0.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&self.0, value);
    }
}
