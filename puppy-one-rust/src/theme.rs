//! The single native source of product colour, geometry and type.
//!
//! Values are traced to the Web product, never chosen locally:
//! - colour primitives: `sub-themes/default-neutral/theme.css` (light `:root`, `.dark .theme-root`);
//! - semantic tier (sidebar text, shell/sidebar dividers, tree guide, menu…): `src/styles/tokens.css`;
//! - control geometry: `packages/shared-ui/src/styles/control-geometry.css` and `tokens.css`;
//! - type roles per text-size preset: `src/features/typography/fontCatalog.ts`.
//!
//! Units are logical pixels. Feature code composes `Theme` fields and the
//! `metric`/`ty` helpers; it must not introduce literal colours.
use crate::{
    geometry::Rect,
    typography::{Metrics, Scale},
};
use gpui::{Rgba, rgb, rgba};

thread_local! {static SCALE: std::cell::Cell<Scale> = const {std::cell::Cell::new(Scale::Medium)};}
pub fn set_scale(scale: Scale) {
    SCALE.with(|s| s.set(scale));
}
pub fn scale() -> Scale {
    SCALE.with(|s| s.get())
}
/// Active type/geometry table for the user's text-size preset.
pub fn ty() -> &'static Metrics {
    scale().metrics()
}
/// Re-scale a size authored against the Medium preset (see `Scale::scale_medium`).
pub fn font_size(medium: f32) -> f32 {
    scale().scale_medium(medium)
}

thread_local! {static POINTER_CURSORS: std::cell::Cell<bool> = const {std::cell::Cell::new(false)};}
/// Appearance → Pointer cursors (`--po-clickable-cursor`).
pub fn set_pointer_cursors(enabled: bool) {
    POINTER_CURSORS.with(|p| p.set(enabled));
}
/// Cursor for clickable controls: the arrow unless the user opted into hands.
pub fn clickable_cursor() -> gpui::CursorStyle {
    if POINTER_CURSORS.with(|p| p.get()) {
        gpui::CursorStyle::PointingHand
    } else {
        gpui::CursorStyle::Arrow
    }
}

/// `--po-control-size` and its derived variants.
pub fn control() -> f32 {
    ty().control_size
}
pub fn control_compact() -> f32 {
    control() - 4.
}
pub fn control_small() -> f32 {
    control() - 6.
}
pub fn control_tight() -> f32 {
    control() - 8.
}
/// `--desktop-sidebar-virtual-row-size`: row height plus its 1px block margins.
pub fn sidebar_stride() -> f32 {
    control() + 2.
}

/// Fixed geometry from `tokens.css`; these do not follow the text-size preset.
pub mod metric {
    pub const CONTROL_RADIUS: f32 = 6.;
    pub const TOOLBAR_ACTION_RADIUS: f32 = 5.;
    pub const CHROME_HEIGHT: f32 = 40.;
    pub const TITLEBAR_TOOL_ACTION_WIDTH: f32 = 34.;
    pub const SIDEBAR_ROW_RADIUS: f32 = 6.;
    pub const SIDEBAR_ROW_LEFT_GAP: f32 = 12.;
    pub const SIDEBAR_ROW_RIGHT_GAP: f32 = 12.;
    pub const SIDEBAR_ROW_CONTENT_LEFT: f32 = 6.;
    pub const SIDEBAR_ROW_CONTENT_RIGHT: f32 = 6.;
    pub const SIDEBAR_LIST_PADDING_BLOCK: f32 = 8.;
    pub const SIDEBAR_ICON_SLOT: f32 = 18.;
    /// `.po-desktop-sidebar-group + .po-desktop-sidebar-group` rhythm.
    pub const SIDEBAR_GROUP_GAP: f32 = 12.;
    pub const SIDEBAR_GROUP_DIVIDER_TOP: f32 = 5.;
    pub const TREE_INDENT: f32 = 24.;
    pub const TREE_ROW_CONTENT_LEFT: f32 = 8.;
    pub const TREE_ROW_ICON_LABEL_GAP: f32 = 6.;
    pub const TREE_ROW_ACTION_SIZE: f32 = 24.;
    pub const MENU_RADIUS: f32 = 8.;
    pub const MENU_PADDING: f32 = 4.;
    pub const MENU_ITEM_PADDING_INLINE: f32 = 8.;
    pub const MENU_ITEM_GAP: f32 = 8.;
    pub const MENU_ICON_SLOT: f32 = 18.;
    pub const READING_CONTENT_WIDTH: f32 = 724.;
    pub const UTILITY_PADDING_INLINE: f32 = 28.;
    pub const UTILITY_PADDING_BOTTOM: f32 = 40.;
    pub const TASK_DIALOG_INSET: f32 = 32.;
    pub const TASK_DIALOG_RADIUS: f32 = 14.;
    pub const DIALOG_RADIUS: f32 = 12.;
    pub const PANE_SASH: f32 = 8.;
    pub const SWITCH_WIDTH: f32 = 34.;
    pub const SWITCH_HEIGHT: f32 = 20.;
    pub const SWITCH_THUMB: f32 = 14.;
}

pub const HEADER: f32 = 40.0;
pub const FOOTER: f32 = 48.0;
pub const SIDEBAR: f32 = 220.0;
pub const FONT: f32 = 14.0;

/// Project the product palette into Kit's styled controls and Base primitives.
/// Update only when appearance changes, so an idle window stays idle.
pub fn sync_kit(dark: bool, window: &mut gpui::Window, cx: &mut gpui::App) {
    use gpui_kit::component::{Theme as KitTheme, ThemeMode};
    let mode = if dark {
        ThemeMode::Dark
    } else {
        ThemeMode::Light
    };
    let palette = Theme::new(dark);
    if KitTheme::global(cx).mode != mode {
        KitTheme::change(mode, Some(window), cx);
    }
    if KitTheme::global(cx).background != palette.canvas.into()
        || KitTheme::global(cx).popover != palette.menu_bg.into()
        || KitTheme::global(cx).font_size != gpui::px(font_size(FONT))
    {
        KitTheme::update(cx, |theme| {
            theme.font_family = "Geist".into();
            theme.font_size = gpui::px(font_size(FONT));
            theme.background = palette.canvas.into();
            theme.foreground = palette.text.into();
            theme.muted_foreground = palette.muted.into();
            theme.muted = palette.control.into();
            theme.border = palette.border.into();
            theme.input = palette.divider.into();
            theme.caret = palette.focus.into();
            theme.ring = palette.focus_ring.into();
            theme.selection = palette.selection.into();
            theme.popover = palette.menu_bg.into();
            theme.popover_foreground = palette.text.into();
            theme.accent = palette.hover.into();
            theme.accent_foreground = palette.text.into();
            theme.sidebar = palette.sidebar.into();
            theme.sidebar_foreground = palette.sidebar_text.into();
            theme.primary = palette.accent.into();
            theme.primary_foreground = palette.text_inverse.into();
            theme.danger = palette.danger.into();
            theme.success = palette.success.into();
            theme.warning = palette.warning.into();
            theme.switch = palette.control_hover.into();
            theme.scrollbar_thumb = palette.scrollbar_thumb.into();
            theme.scrollbar_thumb_hover = palette.scrollbar_thumb_hover.into();
            theme.list_hover = palette.hover.into();
            theme.list_active = palette.selected.into();
        });
    }
}

/// CSS `color-mix(in srgb, a p%, b)` with premultiplied alpha.
pub fn mix(a: Rgba, b: Rgba, a_weight: f32) -> Rgba {
    let (wa, wb) = (a_weight.clamp(0., 1.), 1. - a_weight.clamp(0., 1.));
    let alpha = a.a * wa + b.a * wb;
    if alpha <= f32::EPSILON {
        return Rgba {
            r: 0.,
            g: 0.,
            b: 0.,
            a: 0.,
        };
    }
    let channel = |x: f32, y: f32| (x * a.a * wa + y * b.a * wb) / alpha;
    Rgba {
        r: channel(a.r, b.r),
        g: channel(a.g, b.g),
        b: channel(a.b, b.b),
        a: alpha,
    }
}
/// CSS `color-mix(in srgb, c p%, white)` used by Header status glyphs.
pub fn tint(c: Rgba, weight: f32) -> Rgba {
    mix(c, rgb(0xffffff), weight)
}
/// CSS `color-mix(in srgb, c p%, transparent)`.
pub fn alpha(c: Rgba, weight: f32) -> Rgba {
    Rgba {
        a: c.a * weight,
        ..c
    }
}
fn ink(r: u8, g: u8, b: u8, a: f32) -> Rgba {
    Rgba {
        r: r as f32 / 255.,
        g: g as f32 / 255.,
        b: b as f32 / 255.,
        a,
    }
}

/// File-kind accents (`--po-file-accent-*`).
// The palette is imported whole from `tokens.css`; tokens without a native
// consumer yet stay so a new surface never invents its own colour.
#[allow(dead_code)]
#[derive(Clone, Copy)]
pub struct FileAccents {
    pub default: Rgba,
    pub markdown: Rgba,
    pub json: Rgba,
    pub html: Rgba,
    pub pdf: Rgba,
    pub image: Rgba,
    pub video: Rgba,
    pub code: Rgba,
    pub word: Rgba,
    pub sheet: Rgba,
    pub presentation: Rgba,
}

// Complete semantic token table (see `FileAccents`).
#[allow(dead_code)]
#[derive(Clone, Copy)]
pub struct Theme {
    pub dark: bool,
    // Surfaces.
    /// Header/sidebar frame material (`--po-header` / `--po-sidebar`).
    pub chrome: Rgba,
    pub header: Rgba,
    pub sidebar: Rgba,
    /// Editor/content material (`--po-canvas`).
    pub canvas: Rgba,
    pub panel: Rgba,
    pub panel_raised: Rgba,
    pub overlay: Rgba,
    pub inset: Rgba,
    pub menu_bg: Rgba,
    /// Text inputs and composer field material.
    pub input: Rgba,
    // Text.
    pub text: Rgba,
    pub muted: Rgba,
    pub subtle: Rgba,
    pub text_disabled: Rgba,
    pub text_inverse: Rgba,
    /// `--desktop-sidebar-text-color`, shared by left navigation and the Agent rail.
    pub sidebar_text: Rgba,
    /// Header utility icon colour.
    pub utility: Rgba,
    // Lines.
    pub border: Rgba,
    pub border_subtle: Rgba,
    pub border_strong: Rgba,
    /// Component separators (`--po-divider`).
    pub divider: Rgba,
    /// Application skeleton lines (`--po-shell-divider`).
    pub shell_divider: Rgba,
    pub sidebar_divider: Rgba,
    pub guide: Rgba,
    // Interaction.
    pub hover: Rgba,
    pub active: Rgba,
    pub selected: Rgba,
    pub control: Rgba,
    pub control_hover: Rgba,
    pub focus: Rgba,
    pub focus_ring: Rgba,
    pub selection: Rgba,
    // Status.
    pub accent: Rgba,
    pub accent_text: Rgba,
    pub success: Rgba,
    pub warning: Rgba,
    pub danger: Rgba,
    pub info: Rgba,
    pub purple: Rgba,
    pub notification: Rgba,
    pub brand_blue: Rgba,
    // Elevation.
    pub shadow: Rgba,
    pub backdrop: Rgba,
    pub backdrop_strong: Rgba,
    pub scrollbar_thumb: Rgba,
    pub scrollbar_thumb_hover: Rgba,
    // Content.
    pub file: FileAccents,
    pub file_icon_body: Rgba,
    pub diff_added_bg: Rgba,
    pub diff_added_text: Rgba,
    pub diff_removed_bg: Rgba,
    pub diff_removed_text: Rgba,
    pub code_block: Rgba,
    /// `--po-terminal-bg` (= `--po-surface-terminal` = `--po-surface-editor`).
    pub terminal_bg: Rgba,
    pub terminal_fg: Rgba,
    pub terminal_cursor: Rgba,
    pub ansi: [Rgba; 16],
}

/// Built-in Default-interface Sub Themes (`assets/themes.json`, generated by
/// `tools/import-themes.mjs`).
#[derive(serde::Deserialize)]
struct PackSource {
    id: String,
    name: String,
    light: std::collections::HashMap<String, String>,
    dark: std::collections::HashMap<String, String>,
}
struct Pack {
    id: String,
    name: String,
    light: Theme,
    dark: Theme,
}
fn packs() -> &'static [Pack] {
    static PACKS: std::sync::OnceLock<Vec<Pack>> = std::sync::OnceLock::new();
    PACKS.get_or_init(|| {
        #[derive(serde::Deserialize)]
        struct File {
            packs: Vec<PackSource>,
        }
        let file: File =
            serde_json::from_str(include_str!("../assets/themes.json")).expect("generated themes");
        file.packs
            .into_iter()
            .map(|p| Pack {
                light: Theme::from_tokens(&p.light, false),
                dark: Theme::from_tokens(&p.dark, true),
                id: p.id,
                name: p.name,
            })
            .collect()
    })
}
thread_local! {static PACK: std::cell::Cell<usize> = const {std::cell::Cell::new(0)};}
/// Select the active Sub Theme; unknown ids fall back to `default.neutral`.
pub fn set_pack(id: &str) {
    let index = packs().iter().position(|p| p.id == id).unwrap_or(0);
    PACK.with(|p| p.set(index));
}
#[cfg(test)]
pub fn pack_id() -> &'static str {
    &packs()[PACK.with(|p| p.get())].id
}
/// `(id, name)` in built-in order.
pub fn pack_choices() -> impl Iterator<Item = (&'static str, &'static str)> {
    packs().iter().map(|p| (p.id.as_str(), p.name.as_str()))
}
/// Palette of a specific pack, for previews.
pub fn pack_theme(id: &str, dark: bool) -> Theme {
    let pack = packs().iter().find(|p| p.id == id).unwrap_or(&packs()[0]);
    if dark { pack.dark } else { pack.light }
}

fn parse_color(value: &str) -> Rgba {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#')
        && let Ok(v) = u32::from_str_radix(hex, 16)
    {
        return rgb(v);
    }
    if let Some(body) = value
        .strip_prefix("rgba(")
        .or_else(|| value.strip_prefix("rgb("))
    {
        let parts: Vec<f32> = body
            .trim_end_matches(')')
            .split(',')
            .filter_map(|p| p.trim().parse().ok())
            .collect();
        if parts.len() >= 3 {
            return ink(
                parts[0] as u8,
                parts[1] as u8,
                parts[2] as u8,
                parts.get(3).copied().unwrap_or(1.),
            );
        }
    }
    rgba(0x00000000)
}

impl Theme {
    pub fn new(dark: bool) -> Self {
        let pack = &packs()[PACK.with(|p| p.get())];
        if dark { pack.dark } else { pack.light }
    }
    fn from_tokens(tokens: &std::collections::HashMap<String, String>, dark: bool) -> Self {
        let c = |name: &str| parse_color(tokens.get(name).map(String::as_str).unwrap_or("#000000"));
        let text = c("text");
        let muted = c("text-muted");
        let subtle = c("text-subtle");
        let sidebar = c("sidebar");
        let header = c("header");
        let scrollbar = c("scrollbar-thumb");
        let scrollbar_hover = c("scrollbar-thumb-hover");
        let ansi_names = [
            "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
        ];
        let mut ansi = [rgba(0x00000000); 16];
        for (i, name) in ansi_names.iter().enumerate() {
            ansi[i] = c(&format!("terminal-{name}"));
            ansi[i + 8] = c(&format!("terminal-bright-{name}"));
        }
        Self {
            dark,
            chrome: sidebar,
            header,
            sidebar,
            canvas: c("canvas"),
            panel: c("surface-panel"),
            panel_raised: c("surface-panel-raised"),
            overlay: c("surface-overlay"),
            inset: c("surface-inset"),
            // --po-surface-menu: var(--po-header)
            menu_bg: header,
            // --po-input falls back to the raised panel.
            input: c("surface-panel-raised"),
            text,
            muted,
            subtle,
            text_disabled: c("text-disabled"),
            text_inverse: c("text-inverse"),
            // --desktop-sidebar-text-color
            sidebar_text: mix(muted, text, 0.84),
            // --desktop-titlebar-text-muted
            utility: muted,
            border: c("border"),
            border_subtle: c("border-subtle"),
            border_strong: c("border-strong"),
            divider: c("divider"),
            shell_divider: alpha(text, 0.10),
            sidebar_divider: alpha(text, 0.075),
            guide: c("tree-guide"),
            hover: c("hover"),
            active: c("active"),
            selected: c("selected"),
            control: c("control"),
            control_hover: c("control-hover"),
            // --po-pane-resizer-blue: light-dark(#3b82f6, #60a5fa)
            focus: if dark { rgb(0x60a5fa) } else { rgb(0x3b82f6) },
            focus_ring: c("focus-ring"),
            selection: c("text-selection-bg"),
            accent: c("accent"),
            accent_text: c("accent-text"),
            success: c("success"),
            warning: c("warning"),
            danger: c("danger"),
            info: c("info"),
            purple: c("purple"),
            notification: c("notification"),
            // --po-brand-blue
            brand_blue: rgb(0x4599df),
            shadow: c("shadow"),
            backdrop: c("backdrop"),
            backdrop_strong: c("backdrop-strong"),
            scrollbar_thumb: alpha(scrollbar, 0.76),
            scrollbar_thumb_hover: alpha(scrollbar_hover, 0.88),
            file: FileAccents {
                default: c("file-accent-default"),
                markdown: c("file-accent-markdown"),
                json: c("file-accent-json"),
                html: c("file-accent-html"),
                pdf: c("file-accent-pdf"),
                image: c("file-accent-image"),
                video: c("file-accent-video"),
                code: c("file-accent-code"),
                word: c("file-accent-word"),
                sheet: c("file-accent-sheet"),
                presentation: c("file-accent-presentation"),
            },
            file_icon_body: c("file-icon-body"),
            diff_added_bg: c("diff-added-bg"),
            diff_added_text: c("diff-added-text"),
            diff_removed_bg: c("diff-removed-bg"),
            diff_removed_text: c("diff-removed-text"),
            code_block: if dark { rgb(0x202020) } else { rgb(0xf2f2f2) },
            terminal_bg: c("surface-editor"),
            // --po-terminal-fg
            terminal_fg: mix(text, muted, 0.70),
            terminal_cursor: c("terminal-cursor"),
            ansi,
        }
    }
    /// xterm colour model (`terminalAppearance.ts` + xterm defaults): indices
    /// 0–15 are the pack's `--po-terminal-*` colours, 16–231 the 6×6×6 cube and
    /// 232–255 the grey ramp.
    pub fn ansi_index(&self, index: u8) -> Rgba {
        let i = index as u32;
        if i < 16 {
            self.ansi[i as usize]
        } else if i >= 232 {
            let c = 8 + (i - 232) * 10;
            rgb(c << 16 | c << 8 | c)
        } else {
            let n = i - 16;
            let c = |x| if x == 0 { 0 } else { 55 + x * 40 };
            rgb(c(n / 36) << 16 | c(n / 6 % 6) << 8 | c(n % 6))
        }
    }
    /// Direct 24-bit colour requested by the program (SGR 38/48;2).
    pub fn true_color(r: u8, g: u8, b: u8) -> Rgba {
        rgb((r as u32) << 16 | (g as u32) << 8 | b as u32)
    }
    /// Agent conversation surface (`--po-surface-agent`, the editor material).
    pub fn agent(&self) -> Rgba {
        self.canvas
    }
    /// Right auxiliary workbench material (`--po-surface-auxiliary`).
    pub fn auxiliary(&self) -> Rgba {
        self.sidebar
    }
}

/// Native layout owns all bounds. A future Web island receives only its own rect.
#[derive(Clone, Copy, Debug)]
pub struct Layout {
    pub header: Rect,
    pub explorer: Rect,
    pub footer: Rect,
    pub editor: Rect,
    pub auxiliary: Rect,
}
impl Layout {
    pub fn new(w: f32, h: f32, left: f32, right: f32, rail: f32) -> Self {
        let left = left.max(0.).min((w - rail - 240.).max(0.));
        let right = right.max(0.).min((w - rail - left - 200.).max(0.));
        Self {
            header: Rect::new(0., 0., w, HEADER),
            explorer: Rect::new(rail, HEADER, left, h - HEADER - FOOTER),
            footer: Rect::new(rail, h - FOOTER, left, FOOTER),
            editor: Rect::new(rail + left, HEADER, w - rail - left - right, h - HEADER),
            auxiliary: Rect::new(w - right, HEADER, right, h - HEADER),
        }
    }
    /// The editor pane (`.desktop-editor-pane`) fills the area right of the
    /// 1px shell divider; the resize sash overlays it like the product's
    /// pane resizer instead of reserving a strip.
    pub fn content(self) -> Rect {
        Rect::new(
            self.editor.x + 1.,
            self.editor.y,
            (self.editor.w - 1.).max(0.),
            self.editor.h,
        )
    }
    /// Hit area of the left pane resizer, above the editor content.
    pub fn left_sash(self) -> Rect {
        Rect::new(
            self.editor.x,
            self.editor.y,
            metric::PANE_SASH,
            self.editor.h,
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn panes_tile_without_overlapping() {
        for w in [640., 875., 1280., 1920.] {
            for rail in [0., 56.] {
                let l = Layout::new(w, 800., 220., 360., rail);
                assert_eq!(l.explorer.right(), l.editor.x);
                assert_eq!(l.editor.right(), l.auxiliary.x);
                assert!(l.editor.w >= 200.);
                assert_eq!(l.header.h, 40.);
                assert_eq!(l.footer.h, 48.);
            }
        }
    }
    #[test]
    fn collapsed_panels_consume_no_space() {
        assert_eq!(Layout::new(875., 701., 0., 0., 0.).editor.w, 875.);
    }
    #[test]
    fn semantic_tokens_follow_the_web_formulas() {
        let dark = Theme::new(true);
        // --desktop-sidebar-text-color = mix(muted 84%, text) = #afafb7.
        let c = dark.sidebar_text;
        assert_eq!(
            (
                (c.r * 255.).round(),
                (c.g * 255.).round(),
                (c.b * 255.).round()
            ),
            (175., 175., 183.)
        );
        assert_eq!(pack_choices().next().unwrap().0, "default.neutral");
        set_pack("default.github");
        assert_eq!(pack_id(), "default.github");
        set_pack("missing");
        assert_eq!(pack_id(), "default.neutral");
        // color-mix with transparent only scales alpha.
        assert!((dark.shell_divider.a - 0.10).abs() < 1e-6);
        let half = mix(rgba(0xffffff80), rgba(0x00000000), 0.5);
        assert!((half.a - 0.251).abs() < 0.01 && (half.r - 1.).abs() < 1e-6);
    }
}
