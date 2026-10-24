//! Dev-capture pixel lab: a borderless window that renders one product surface
//! with fixture data, captures it and quits. `PUPPYONE_LAB=<scenario>-<mode>`
//! matches the reference cases of `tools/reference-workbench.mjs`, so native
//! and product renders are compared at the same viewport and DPR.
use crate::{features::workbench::Workbench, theme};
use gpui::{prelude::*, *};
use std::path::PathBuf;

pub struct Lab {
    workbench: Entity<Workbench>,
    dark: bool,
    captured: bool,
    frames: u32,
}

impl Lab {
    pub fn new(case: &str, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let dark = !case.ends_with("-light");
        let scenario = case
            .trim_end_matches("-light")
            .trim_end_matches("-dark")
            .to_owned();
        theme::sync_kit(dark, window, cx);
        let workbench = cx.new(|cx| {
            let mut workbench = Workbench::new(window, cx);
            workbench.dark = dark;
            workbench.lab_fixture(&scenario, window, cx);
            workbench
        });
        cx.observe(&workbench, |_, _, cx| cx.notify()).detach();
        Self {
            workbench,
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
        div()
            .size_full()
            .font_family("Geist")
            .font_weight(FontWeight::NORMAL)
            .text_size(px(theme::font_size(theme::FONT)))
            .text_color(t.text)
            .bg(t.auxiliary())
            .child(self.workbench.clone())
    }
}
