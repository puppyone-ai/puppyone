//! `importSourceRegistry.ts` over `shared/project-import/sources.mjs`: one
//! registration manifest for every way to bring work in, shared by the
//! Homepage's import dialog and Settings › Other app imports.
use crate::platform::repository_import::Provider;

/// `ImportSourceDescriptor.mode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Repository(Provider),
    Remote,
    App,
}
/// `ImportSourceDescriptor`.
#[derive(Debug, PartialEq, Eq)]
pub struct Source {
    pub id: &'static str,
    pub label: &'static str,
    pub mode: Mode,
    /// `availability: "ready"`; the rest wait for the experiment.
    pub ready: bool,
    pub operational: bool,
    pub preview: bool,
}
/// `LOCAL_IMPORT_SOURCES` (`shared/project-import/sources.mjs`), in order.
pub const SOURCES: [Source; 9] = [
    Source {
        id: "github",
        label: "GitHub",
        mode: Mode::Repository(Provider::GitHub),
        ready: true,
        operational: true,
        preview: true,
    },
    Source {
        id: "gitlab",
        label: "GitLab",
        mode: Mode::Repository(Provider::GitLab),
        ready: true,
        operational: true,
        preview: true,
    },
    Source {
        id: "notion",
        label: "Notion",
        mode: Mode::Remote,
        ready: false,
        operational: false,
        preview: true,
    },
    Source {
        id: "google-drive",
        label: "Google Drive",
        mode: Mode::Remote,
        ready: false,
        operational: false,
        preview: true,
    },
    Source {
        id: "obsidian",
        label: "Obsidian",
        mode: Mode::App,
        ready: false,
        operational: true,
        preview: true,
    },
    Source {
        id: "vscode",
        label: "VS Code",
        mode: Mode::App,
        ready: false,
        operational: true,
        preview: false,
    },
    Source {
        id: "cursor",
        label: "Cursor",
        mode: Mode::App,
        ready: false,
        operational: true,
        preview: false,
    },
    Source {
        id: "typora",
        label: "Typora",
        mode: Mode::App,
        ready: false,
        operational: true,
        preview: false,
    },
    Source {
        id: "airtable",
        label: "Airtable",
        mode: Mode::Remote,
        ready: false,
        operational: false,
        preview: true,
    },
];
/// `resolveVisibleImportSources`.
pub fn visible(other_apps: bool) -> impl Iterator<Item = &'static Source> {
    SOURCES.iter().filter(move |s| s.ready || other_apps)
}

/// The first three usable product marks shown on the import entry.
pub fn preview(other_apps: bool) -> impl Iterator<Item = &'static Source> {
    visible(other_apps)
        .filter(|s| s.operational && s.preview)
        .take(3)
}
