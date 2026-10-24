//! Dev-capture pixel lab: a borderless window that renders one product surface
//! with fixture data, captures it and quits. `PUPPYONE_LAB=<scenario>-<mode>`
//! matches the reference cases of `tools/reference-workbench.mjs`, so native
//! and product renders are compared at the same viewport and DPR.
//!
//! - `<workbench scenario>-<mode>`: the right sidebar (`tools/workbench-scenarios.json`).
//! - `settings-<section>-<mode>`: `SettingsDialog` on one page over the task
//!   backdrop (`tools/settings-scenarios.json`).
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
        "local-agents" => Page::LocalAgents,
        "model-connections" => Page::ModelConnections,
        "local-project" => Page::Project,
        "cloud" => Page::Host,
        "git" => Page::Git,
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
        theme::sync_kit(dark, window, cx);
        let surface = match scenario.strip_prefix("settings-").and_then(settings_page) {
            Some(page) => {
                let preferences = cx.new(|_| PreferencesStore::memory());
                let settings = cx.new(|cx| {
                    let mut settings = SettingsWorkspaceSurface::new(preferences, window, cx);
                    settings.dark_override = Some(dark);
                    settings.lab_fixture(PathBuf::from("/reference/project"), page, cx);
                    settings
                });
                cx.observe(&settings, |_, _, cx| cx.notify()).detach();
                Surface::Settings(settings)
            }
            None => {
                let workbench = cx.new(|cx| {
                    let mut workbench = Workbench::new(window, cx);
                    workbench.dark = dark;
                    workbench.lab_fixture(&scenario, window, cx);
                    workbench
                });
                cx.observe(&workbench, |_, _, cx| cx.notify()).detach();
                Surface::Workbench(workbench)
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
        theme::sync_kit(self.dark, window, cx);
        // Let lists measure and images decode before the OS capture.
        self.frames += 1;
        if self.frames == 1 {
            self.focus.focus(window, cx);
        }
        if self.frames < 3 {
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
            Surface::Workbench(workbench) => root.bg(t.auxiliary()).child(workbench.clone()),
            Surface::Settings(settings) => {
                // The product page body is `--po-canvas`; the task backdrop
                // and the dialog sit over it exactly as in the shell.
                let size = window.viewport_size();
                root.bg(t.canvas)
                    .child(
                        div()
                            .absolute()
                            .inset_0()
                            .bg(crate::shell::task_ui::task_backdrop(t)),
                    )
                    .child(crate::shell::task_ui::settings_dialog(
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
