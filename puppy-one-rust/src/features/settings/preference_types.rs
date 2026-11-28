//! Product preferences are independent of a window, filesystem, and controls.
//! Field defaults mirror `src/preferences.ts` / `localAgentPreferences.ts`.
use crate::features::create_new::MenuSettings;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}
impl ThemeMode {
    pub fn label_key(self) -> &'static str {
        match self {
            Self::System => "settings.appearance.theme.system",
            Self::Light => "settings.appearance.theme.light",
            Self::Dark => "settings.appearance.theme.dark",
        }
    }
    pub fn icon(self) -> &'static str {
        match self {
            Self::System => "monitor",
            Self::Light => "sun",
            Self::Dark => "moon",
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitSidebarLayout {
    #[default]
    Cards,
    Dividers,
}

pub use crate::model::DEFAULT_EXCLUDE_PATTERNS;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FilesVisibility {
    pub show_hidden_files: bool,
    pub exclude_patterns: Vec<String>,
}
impl Default for FilesVisibility {
    fn default() -> Self {
        Self {
            show_hidden_files: false,
            exclude_patterns: DEFAULT_EXCLUDE_PATTERNS.map(String::from).to_vec(),
        }
    }
}
/// `normalizeExplorerExcludePatterns`: one pattern per line or comma,
/// trimmed, `\` → `/`, leading `/` dropped, comments and duplicates removed.
pub fn normalize_patterns(text: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    text.split(['\n', ','])
        .map(|line| {
            line.trim()
                .replace('\\', "/")
                .trim_start_matches('/')
                .to_owned()
        })
        .filter(|p| !p.is_empty() && !p.starts_with('#') && seen.insert(p.clone()))
        .collect()
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LocalAgents {
    /// Local agent ids hidden from Chat/Terminal launchers.
    pub hidden_agent_ids: Vec<String>,
    pub chat_history_discovery: bool,
    /// `localAgentsSettings.setupSuggestions`.
    pub setup_suggestions: SetupSuggestions,
}
impl LocalAgents {
    /// Product ids stay in first-seen order, expand the retired WorkBuddy id,
    /// and consume at most 16 slots after validation and deduplication.
    pub fn normalize_hidden_ids(&mut self) {
        let mut seen = std::collections::HashSet::new();
        self.hidden_agent_ids = std::mem::take(&mut self.hidden_agent_ids)
            .into_iter()
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 80
                    && (id.as_bytes()[0].is_ascii_lowercase() || id.as_bytes()[0].is_ascii_digit())
                    && id.bytes().all(|b| {
                        b.is_ascii_lowercase()
                            || b.is_ascii_digit()
                            || matches!(b, b'.' | b'_' | b'-')
                    })
            })
            .flat_map(|id| {
                if id == "workbuddy" {
                    vec!["workbuddy-china".into(), "workbuddy-international".into()]
                } else {
                    vec![id]
                }
            })
            .filter(|id| seen.insert(id.clone()))
            .take(16)
            .collect();
    }
    /// `setTerminalAgentVisible`: shows or hides one launcher; the hidden ids
    /// stay sorted, so the same choices persist the same list.
    pub fn set_agent_visible(&mut self, id: &str, visible: bool) {
        self.hidden_agent_ids.retain(|hidden| hidden != id);
        if !visible {
            self.hidden_agent_ids.push(id.to_owned());
        }
        self.hidden_agent_ids.sort();
    }
}
/// `HeaderCoachmarkProgress`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct HeaderCoachmarks {
    pub agent: bool,
    pub changes: bool,
}
/// `LocalAgentSetupPreferences`: Agent suggestions from installed apps.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SetupSuggestions {
    pub enabled: bool,
    pub dismissed_setup_ids: Vec<String>,
    /// Setup id → milliseconds since the epoch.
    pub snoozed_until: std::collections::BTreeMap<String, u64>,
}
impl Default for SetupSuggestions {
    fn default() -> Self {
        Self {
            enabled: true,
            dismissed_setup_ids: vec![],
            snoozed_until: Default::default(),
        }
    }
}
/// `LOCAL_AGENT_INSTALLATION_IDS`.
pub const LOCAL_AGENT_INSTALLATION_IDS: [&str; 8] = [
    "codex",
    "claude",
    "cursor",
    "opencode",
    "pi",
    "workbuddy-china",
    "workbuddy-international",
    "hermes",
];
impl SetupSuggestions {
    /// `normalizeSetupPreferences`: known ids only, without duplicates.
    pub fn normalized(mut self) -> Self {
        let known = |id: &str| LOCAL_AGENT_INSTALLATION_IDS.contains(&id);
        let mut seen = std::collections::HashSet::new();
        self.dismissed_setup_ids
            .retain(|id| known(id) && seen.insert(id.clone()));
        self.snoozed_until.retain(|id, _| known(id));
        self
    }
}

/// Experimental Home page Space switching layout.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HomeSpaceLayout {
    /// Legacy vertical stack of all places and spaces.
    Classic,
    /// Scheme A (default): Arc-style horizontal swipeable Spaces with
    /// restrained tint, bottom floating Space dock, and quiet `+` menu.
    #[default]
    Arc,
    /// Scheme B: single-row pure-text editorial Tabs with quiet `+` and view
    /// menus tucked at the end of the same row (no secondary toolbar).
    Tabs,
}

/// `ExperimentalSettings` backed by native consumers (`project_switcher_rail`
/// keeps its earlier top-level field for stored-preference compatibility).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Experimental {
    /// `enableHostDevices`: the owner's other computers (`VITE_HOST_DEVICES_ENABLED`).
    pub host_devices: bool,
    pub always_show_onboarding_coachmarks: bool,
    pub editor_tabs_in_header: bool,
    /// Native only: no Header bar in a project window. The place and the
    /// project move to the bottom of the Explorer, the tools (Changes, the
    /// Agent entry, …) above the document, on its background.
    pub hidden_header: bool,
    /// Native only: experimental Home Space switching style (Classic / Arc / Tabs).
    pub home_space_layout: HomeSpaceLayout,
    /// Native only: hide Grid/List layout and Sort controls on Home.
    pub hide_home_view_controls: bool,
    /// Native only: offer "Start with Agent" (detected Local Agents) when
    /// creating a project. Off by default.
    pub start_with_agent: bool,
    pub markdown_block_drag: bool,
    pub other_app_imports: bool,
    pub cloud_workspace: bool,
    pub cloud_computer_screen: bool,
    /// `enableIsolatedAgentSandboxes`: show the per-project Tier 2 isolated
    /// Agent sandbox switch in Cloud Computer settings.
    pub isolated_agent_sandboxes: bool,
    /// `enableComputerMode`: Cloud spaces and this computer's workspaces
    /// shown as miniature computers with screens, plain folders kept quiet.
    pub computer_mode: bool,
    pub payments: bool,
    pub puppy_flow_files: bool,
}
impl Default for Experimental {
    fn default() -> Self {
        Self {
            host_devices: crate::features::flags::HOST_DEVICES_BUILD,
            always_show_onboarding_coachmarks: false,
            editor_tabs_in_header: false,
            hidden_header: true,
            home_space_layout: HomeSpaceLayout::Arc,
            hide_home_view_controls: true,
            start_with_agent: false,
            markdown_block_drag: false,
            other_app_imports: false,
            cloud_workspace: false,
            cloud_computer_screen: false,
            isolated_agent_sandboxes: false,
            computer_mode: false,
            // `DEFAULT_EXPERIMENTAL_SETTINGS.enablePayments`.
            payments: true,
            puppy_flow_files: false,
        }
    }
}

/// `requestedSubThemeIds` of the Default Root Theme.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SubThemeIds {
    pub light: String,
    pub dark: String,
}
impl Default for SubThemeIds {
    fn default() -> Self {
        Self {
            light: crate::theme::DEFAULT_PACK.into(),
            dark: crate::theme::DEFAULT_PACK.into(),
        }
    }
}
impl SubThemeIds {
    pub fn get(&self, dark: bool) -> &str {
        if dark { &self.dark } else { &self.light }
    }
    pub fn set(&mut self, dark: bool, id: String) {
        *(if dark {
            &mut self.dark
        } else {
            &mut self.light
        }) = id;
    }
    /// Retired ids map to their successors; an invalid id is the default.
    pub fn normalized(self) -> Self {
        let fix = |id: String| {
            normalize_sub_theme_id(&id).unwrap_or_else(|| crate::theme::DEFAULT_PACK.into())
        };
        Self {
            light: fix(self.light),
            dark: fix(self.dark),
        }
    }
}
/// `normalizeSubThemeId` + `isSubThemeId` (`subThemePreferences.ts`).
pub fn normalize_sub_theme_id(id: &str) -> Option<String> {
    let id = match id {
        "default" => "default.neutral",
        "builtin.markdown.newsprint"
        | "builtin.markdown.newspaper"
        | "builtin.pack.newsprint"
        | "builtin.pack.newspaper" => "default.newspaper",
        "builtin.pack.github" => "default.github",
        other => other,
    };
    // `^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$`
    let segments: Vec<&str> = id.split('.').collect();
    let valid = segments.len() >= 2
        && segments.iter().all(|s| {
            let mut chars = s.chars();
            chars.next().is_some_and(|c| c.is_ascii_lowercase())
                && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        });
    (valid && id != crate::platform::themes::service::LEGACY_CUSTOM_THEME_ID).then(|| id.to_owned())
}

/// One entry of the project open history (`useProjectOpenHistory`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: std::path::PathBuf,
    pub name: String,
    /// Seconds since the Unix epoch.
    pub opened_at: u64,
    /// `hostFolderId` (workspace registry v8): the id this folder was opened
    /// to the owner's other computers under, as recorded when it was shared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_folder: Option<String>,
    /// `fsIdentity` (`fs:<dev>:<ino>`), read while the folder is there, so a
    /// folder renamed where it was can be found again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fs_identity: Option<String>,
}
/// `HOMEPAGE_PROJECT_LAYOUTS`: how the Homepage arranges its projects.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HomepageLayout {
    List,
    #[default]
    Grid,
}
/// `RightSidebarSurface`: what the right sidebar shows, kept while it is
/// closed and across launches (whether it is open is not stored).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RightSidebarSurface {
    #[default]
    Chat,
    Changes,
    History,
}
/// `HOMEPAGE_PROJECT_SORTS`: how the Homepage orders its projects.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HomepageSort {
    #[default]
    Modified,
    Name,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Preferences {
    pub version: u32,
    /// A production locale id, or `system` to follow the OS language.
    pub locale: String,
    /// Legacy explicit theme flag; superseded by `theme_mode`.
    pub dark: bool,
    pub theme_mode: ThemeMode,
    /// `requestedSubThemeIds`: the Default interface's Sub Theme per colour
    /// mode (`default.neutral`, an installed `local.user.*`, …). An id that is
    /// missing or incompatible stays requested; the Neutral theme paints.
    pub sub_theme_ids: SubThemeIds,
    pub text_scale: crate::typography::Scale,
    /// The font half of `puppyone.desktop.typography` (no picker in the
    /// product; legacy and imported preferences still select).
    pub fonts: crate::typography::fonts::Selection,
    pub file_icon_theme: String,
    pub show_file_icons: bool,
    pub git_sidebar_layout: GitSidebarLayout,
    pub pointer_cursors: bool,
    pub header_changes: bool,
    pub header_terminal: bool,
    pub project_switcher_rail: bool,
    /// `explorerWidth` / `sidebarCollapsed` / `rightSidebarWidth`: the pane
    /// layout is one preference for every window, whichever folder is open.
    /// Widths are the expanded widths; the window's room bounds them above.
    pub explorer_width: f32,
    pub sidebar_collapsed: bool,
    pub right_sidebar_width: f32,
    /// `puppyone.desktop.rightSidebarSurface`.
    pub right_sidebar_surface: RightSidebarSurface,
    pub create_new: MenuSettings,
    pub files: FilesVisibility,
    pub local_agents: LocalAgents,
    /// `agentFileActivityIndicatorsEnabled`: show which files a Hooked
    /// terminal Agent reads and writes. Turned on when a Hook is installed.
    pub agent_file_activity_indicators: bool,
    /// `puppyone.desktop.agentRoutingPreferences.v1`.
    pub agent_routing: super::agent_routing_preferences::AgentRoutingPreferences,
    /// `puppyone.desktop.headerCoachmarks.v1`: introductions acknowledged.
    pub header_coachmarks: HeaderCoachmarks,
    pub experimental: Experimental,
    /// Every remembered project, most recent first; the list is never cut.
    pub recent_projects: Vec<RecentProject>,
    /// `puppyone.desktop.homepageProjectLayout`.
    pub homepage_project_layout: HomepageLayout,
    /// `puppyone.desktop.homepageProjectSort`.
    pub homepage_project_sort: HomepageSort,
    /// `puppyone.desktop.firstRunSignInCompleted.v1`.
    pub first_run_sign_in_completed: bool,
    /// `puppyone.desktop.copiedTemplateChecked.v1`: the clipboard was
    /// looked at once for a store link copied before installing.
    pub copied_template_checked: bool,
    /// `puppyone.desktop.explorer-pins.v1:<project>`: each project's pinned
    /// files, by its folder path (or its Cloud storage).
    pub explorer_pins: std::collections::BTreeMap<String, ExplorerPins>,
}
/// A file pinned above a project's tree: enough to open it again without
/// the tree loaded.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PinnedFile {
    /// Workspace-relative, `/`-separated.
    pub path: String,
    pub name: String,
}
/// `ExplorerPinsState`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ExplorerPins {
    pub files: Vec<PinnedFile>,
    /// The file tree under the pins is folded away.
    pub files_collapsed: bool,
}
fn same_or_under(path: &str, base: &str) -> bool {
    path == base
        || path
            .strip_prefix(base)
            .is_some_and(|rest| rest.starts_with('/'))
}
impl ExplorerPins {
    pub fn is_pinned(&self, path: &str) -> bool {
        self.files.iter().any(|f| f.path == path)
    }
    /// Pin, or unpin, a file.
    pub fn toggle(&mut self, path: &str) {
        if self.is_pinned(path) {
            self.files.retain(|f| f.path != path);
        } else {
            let name = path.rsplit('/').next().unwrap_or(path).to_owned();
            self.files.push(PinnedFile {
                path: path.to_owned(),
                name,
            });
        }
        self.settle();
    }
    /// A renamed or moved file, or anything under a moved folder, keeps its
    /// pin.
    pub fn rebase(&mut self, from: &str, to: &str) -> bool {
        let mut changed = false;
        for file in &mut self.files {
            if from != to && same_or_under(&file.path, from) {
                file.path = format!("{to}{}", &file.path[from.len()..]);
                file.name = file
                    .path
                    .rsplit('/')
                    .next()
                    .unwrap_or(&file.path)
                    .to_owned();
                changed = true;
            }
        }
        changed
    }
    /// A deleted file, or anything under a deleted folder, loses its pin.
    pub fn remove_under(&mut self, path: &str) -> bool {
        let before = self.files.len();
        self.files.retain(|f| !same_or_under(&f.path, path));
        self.settle();
        before != self.files.len()
    }
    pub fn set_files_collapsed(&mut self, collapsed: bool) {
        self.files_collapsed = collapsed;
        self.settle();
    }
    /// Folding the tree means nothing without pins.
    fn settle(&mut self) {
        self.files_collapsed &= !self.files.is_empty();
    }
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            version: 2,
            locale: "system".into(),
            dark: true,
            theme_mode: ThemeMode::System,
            sub_theme_ids: SubThemeIds::default(),
            text_scale: crate::typography::Scale::Medium,
            fonts: Default::default(),
            file_icon_theme: "default".into(),
            show_file_icons: true,
            git_sidebar_layout: GitSidebarLayout::Cards,
            pointer_cursors: false,
            header_changes: true,
            header_terminal: true,
            project_switcher_rail: false,
            explorer_width: crate::theme::pane::DEFAULT_EXPLORER_WIDTH,
            sidebar_collapsed: false,
            right_sidebar_width: crate::theme::pane::DEFAULT_RIGHT_SIDEBAR_WIDTH,
            right_sidebar_surface: RightSidebarSurface::Chat,
            create_new: MenuSettings::default(),
            files: FilesVisibility::default(),
            local_agents: LocalAgents::default(),
            agent_file_activity_indicators: false,
            agent_routing: Default::default(),
            header_coachmarks: HeaderCoachmarks::default(),
            experimental: Experimental::default(),
            recent_projects: vec![],
            homepage_project_layout: HomepageLayout::Grid,
            homepage_project_sort: HomepageSort::Modified,
            first_run_sign_in_completed: false,
            copied_template_checked: false,
            explorer_pins: Default::default(),
        }
    }
}
impl Preferences {
    /// Read a stored value, upgrading version-1 files whose only theme
    /// choice was the explicit `dark` flag.
    pub fn from_stored(value: serde_json::Value) -> Result<Self, serde_json::Error> {
        let legacy = value.get("theme_mode").is_none();
        let legacy_dark = value.get("dark").and_then(|v| v.as_bool());
        let legacy_locale = value.get("version").and_then(|v| v.as_u64()) == Some(1);
        // Before per-mode selections one `theme_pack` served both modes.
        let legacy_pack = value
            .get("sub_theme_ids")
            .is_none()
            .then(|| {
                value
                    .get("theme_pack")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned)
            })
            .flatten();
        let mut p: Self = serde_json::from_value(value)?;
        if let Some(pack) = legacy_pack {
            p.sub_theme_ids = SubThemeIds {
                light: pack.clone(),
                dark: pack,
            };
        }
        p.sub_theme_ids = std::mem::take(&mut p.sub_theme_ids).normalized();
        if legacy && let Some(dark) = legacy_dark {
            p.theme_mode = if dark {
                ThemeMode::Dark
            } else {
                ThemeMode::Light
            };
        }
        if legacy_locale && p.locale.is_empty() {
            p.locale = "system".into();
        }
        p.version = 2;
        p.create_new.normalize();
        p.local_agents.normalize_hidden_ids();
        p.local_agents.setup_suggestions =
            std::mem::take(&mut p.local_agents.setup_suggestions).normalized();
        p.agent_routing = p.agent_routing.normalized();
        p.file_icon_theme = crate::file_kind::parse_theme(Some(&p.file_icon_theme))
            .unwrap_or(crate::file_kind::default_theme())
            .into();
        // `readInitialExplorerWidth` / `readInitialRightSidebarWidth`: whole
        // pixels, never below the pane's minimum.
        p.explorer_width = stored_width(
            p.explorer_width,
            crate::theme::pane::MIN_EXPLORER_WIDTH,
            crate::theme::pane::DEFAULT_EXPLORER_WIDTH,
        );
        p.right_sidebar_width = stored_width(
            p.right_sidebar_width,
            crate::theme::pane::MIN_RIGHT_SIDEBAR_WIDTH,
            crate::theme::pane::DEFAULT_RIGHT_SIDEBAR_WIDTH,
        );
        Ok(p)
    }
    /// Remember an opened folder at the head of the history; a name given
    /// with Rename stays (`withPreservedDisplayName`).
    /// `addRecentWorkspacePaths`: folders listed where they are, in the
    /// order given, ahead of the others; a folder already listed keeps its
    /// place.
    pub fn add_recent_projects(&mut self, paths: &[std::path::PathBuf], now: u64) {
        let mut added = Vec::new();
        for path in paths {
            if self
                .recent_projects
                .iter()
                .chain(&added)
                .any(|p: &RecentProject| p.path == *path)
            {
                continue;
            }
            added.push(RecentProject {
                path: path.clone(),
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.display().to_string()),
                opened_at: now,
                host_folder: None,
                fs_identity: None,
            });
        }
        self.recent_projects.splice(0..0, added);
    }
    /// `relocateRecentWorkspacePath`: the project lives at `to` now, under
    /// its new name, in its place on the list. Sharing named the old place,
    /// so it does not follow; `true` when it had been shared.
    pub fn relocate_project(&mut self, from: &std::path::Path, to: &std::path::Path) -> bool {
        let Some(index) = self.recent_projects.iter().position(|p| p.path == from) else {
            return false;
        };
        let record = &mut self.recent_projects[index];
        let was_shared = record.host_folder.take().is_some();
        // A name given with Rename is the project's, not the folder's.
        let folder_name = |path: &std::path::Path| {
            path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.display().to_string())
        };
        if record.name == folder_name(from) {
            record.name = folder_name(to);
        }
        record.path = to.to_path_buf();
        record.fs_identity = None;
        let mut position = 0;
        self.recent_projects.retain(|p| {
            let keep = position == index || p.path != to;
            position += 1;
            keep
        });
        was_shared
    }
    /// `rememberRecentWorkspacePath` for a folder with its file-system
    /// identity: a remembered project whose folder is `gone` and had that
    /// identity has moved here, so it follows instead of being listed twice.
    pub fn remember_found_project(
        &mut self,
        path: &std::path::Path,
        identity: Option<String>,
        now: u64,
        gone: impl Fn(&std::path::Path) -> bool,
    ) {
        if let Some(identity) = &identity
            && let Some(from) = self
                .recent_projects
                .iter()
                .find(|p| {
                    p.path != path && p.fs_identity.as_ref() == Some(identity) && gone(&p.path)
                })
                .map(|p| p.path.clone())
        {
            self.relocate_project(&from, path);
        }
        self.remember_project(path, now);
        if identity.is_some() {
            self.recent_projects[0].fs_identity = identity;
        }
    }
    pub fn remember_project(&mut self, path: &std::path::Path, now: u64) {
        let name = self
            .recent_projects
            .iter()
            .find(|p| p.path == path)
            .map(|p| p.name.clone())
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| {
                path.file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.display().to_string())
            });
        // Sharing is the folder's, so it outlives a reopening.
        let host_folder = self
            .recent_projects
            .iter()
            .find(|p| p.path == path)
            .and_then(|p| p.host_folder.clone());
        let fs_identity = self
            .recent_projects
            .iter()
            .find(|p| p.path == path)
            .and_then(|p| p.fs_identity.clone());
        self.recent_projects.retain(|p| p.path != path);
        self.recent_projects.insert(
            0,
            RecentProject {
                path: path.to_owned(),
                name,
                opened_at: now,
                host_folder,
                fs_identity,
            },
        );
    }
    /// `markWorkspaceShared`: the id `path` is open to the owner's other
    /// computers under, or none once it is not.
    pub fn mark_shared(&mut self, path: &std::path::Path, folder: Option<String>) {
        if let Some(project) = self.recent_projects.iter_mut().find(|p| p.path == path) {
            project.host_folder = folder;
        }
    }
    /// `renameRecentWorkspacePath`: the shown name only; an empty name or
    /// one with control characters is refused.
    pub fn rename_project(&mut self, path: &std::path::Path, name: &str) {
        let name = name.trim();
        if let Some(project) = self.recent_projects.iter_mut().find(|p| p.path == path)
            && supported_project_name(name)
        {
            project.name = name.chars().take(120).collect();
        }
    }
    pub fn forget_project(&mut self, path: &std::path::Path) {
        self.recent_projects.retain(|p| p.path != path);
    }
    /// A project's pins; changing them to none forgets the project's entry.
    pub fn change_pins(&mut self, project: &str, change: impl FnOnce(&mut ExplorerPins)) {
        let mut pins = self.explorer_pins.remove(project).unwrap_or_default();
        change(&mut pins);
        if !pins.files.is_empty() {
            self.explorer_pins.insert(project.to_owned(), pins);
        }
    }
    pub fn agent_visible(&self, id: &str) -> bool {
        !self.local_agents.hidden_agent_ids.iter().any(|h| h == id)
    }
}

/// `normalizeWorkspaceDisplayName`: something besides spaces, and no
/// control characters.
pub fn supported_project_name(name: &str) -> bool {
    !name.trim().is_empty() && !name.chars().any(char::is_control)
}

fn stored_width(width: f32, minimum: f32, default: f32) -> f32 {
    if width.is_finite() {
        width.round().max(minimum)
    } else {
        default
    }
}

#[cfg(test)]
mod tests {
    /// `shows detected Agents in Terminal by default and persists only
    /// hidden launchers`; `keeps hidden launcher ids stable and sorted`.
    #[test]
    fn launchers_show_by_default_and_only_sorted_hidden_ids_persist() {
        let mut p = super::Preferences::default();
        assert!(p.agent_visible("codex"));
        p.local_agents.set_agent_visible("codex", false);
        assert_eq!(p.local_agents.hidden_agent_ids, ["codex"]);
        assert!(!p.agent_visible("codex"));
        assert!(!p.local_agents.chat_history_discovery);
        p.local_agents.set_agent_visible("codex", true);
        assert!(p.local_agents.hidden_agent_ids.is_empty());
        p.local_agents.chat_history_discovery = true;
        p.local_agents.set_agent_visible("opencode", false);
        p.local_agents.set_agent_visible("claude", false);
        assert_eq!(p.local_agents.hidden_agent_ids, ["claude", "opencode"]);
        assert!(p.local_agents.chat_history_discovery);
    }

    #[test]
    fn loading_material_migrates_without_discarding_other_preferences() {
        for value in [
            serde_json::json!({"loading_animation":"ikun", "locale":"ja", "file_icon_theme":"classic"}),
            serde_json::json!({"loading_style":"retired", "locale":"ja", "file_icon_theme":"classic"}),
            serde_json::json!({"loading_style":"dither", "locale":"ja", "file_icon_theme":"classic"}),
        ] {
            let p = super::Preferences::from_stored(value).unwrap();
            assert_eq!(p.locale, "ja");
            assert_eq!(p.file_icon_theme, "default");
            assert!(
                serde_json::to_value(&p)
                    .unwrap()
                    .get("loading_style")
                    .is_none()
            );
        }
    }
    use super::*;
    #[test]
    fn a_renamed_project_keeps_its_name_when_opened_again() {
        let mut p = Preferences::default();
        let path = std::path::Path::new("/p/notes");
        p.remember_project(path, 1);
        assert_eq!(p.recent_projects[0].name, "notes");
        p.rename_project(path, "  Field notes ");
        assert_eq!(p.recent_projects[0].name, "Field notes");
        p.remember_project(path, 2);
        assert_eq!(p.recent_projects[0].name, "Field notes");
        assert_eq!(p.recent_projects[0].opened_at, 2);
        p.rename_project(path, "   ");
        assert_eq!(p.recent_projects[0].name, "Field notes");
        p.rename_project(path, "bad\u{0}name");
        p.rename_project(path, "tab\tname");
        assert_eq!(p.recent_projects[0].name, "Field notes");
    }

    /// `workspace registry lifecycle`: interleaved remembering and
    /// forgetting, a folder that is gone, and folders that moved.
    #[test]
    fn the_project_list_follows_moved_folders_and_never_resurrects_a_removed_one() {
        let path = |name: &str| std::path::PathBuf::from(format!("/p/{name}"));
        let mut p = Preferences::default();
        for i in 0..8 {
            p.remember_project(&path(&format!("original-{i}")), i);
        }
        for i in 0..8 {
            if i < 4 {
                p.forget_project(&path(&format!("original-{i}")));
            }
            p.remember_project(&path(&format!("added-{i}")), 10 + i);
        }
        let listed: std::collections::HashSet<_> =
            p.recent_projects.iter().map(|r| r.path.clone()).collect();
        assert_eq!(listed.len(), 12);
        assert!((0..4).all(|i| !listed.contains(&path(&format!("original-{i}")))));
        assert!((4..8).all(|i| listed.contains(&path(&format!("original-{i}")))));
        // A project whose folder is gone is still removed by its path.
        p.forget_project(&path("original-4"));
        assert_eq!(p.recent_projects.len(), 11);

        // Moved: who it is stays (its name and when it was opened), its
        // sharing does not; a folder's own name follows the folder.
        let mut p = Preferences::default();
        p.remember_project(&path("kept"), 1);
        p.remember_project(&path("moved"), 2);
        p.rename_project(&path("moved"), "Ambassadors");
        p.mark_shared(
            &path("moved"),
            Some("11111111-1111-4111-8111-111111111111".into()),
        );
        assert!(p.relocate_project(&path("moved"), &path("moved-here")));
        let moved = &p.recent_projects[0];
        assert_eq!(
            (
                moved.path.clone(),
                moved.name.as_str(),
                moved.opened_at,
                moved.host_folder.clone()
            ),
            (path("moved-here"), "Ambassadors", 2, None)
        );
        assert!(
            !p.relocate_project(&path("kept"), &path("kept-2")),
            "it was not shared"
        );
        assert_eq!(p.recent_projects[1].name, "kept-2");
        // The new place already listed: one entry, never two.
        p.remember_project(&path("existing"), 3);
        p.relocate_project(&path("moved-here"), &path("existing"));
        assert_eq!(
            p.recent_projects
                .iter()
                .filter(|r| r.path == path("existing"))
                .count(),
            1
        );

        // Opened again at its new place, a folder is known by its identity.
        let mut p = Preferences::default();
        p.remember_found_project(&path("before"), Some("fs:1:99".into()), 1, |_| false);
        p.remember_found_project(&path("after"), Some("fs:1:99".into()), 2, |p| {
            p.ends_with("before")
        });
        assert_eq!(p.recent_projects.len(), 1);
        assert_eq!(p.recent_projects[0].path, path("after"));
        assert_eq!(p.recent_projects[0].fs_identity.as_deref(), Some("fs:1:99"));
        // The same identity at a folder that is still there is another copy.
        p.remember_found_project(&path("copy"), Some("fs:1:99".into()), 3, |_| false);
        assert_eq!(p.recent_projects.len(), 2);
    }
    #[test]
    fn legacy_theme_flag_becomes_an_explicit_mode_and_new_fields_default() {
        let p = Preferences::from_stored(serde_json::json!({"version":1,"dark":false})).unwrap();
        assert_eq!(p.theme_mode, ThemeMode::Light);
        assert_eq!(p.files.exclude_patterns.len(), 6);
        let fresh = Preferences::from_stored(serde_json::json!({})).unwrap();
        assert_eq!(fresh.theme_mode, ThemeMode::System);
        assert!(fresh.show_file_icons);
        assert_eq!(
            normalize_patterns(" /a\\b \n#c\n**/x, **/x\n"),
            vec!["a/b".to_string(), "**/x".to_string()]
        );
    }
    #[test]
    fn hidden_file_icons_survive_preference_reload() {
        let p = Preferences::from_stored(serde_json::json!({
            "show_file_icons": false,
            "file_icon_theme": "default",
            "locale": "zh-Hans"
        }))
        .unwrap();
        let restored = Preferences::from_stored(serde_json::to_value(p).unwrap()).unwrap();
        assert!(!restored.show_file_icons);
        assert_eq!(restored.file_icon_theme, "default");
        assert_eq!(restored.locale, "zh-Hans");
    }
    #[test]
    fn project_history_is_most_recent_first_and_keeps_every_project() {
        let mut p = Preferences::default();
        for i in 0..25 {
            p.remember_project(std::path::Path::new(&format!("/p/{i}")), i);
        }
        p.remember_project(std::path::Path::new("/p/10"), 99);
        // a4e796b01: the list keeps every project, not the latest twenty.
        assert_eq!(p.recent_projects.len(), 25);
        assert_eq!(p.recent_projects[0].name, "10");
        assert_eq!(
            p.recent_projects.iter().filter(|r| r.name == "10").count(),
            1
        );
    }

    #[test]
    fn stored_pane_widths_are_whole_pixels_within_the_minimum() {
        let p = Preferences::from_stored(serde_json::json!({
            "explorer_width": 251.6,
            "right_sidebar_width": 100.0,
            "sidebar_collapsed": true,
        }))
        .unwrap();
        assert_eq!((p.explorer_width, p.right_sidebar_width), (252., 320.));
        assert!(p.sidebar_collapsed);
        // Large preferences stay for the live layout to bound.
        let wide = Preferences::from_stored(serde_json::json!({
            "explorer_width": 900.0,
            "right_sidebar_width": 1400.0,
        }))
        .unwrap();
        assert_eq!(
            (wide.explorer_width, wide.right_sidebar_width),
            (900., 1400.)
        );
        let fresh = Preferences::from_stored(serde_json::json!({ "version": 2 })).unwrap();
        assert_eq!(
            (
                fresh.explorer_width,
                fresh.sidebar_collapsed,
                fresh.right_sidebar_width
            ),
            (320., false, 560.)
        );
    }

    #[test]
    fn retired_experimental_fields_in_stored_preferences_are_ignored() {
        let p = Preferences::from_stored(serde_json::json!({
            "version": 2,
            "experimental": {
                "cloud_workspace": true,
                "git_auto_commit": true,
                "viewer_plugins": true,
                "markdown_heading_outline": true,
                "multi_root_workspaces": true,
                "workbench_tabs_in_header": true,
                "project_reach": true
            }
        }))
        .unwrap();
        assert!(p.experimental.cloud_workspace);
        let serialized = serde_json::to_value(&p.experimental).unwrap();
        for retired in [
            "git_auto_commit",
            "viewer_plugins",
            "markdown_heading_outline",
            "multi_root_workspaces",
            "workbench_tabs_in_header",
            "project_reach",
        ] {
            assert!(
                serialized.get(retired).is_none(),
                "{retired} should be omitted"
            );
        }
    }
}
