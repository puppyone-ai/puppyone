//! Product preferences are independent of a window, filesystem, and controls.
//! Field defaults mirror `src/preferences.ts` / `localAgentPreferences.ts`.
use crate::features::create_new::create_entry_menu_registry::MenuSettings;
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

pub const DEFAULT_EXCLUDE_PATTERNS: [&str; 6] = [
    "**/.git",
    "**/.puppyone",
    "**/.svn",
    "**/.hg",
    "**/.DS_Store",
    "**/Thumbs.db",
];
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

/// `ExperimentalSettings` except `enableProjectSwitcherRail`, which keeps its
/// earlier top-level field for stored-preference compatibility.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Experimental {
    pub project_reach: bool,
    pub workbench_tabs_in_header: bool,
    pub share_onboarding: bool,
    pub multi_root_workspaces: bool,
    pub always_show_onboarding_coachmarks: bool,
    pub editor_tabs_in_header: bool,
    pub markdown_block_drag: bool,
    pub markdown_heading_outline: bool,
    pub other_app_imports: bool,
    pub viewer_plugins: bool,
    pub cloud_workspace: bool,
    pub payments: bool,
    pub puppy_flow_files: bool,
    pub git_auto_commit: bool,
}
impl Default for Experimental {
    fn default() -> Self {
        Self {
            project_reach: false,
            workbench_tabs_in_header: false,
            share_onboarding: true,
            multi_root_workspaces: false,
            always_show_onboarding_coachmarks: false,
            editor_tabs_in_header: false,
            markdown_block_drag: false,
            markdown_heading_outline: false,
            other_app_imports: false,
            viewer_plugins: false,
            cloud_workspace: false,
            // `DEFAULT_EXPERIMENTAL_SETTINGS.enablePayments`.
            payments: true,
            puppy_flow_files: false,
            git_auto_commit: false,
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
    /// Shared material for every loading mark and placeholder. Old PulseGrid
    /// preferences are ignored; absent / unknown styles default to rounded.
    pub loading_style: crate::ui::loading::LoadingStyle,
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
            loading_style: Default::default(),
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
        self.recent_projects.retain(|p| p.path != path);
        self.recent_projects.insert(
            0,
            RecentProject {
                path: path.to_owned(),
                name,
                opened_at: now,
            },
        );
    }
    /// `renameRecentWorkspacePath`: the shown name only.
    pub fn rename_project(&mut self, path: &std::path::Path, name: &str) {
        let name = name.trim();
        if let Some(project) = self.recent_projects.iter_mut().find(|p| p.path == path)
            && !name.is_empty()
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

fn stored_width(width: f32, minimum: f32, default: f32) -> f32 {
    if width.is_finite() {
        width.round().max(minimum)
    } else {
        default
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn loading_material_migrates_without_discarding_other_preferences() {
        use crate::ui::loading::LoadingStyle;
        for value in [
            serde_json::json!({"loading_animation":"ikun", "locale":"ja", "file_icon_theme":"classic"}),
            serde_json::json!({"loading_style":"retired", "locale":"ja", "file_icon_theme":"classic"}),
        ] {
            let p = super::Preferences::from_stored(value).unwrap();
            assert_eq!(p.loading_style, LoadingStyle::Rounded);
            assert_eq!(p.locale, "ja");
            assert_eq!(p.file_icon_theme, "default");
        }
        let p =
            super::Preferences::from_stored(serde_json::json!({"loading_style":"dither"})).unwrap();
        assert_eq!(p.loading_style, LoadingStyle::Dither);
        let restored = super::Preferences::from_stored(serde_json::to_value(p).unwrap()).unwrap();
        assert_eq!(restored.loading_style, LoadingStyle::Dither);
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
    }
    #[test]
    fn legacy_theme_flag_becomes_an_explicit_mode_and_new_fields_default() {
        let p = Preferences::from_stored(serde_json::json!({"version":1,"dark":false})).unwrap();
        assert_eq!(p.theme_mode, ThemeMode::Light);
        assert_eq!(p.files.exclude_patterns.len(), 6);
        assert!(p.experimental.share_onboarding);
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
}
