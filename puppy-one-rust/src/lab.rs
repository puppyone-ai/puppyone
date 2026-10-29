//! Dev-capture pixel lab: a borderless window that renders one product surface
//! with fixture data, captures it and quits. `PUPPYONE_LAB=<scenario>-<mode>`
//! matches the reference cases of `tools/reference-workbench.mjs`, so native
//! and product renders are compared at the same viewport and DPR.
//!
//! - `<workbench scenario>-<mode>`: the right sidebar (`tools/workbench-scenarios.json`).
//! - `gallery[-dialog]-<mode>`: the component library (`ui::gallery`).
//! - `settings-<section>-<mode>`: `SettingsDialog` on one page over the task
//!   backdrop (`tools/settings-scenarios.json`).
//! - `cloud-<scenario>-<mode>`: Cloud surfaces over `fixtures/cloud-history.json`
//!   (`tools/cloud-scenarios.json`).
//! - `editor-<scenario>-<mode>`: one editor pane over a `fixtures/editor`
//!   document (`tools/editor-scenarios.json`, `tools/reference-editor.mjs`).
use crate::{
    features::{
        settings::{Page, SettingsWorkspaceSurface, preferences_store::PreferencesStore},
        workbench::Workbench,
    },
    theme,
};
use gpui::{prelude::*, *};
use std::path::PathBuf;

enum Surface {
    /// `agent-presence`: the four file-presence pills.
    Presence,
    Assets(Entity<crate::ui::asset_gallery::AssetGallery>),
    CloudHistory(Entity<crate::features::source_control::CloudHistory>),
    Editor(Entity<crate::editor::host::DocumentEditor>),
    Gallery(Entity<crate::ui::gallery::Gallery>),
    Workbench(Entity<Workbench>),
    Settings(Entity<SettingsWorkspaceSurface>),
}

pub struct Lab {
    surface: Surface,
    /// Neutral focus: the reference blurs `document.activeElement` before
    /// capturing, so no control may hold keyboard focus here either.
    focus: FocusHandle,
    dark: bool,
    captured: bool,
    frames: u32,
}

static CLOCK: std::sync::OnceLock<i64> = std::sync::OnceLock::new();
/// The fixture's fixed time (seconds) in the pixel lab, so relative times and
/// day groups match the reference's clock.
pub fn clock() -> Option<i64> {
    CLOCK.get().copied()
}
/// True in the pixel lab: finite attention animations render at rest, as
/// the reference finishes them before capturing (`tools/reference-workbench.mjs`).
pub fn settled() -> bool {
    std::env::var_os("PUPPYONE_LAB").is_some()
}

/// Product `SettingsSection` id → native page.
fn settings_page(section: &str) -> Option<Page> {
    Some(match section {
        "account" => Page::Account,
        "seats" => Page::Plan,
        "general" => Page::General,
        "appearance" => Page::Appearance,
        "typography" => Page::Typography,
        "new-menu" => Page::CreateNew,
        "other-app-imports" => Page::OtherAppImports,
        "privacy" => Page::Privacy,
        "experimental" => Page::Experimental,
        "local-agents" | "agent-hooks" | "agent-activation" => Page::LocalAgents,
        "model-connections" => Page::ModelConnections,
        "local-project" => Page::Project,
        "cloud" => Page::Host,
        "git" | "git-remotes" => Page::Git,
        "files" => Page::Files,
        _ => return None,
    })
}

impl Lab {
    pub fn new(case: &str, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let dark = !case.ends_with("-light");
        let scenario = case
            .trim_end_matches("-light")
            .trim_end_matches("-dark")
            .to_owned();
        crate::ui::appearance::Appearance::default()
            .with_dark(dark)
            .apply(Some(window), cx);
        cx.set_reduce_motion(std::env::var("PUPPYONE_REDUCE_MOTION").as_deref() == Ok("1"));
        // References render with the account available and signed out.
        crate::features::cloud_account::install_offline(cx);
        let gallery = scenario.strip_prefix("gallery");
        let editor_file = scenario.strip_prefix("editor-").and_then(|case| {
            Some(match case {
                "code" => ("sample.ts", include_str!("../fixtures/editor/sample.ts")),
                "json" => (
                    "sample.json",
                    include_str!("../fixtures/editor/sample.json"),
                ),
                "md" => ("sample.md", include_str!("../fixtures/editor/sample.md")),
                "csv" => ("sample.csv", include_str!("../fixtures/editor/sample.csv")),
                "html-edit" => (
                    "sample.html",
                    include_str!("../fixtures/editor/sample.html"),
                ),
                _ => return None,
            })
        });
        // Resource viewers read the fixture file itself.
        let editor_resource = scenario.strip_prefix("editor-").and_then(|case| {
            Some(match case {
                "image" => "sample.png",
                "image-broken" => "broken.png",
                "binary" => "archive.bin",
                _ => return None,
            })
        });
        let surface = if scenario == "agent-presence" {
            // The pills breathe forever; the reference pauses them at rest.
            cx.set_reduce_motion(true);
            Surface::Presence
        } else if let Some(name) = editor_resource {
            let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/editor");
            let workspace = crate::workspace::Workspace::open(&folder).expect("fixture workspace");
            let path = workspace
                .resource(std::path::Path::new(name))
                .expect("fixture resource");
            // The preview's lease lives as long as the lab.
            std::mem::forget(workspace);
            let editor = cx.new(|cx| {
                let mut editor = crate::editor::host::DocumentEditor::new(cx);
                editor.workbench = true;
                editor.gate(false, dark, window, cx);
                editor.receive(
                    &crate::documents::HostMessage::OpenResource {
                        id: format!("reference:{name}"),
                        name: name.to_owned(),
                        path,
                    },
                    window,
                    cx,
                );
                editor
            });
            cx.observe(&editor, |_, _, cx| cx.notify()).detach();
            Surface::Editor(editor)
        } else if let Some((name, text)) = editor_file {
            // `tools/reference-editor.mjs`: one active pane (EditorPaneShell)
            // over the same in-memory fixture document.
            let editor = cx.new(|cx| {
                let mut editor = crate::editor::host::DocumentEditor::new(cx);
                editor.workbench = true;
                editor.gate(false, dark, window, cx);
                editor.receive(
                    &crate::documents::HostMessage::Open {
                        id: format!("reference:{name}"),
                        name: name.to_owned(),
                        text: text.to_owned(),
                        revision: 1,
                        external: false,
                    },
                    window,
                    cx,
                );
                // The HTML viewer's Edit mode (a real WebView; check it
                // with a window screenshot, not PUPPYONE_SCREENSHOT).
                if scenario == "editor-html-edit" {
                    editor.lab_pane_segment("edit", window, cx);
                }
                editor
            });
            cx.observe(&editor, |_, _, cx| cx.notify()).detach();
            Surface::Editor(editor)
        } else if let Some(cloud) = scenario.strip_prefix("cloud-") {
            // `tools/cloud-scenarios.json` over `fixtures/cloud-history.json`.
            let data: serde_json::Value =
                serde_json::from_str(include_str!("../fixtures/cloud-history.json"))
                    .expect("Cloud fixture");
            let _ = CLOCK.set(data["now"].as_i64().unwrap_or_default() / 1000);
            let history = cx.new(|cx| {
                let mut history = crate::features::source_control::CloudHistory::new(cx);
                history.lab_fixture(cloud, &data, cx);
                history
            });
            cx.observe(&history, |_, _, cx| cx.notify()).detach();
            Surface::CloudHistory(history)
        } else if scenario == "assets" {
            Surface::Assets(cx.new(|_| crate::ui::asset_gallery::AssetGallery))
        } else if let Some(rest) = gallery {
            let dialog = rest == "-dialog";
            Surface::Gallery(cx.new(|_| crate::ui::gallery::Gallery::new(dialog)))
        } else {
            match scenario.strip_prefix("settings-").and_then(settings_page) {
                Some(page) => {
                    // Cloud is off by default; Plan exists only with it on
                    // (`tools/reference-settings-entry.tsx`).
                    let preferences = cx.new(|_| {
                        let mut store = PreferencesStore::memory();
                        store.state.experimental.cloud_workspace = scenario == "settings-seats";
                        store
                    });
                    let settings = cx.new(|cx| {
                        let mut settings = SettingsWorkspaceSurface::new(preferences, window, cx);
                        settings.lab_fixture(
                            PathBuf::from("/reference/project"),
                            page,
                            scenario == "settings-git-remotes",
                            cx,
                        );
                        settings.lab_agents(&scenario, window, cx);
                        settings
                    });
                    cx.observe(&settings, |_, _, cx| cx.notify()).detach();
                    Surface::Settings(settings)
                }
                None => {
                    let workbench = cx.new(|cx| {
                        let mut workbench = Workbench::new(window, cx);
                        workbench.lab_fixture(&scenario, window, cx);
                        workbench
                    });
                    cx.observe(&workbench, |_, _, cx| cx.notify()).detach();
                    Surface::Workbench(workbench)
                }
            }
        };
        Self {
            surface,
            focus: cx.focus_handle(),
            dark,
            captured: false,
            frames: 0,
        }
    }
}

impl Render for Lab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Native web content shows after a drawn frame, as in the shell.
        crate::web_host::frame_drawn(window);
        // Let lists measure and images decode before the OS capture.
        self.frames += 1;
        if self.frames == 1 {
            self.focus.focus(window, cx);
        }
        let assets_ready = !matches!(self.surface, Surface::Assets(_))
            || crate::ui::asset_gallery::AssetGallery::ready(window, cx);
        if self.frames < 3 || !assets_ready {
            window.request_animation_frame();
        } else if !self.captured
            && let Some(path) = std::env::var_os("PUPPYONE_SCREENSHOT")
        {
            self.captured = true;
            let size = window.viewport_size();
            let geometry = serde_json::json!({
                "framework": "GPUI",
                "viewport": [f32::from(size.width), f32::from(size.height)],
                "pixelsPerPoint": window.scale_factor(),
                "assetsReady": assets_ready,
            });
            if let Err(error) = crate::capture::schedule(window, cx, PathBuf::from(path), geometry)
            {
                eprintln!("Lab capture failed: {error:#}");
            }
        }
        let t = theme::Theme::new(self.dark);
        let root = div()
            .track_focus(&self.focus)
            .size_full()
            .font_family("Geist")
            .font_weight(FontWeight::NORMAL)
            .text_size(px(theme::font_size(theme::FONT)))
            .text_color(t.text)
            .relative();
        let root = match &self.surface {
            // `tools/reference-workbench-entry.tsx` (`agent-presence`): the
            // pills in 288×40 boxes on the panel, 16px from the edge; editor
            // pills sit 8px down and 38px from their pane's end.
            Surface::Presence => {
                use crate::ui::components::{FilePresence, PresenceVariant};
                let at = |y: f32, pill: FilePresence| {
                    let editor = y < 90.;
                    div()
                        .absolute()
                        .left(px(16.))
                        .top(px(y))
                        .w(px(288.))
                        .h(px(40.))
                        .flex()
                        .items_start()
                        .child(if editor {
                            div().absolute().top(px(8.)).right(px(38.)).child(pill)
                        } else {
                            div().flex().child(pill)
                        })
                };
                root.bg(t.panel)
                    .child(at(
                        16.,
                        FilePresence::new("p1", PresenceVariant::Editor, "Claude Code")
                            .reading(true),
                    ))
                    .child(at(
                        56.,
                        FilePresence::new("p2", PresenceVariant::Editor, "Codex")
                            .active(false)
                            .more(2),
                    ))
                    .child(at(
                        96.,
                        FilePresence::new("p3", PresenceVariant::Explorer, "Cursor Agent CLI")
                            .reading(true),
                    ))
                    .child(at(
                        136.,
                        FilePresence::new("p4", PresenceVariant::Explorer, "Pi Agent").more(1),
                    ))
            }
            Surface::Gallery(gallery) => root.child(gallery.clone()),
            Surface::Assets(gallery) => root.child(gallery.clone()),
            Surface::Workbench(workbench) => root.bg(t.auxiliary()).child(workbench.clone()),
            Surface::CloudHistory(history) => root.bg(t.auxiliary()).child(history.clone()),
            Surface::Editor(editor) => root.bg(t.canvas).child(editor.clone()),
            Surface::Settings(settings) => {
                // The product page body is `--po-canvas`; the task backdrop
                // and the dialog sit over it exactly as in the shell.
                let size = window.viewport_size();
                root.bg(t.canvas)
                    .child(
                        div()
                            .absolute()
                            .inset_0()
                            .bg(crate::shell::tasks::task_backdrop(t)),
                    )
                    .child(crate::shell::tasks::settings_dialog(
                        settings.clone(),
                        f32::from(size.width),
                        f32::from(size.height),
                        t,
                    ))
            }
        };
        // The OS cursor may rest over the window; captures show no hover.
        root.child(div().id("lab-hover-shield").absolute().inset_0().occlude())
    }
}
