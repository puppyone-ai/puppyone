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
/// Chromium lays a line out with the font's ascent and descent rounded to
/// whole pixels (Geist: 1.005 and 0.295 em); GPUI keeps the exact metrics.
/// The vertical offset that puts GPUI's Geist baseline at Chromium's.
pub fn chromium_baseline(size: f32) -> f32 {
    let (ascent, descent) = (1.005 * size, 0.295 * size);
    (ascent.round() - descent.round() - (ascent - descent)) / 2.
}
pub fn control() -> f32 {
    ty().control_size
}
/// `.desktop-terminal-launcher-icon.is-opencode` backing behind the OpenCode mark.
pub fn opencode_mark_surface() -> Rgba {
    rgb(0x111418)
}
/// `--po-control-size-large`.
pub fn control_large() -> f32 {
    control() + 2.
}
/// `--po-control-size-mini`.
pub fn control_mini() -> f32 {
    control() - 10.
}
/// `--po-control-size-micro`.
pub fn control_micro() -> f32 {
    control() - 12.
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
/// `--desktop-sidebar-navigation-height`: the sidebar control plus the outer
/// and inner navigation padding. The footer follows the text-size preset.
pub fn footer() -> f32 {
    control() + metric::SIDEBAR_NAVIGATION_PADDING_OUTER + metric::SIDEBAR_NAVIGATION_PADDING_INNER
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
    /// `--desktop-sidebar-icon-label-gap`.
    pub const SIDEBAR_ICON_LABEL_GAP: f32 = 4.;
    /// `.po-desktop-sidebar-group + .po-desktop-sidebar-group` rhythm.
    pub const SIDEBAR_GROUP_GAP: f32 = 12.;
    pub const SIDEBAR_GROUP_DIVIDER_TOP: f32 = 5.;
    /// `--desktop-sidebar-navigation-padding-{outer,inner,balanced,inline}`.
    pub const SIDEBAR_NAVIGATION_PADDING_OUTER: f32 = 12.;
    pub const SIDEBAR_NAVIGATION_PADDING_INNER: f32 = 4.;
    pub const SIDEBAR_NAVIGATION_PADDING_BALANCED: f32 = 8.;
    pub const SIDEBAR_NAVIGATION_PADDING_INLINE: f32 = 12.;
    /// `--desktop-sidebar-nav-gap`.
    pub const SIDEBAR_NAV_GAP: f32 = 4.;
    /// `--desktop-sidebar-navigation-fade-size`: the tree's edge fade above the footer.
    pub const SIDEBAR_NAVIGATION_FADE_SIZE: f32 = 18.;
    /// `--desktop-sidebar-utility-icon-size` (Settings / Help in the footer).
    pub const SIDEBAR_UTILITY_ICON: f32 = 14.;
    pub const TREE_INDENT: f32 = 24.;
    /// The desktop Explorer maps `--po-tree-row-content-left` and
    /// `--po-tree-row-icon-label-gap` to the sidebar row tokens
    /// (`data-workspace/browser.css`), not the shared-ui 8/6 defaults.
    pub const TREE_ROW_CONTENT_LEFT: f32 = SIDEBAR_ROW_CONTENT_LEFT;
    pub const TREE_ROW_ICON_LABEL_GAP: f32 = SIDEBAR_ICON_LABEL_GAP;
    pub const TREE_ROW_ACTION_SIZE: f32 = 24.;
    /// `.tree-row-actions { right: 4px; gap: 2px }`.
    pub const TREE_ROW_ACTION_INSET: f32 = 4.;
    pub const TREE_ROW_ACTION_GAP: f32 = 2.;
    /// `--tree-row-action-icon-size`.
    pub const TREE_ROW_ACTION_ICON: f32 = 15.;
    pub const MENU_RADIUS: f32 = 8.;
    pub const MENU_PADDING: f32 = 4.;
    pub const MENU_ITEM_PADDING_INLINE: f32 = 8.;
    pub const MENU_ITEM_GAP: f32 = 8.;
    pub const MENU_ICON_SLOT: f32 = 18.;
    /// `.desktop-menu-separator`: 1px plus `margin: 4px 0`
    /// (`MENU_SEPARATOR_BLOCK_SIZE` in `nodeActions.tsx`).
    pub const MENU_SEPARATOR_BLOCK: f32 = 9.;
    /// `--desktop-project-menu-spacing` (`.desktop-project-menu` padding).
    pub const PROJECT_MENU_SPACING: f32 = 3.;
    pub const READING_CONTENT_WIDTH: f32 = 724.;
    pub const UTILITY_PADDING_INLINE: f32 = 28.;
    pub const UTILITY_PADDING_BOTTOM: f32 = 40.;
    pub const TASK_DIALOG_INSET: f32 = 32.;
    pub const TASK_DIALOG_RADIUS: f32 = 14.;
    pub const DIALOG_RADIUS: f32 = 12.;
    /// `--po-pane-resizer-hit-size`: the hit lane of a pane edge or split.
    pub const PANE_SASH: f32 = 8.;
    pub const SWITCH_WIDTH: f32 = 34.;
    pub const SWITCH_HEIGHT: f32 = 20.;
    pub const SWITCH_THUMB: f32 = 14.;
}

/// `--po-font-mono` (Geist Mono) for machine output; static editor faces.
/// CSS `line-height: normal` for Geist (ascender 1005 + descender 295 per
/// 1000 units); GPUI's own default is 1.618.
pub const NORMAL_LINE_HEIGHT: f32 = 1.3;
/// The interface sans with true oblique faces (the editor's Geist build),
/// for the product's italic interface notes.
pub const SANS_ITALIC: &str = "PuppyOne Geist 400";
pub const MONO: &str = "PuppyOne Geist Mono 400";
pub const MONO_MEDIUM: &str = "PuppyOne Geist Mono 500";
pub const HEADER: f32 = 40.0;
pub const FONT: f32 = 14.0;

/// Project the product palette into Kit's styled controls and Base primitives.
/// Update only when appearance changes, so an idle window stays idle.
pub fn sync_kit(dark: bool, window: Option<&mut gpui::Window>, cx: &mut gpui::App) {
    use gpui_kit::component::{Theme as KitTheme, ThemeMode};
    let mode = if dark {
        ThemeMode::Dark
    } else {
        ThemeMode::Light
    };
    if cx.try_global::<KitTheme>().is_none() {
        return;
    }
    let palette = Theme::new(dark);
    if KitTheme::global(cx).mode != mode {
        KitTheme::change(mode, window, cx);
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
/// CSS `color-mix(in srgb, c p%, black)` (pressed/hovered solid fills).
pub fn shade(c: Rgba, weight: f32) -> Rgba {
    mix(c, rgb(0x000000), weight)
}
/// `#fff` text on a solid status fill (`.desktop-settings-save-action`).
pub fn on_solid() -> Rgba {
    rgb(0xffffff)
}
/// Chromium's unchecked native checkbox: (fill, border) in the colour scheme.
pub fn native_checkbox(dark: bool) -> (Rgba, Rgba) {
    if dark {
        (rgb(0x3b3b3b), rgb(0x858585))
    } else {
        (rgb(0xffffff), rgb(0x767676))
    }
}
/// Chromium's `resize: vertical` textarea grip: the diagonal shadow and, in
/// dark schemes, the embossing highlight drawn beside it.
pub fn native_resize_grip(dark: bool) -> (Rgba, Option<Rgba>) {
    if dark {
        (rgb(0x0e0e0e), Some(rgb(0xaaaaaa)))
    } else {
        (rgb(0x666666), None)
    }
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
    /// `--desktop-sidebar-utility-icon-color`: Settings / Help in the sidebar footer.
    pub sidebar_utility: Rgba,
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
    /// `--po-pane-resizer-hover-color`: a pane edge or split under the pointer.
    pub pane_resizer_hover: Rgba,
    /// `--po-pane-resizer-active-color` and `--po-pane-resizer-active-ring`:
    /// the stroke and its 1px ring while it is dragged.
    pub pane_resizer_active: Rgba,
    pub pane_resizer_ring: Rgba,
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
/// The built-in Sub Theme used until preferences load (`default.neutral`).
pub const DEFAULT_PACK: &str = "default.neutral";
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
        let divider = c("divider");
        // --po-pane-resizer-blue: light-dark(#3b82f6, #60a5fa)
        let resizer = if dark { rgb(0x60a5fa) } else { rgb(0x3b82f6) };
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
            // color-mix(in srgb, var(--po-text-muted) 80%, var(--po-sidebar))
            sidebar_utility: mix(muted, sidebar, 0.8),
            border: c("border"),
            border_subtle: c("border-subtle"),
            border_strong: c("border-strong"),
            divider,
            shell_divider: alpha(text, 0.10),
            sidebar_divider: alpha(text, 0.075),
            guide: c("tree-guide"),
            hover: c("hover"),
            active: c("active"),
            selected: c("selected"),
            control: c("control"),
            control_hover: c("control-hover"),
            focus: resizer,
            focus_ring: c("focus-ring"),
            selection: c("text-selection-bg"),
            // color-mix(in srgb, var(--po-pane-resizer-blue) 55%, var(--po-divider))
            pane_resizer_hover: mix(resizer, divider, 0.55),
            pane_resizer_active: resizer,
            // color-mix(in srgb, var(--po-pane-resizer-blue) 24%, transparent)
            pane_resizer_ring: alpha(resizer, 0.24),
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
            // Terminals live only in the right sidebar, where layout.css sets
            // --po-surface-terminal (and so --po-terminal-bg) to the auxiliary surface.
            terminal_bg: c("sidebar"),
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
    /// Agent conversation surface. Chat lives only in the right sidebar, where
    /// `.desktop-right-sidebar` sets `--po-surface-agent: var(--po-surface-auxiliary)`.
    pub fn agent(&self) -> Rgba {
        self.auxiliary()
    }
    /// Right auxiliary workbench material (`--po-surface-auxiliary`).
    pub fn auxiliary(&self) -> Rgba {
        self.sidebar
    }
}

/// `app-shell/layout/desktopPaneLayout.ts` pane contract.
pub mod pane {
    pub const DEFAULT_EXPLORER_WIDTH: f32 = 320.;
    pub const MIN_EXPLORER_WIDTH: f32 = 220.;
    pub const MAX_EXPLORER_WIDTH: f32 = 520.;
    pub const DEFAULT_RIGHT_SIDEBAR_WIDTH: f32 = 560.;
    pub const MIN_RIGHT_SIDEBAR_WIDTH: f32 = 320.;
    pub const MIN_MAIN_PANE_WIDTH: f32 = 320.;
    pub const EXPLORER_RESIZE_GUTTER_WIDTH: f32 = 8.;
    /// `EXPLORER_COLLAPSE_THRESHOLD` / `RIGHT_SIDEBAR_COLLAPSE_THRESHOLD`:
    /// how far past its minimum a dragged pane edge goes before it collapses.
    pub const EXPLORER_COLLAPSE_THRESHOLD: f32 = MIN_EXPLORER_WIDTH * 0.5;
    pub const RIGHT_SIDEBAR_COLLAPSE_THRESHOLD: f32 = MIN_RIGHT_SIDEBAR_WIDTH * 0.5;
    /// `.po-collapsed-pane-edge-handle`: the closed right sidebar's hit lane
    /// at the window edge.
    pub const COLLAPSED_EDGE_HIT: f32 = 12.;
    /// `window-layout-contract.mjs`: the product-level window floor.
    pub const WINDOW_MIN_WIDTH: f32 = 640.;
    pub const WINDOW_MIN_HEIGHT: f32 = 520.;
}
/// `resolveDesktopPaneLayout().minimumWidth`: the main pane floor plus the
/// minimum of every open side pane (and the Explorer's gutter).
pub fn pane_minimum_width(explorer_open: bool, right_open: bool) -> f32 {
    use pane::*;
    let when = |open: bool, value: f32| if open { value } else { 0. };
    MIN_MAIN_PANE_WIDTH
        + when(
            explorer_open,
            EXPLORER_RESIZE_GUTTER_WIDTH + MIN_EXPLORER_WIDTH,
        )
        + when(right_open, MIN_RIGHT_SIDEBAR_WIDTH)
}
/// `window-layout:set-minimum-width`: the native window never gets narrower
/// than the open panes' minima (plus the project rail), nor the product floor.
pub fn window_minimum_width(explorer_open: bool, right_open: bool, rail: f32) -> f32 {
    (pane_minimum_width(explorer_open, right_open) + rail).max(pane::WINDOW_MIN_WIDTH)
}
/// `resolveDesktopPaneLayout`: `(explorer, right sidebar, layout width)` for
/// the preferred widths of the open panes (`0` = closed). Passive window
/// resizing consumes the main pane first, then the auxiliary pane, then the
/// Explorer; when every minimum cannot fit, the layout keeps its minimum
/// width; the shell raises the native window minimum to match
/// (`window_minimum_width`), so this only happens where the window cannot
/// grow (full screen).
pub fn resolve_pane_widths(available: f32, explorer: f32, right: f32) -> (f32, f32, f32) {
    use pane::*;
    let width = available.max(0.).round();
    let (explorer_open, right_open) = (explorer > 0., right > 0.);
    let when = |open: bool, value: f32| if open { value } else { 0. };
    let gutter = when(explorer_open, EXPLORER_RESIZE_GUTTER_WIDTH);
    let layout = width.max(pane_minimum_width(explorer_open, right_open));
    let right_max = width.max(MIN_RIGHT_SIDEBAR_WIDTH);
    let mut explorer_width = when(
        explorer_open,
        explorer
            .round()
            .clamp(MIN_EXPLORER_WIDTH, MAX_EXPLORER_WIDTH),
    );
    let mut right_width = when(
        right_open,
        right.round().clamp(MIN_RIGHT_SIDEBAR_WIDTH, right_max),
    );
    let mut deficit =
        (MIN_MAIN_PANE_WIDTH - (layout - gutter - explorer_width - right_width)).max(0.);
    if deficit > 0. && right_open {
        let reclaimed = deficit.min(right_width - MIN_RIGHT_SIDEBAR_WIDTH);
        right_width -= reclaimed;
        deficit -= reclaimed;
    }
    if deficit > 0. && explorer_open {
        explorer_width -= deficit.min(explorer_width - MIN_EXPLORER_WIDTH);
    }
    (explorer_width, right_width, layout)
}
/// Live maximum of a dragged Explorer (`explorer.maxWidth`): what remains
/// after its gutter, the main pane floor and an open right sidebar's minimum,
/// within the Explorer's own range.
pub fn explorer_max_width(available: f32, right_open: bool) -> f32 {
    use pane::*;
    let right = if right_open {
        MIN_RIGHT_SIDEBAR_WIDTH
    } else {
        0.
    };
    (available.max(pane_minimum_width(true, right_open))
        - EXPLORER_RESIZE_GUTTER_WIDTH
        - MIN_MAIN_PANE_WIDTH
        - right)
        .clamp(MIN_EXPLORER_WIDTH, MAX_EXPLORER_WIDTH)
}
/// Live maximum of a dragged right sidebar: what remains after the current
/// Explorer, its gutter and the main pane floor (`rightSidebar.maxWidth`).
pub fn right_sidebar_max_width(available: f32, explorer: f32) -> f32 {
    use pane::*;
    let gutter = if explorer > 0. {
        EXPLORER_RESIZE_GUTTER_WIDTH
    } else {
        0.
    };
    (available - gutter - MIN_MAIN_PANE_WIDTH - explorer).clamp(
        MIN_RIGHT_SIDEBAR_WIDTH,
        available.max(MIN_RIGHT_SIDEBAR_WIDTH),
    )
}
/// Native layout owns all bounds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub header: Rect,
    pub explorer: Rect,
    pub footer: Rect,
    pub editor: Rect,
    pub auxiliary: Rect,
}
impl Layout {
    /// `left` / `right` are the preferred widths of the open panes (`0` when
    /// closed); the product pane policy resolves what they get.
    pub fn new(w: f32, h: f32, left: f32, right: f32, rail: f32) -> Self {
        let (left, right, layout) = resolve_pane_widths(w - rail, left, right);
        let main = layout - left - right;
        let footer = footer();
        Self {
            header: Rect::new(0., 0., w, HEADER),
            explorer: Rect::new(rail, HEADER, left, h - HEADER - footer),
            footer: Rect::new(rail, h - footer, left, footer),
            editor: Rect::new(rail + left, HEADER, main, h - HEADER),
            auxiliary: Rect::new(rail + left + main, HEADER, right, h - HEADER),
        }
    }
    /// The editor pane (`.desktop-editor-pane`) fills the main pane: the
    /// Explorer's divider is its own last column (`.po-pane-edge-chrome`),
    /// and the resize sash overlays the editor instead of reserving a strip.
    pub fn content(self) -> Rect {
        self.editor
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
                let l = Layout::new(w, 800., 320., 560., rail);
                assert_eq!(l.explorer.right(), l.editor.x);
                assert_eq!(l.editor.right(), l.auxiliary.x);
                assert!(l.editor.w >= pane::MIN_MAIN_PANE_WIDTH);
                assert_eq!(l.header.h, 40.);
                assert_eq!(l.footer.h, 48.);
            }
        }
    }
    #[test]
    fn pane_widths_follow_the_product_policy() {
        // Defaults at 1280: Explorer 320, right sidebar 560, main 400.
        let l = Layout::new(1280., 800., 320., 560., 0.);
        assert_eq!(
            (l.explorer.w, l.editor.w, l.auxiliary.w),
            (320., 400., 560.)
        );
        assert_eq!(l.auxiliary.x, 720.);
        // Narrowing the window takes the main pane down to its 320 floor
        // (plus the 8px Explorer gutter), then the auxiliary pane yields.
        assert_eq!(resolve_pane_widths(1208., 320., 560.).1, 560.);
        assert_eq!(resolve_pane_widths(1000., 320., 560.).1, 352.);
        // Only once the auxiliary pane is at its minimum does the Explorer.
        assert_eq!(resolve_pane_widths(900., 320., 560.), (252., 320., 900.));
        // Below every minimum the layout keeps its minimum width.
        assert_eq!(resolve_pane_widths(700., 320., 560.), (220., 320., 868.));
        // Preferences are clamped to each pane's range.
        assert_eq!(resolve_pane_widths(1600., 100., 0.), (220., 0., 1600.));
        assert_eq!(resolve_pane_widths(1600., 900., 0.), (520., 0., 1600.));
        assert_eq!(right_sidebar_max_width(1280., 320.), 632.);
        // The Explorer keeps the main floor and an open right sidebar's minimum.
        assert_eq!(explorer_max_width(1280., false), 520.);
        assert_eq!(explorer_max_width(1000., true), 352.);
        assert_eq!(explorer_max_width(700., true), 220.);
    }
    #[test]
    fn the_window_minimum_follows_the_open_panes() {
        assert_eq!(window_minimum_width(true, true, 0.), 868.);
        assert_eq!(window_minimum_width(true, true, 56.), 924.);
        assert_eq!(window_minimum_width(true, false, 0.), 640.);
        assert_eq!(window_minimum_width(false, true, 0.), 640.);
        assert_eq!(window_minimum_width(false, false, 0.), 640.);
    }
    #[test]
    fn sidebar_footer_follows_the_navigation_height_formula() {
        // control + outer 12 + inner 4, per text-size preset.
        for (preset, height) in [
            (Scale::Small, 46.),
            (Scale::Medium, 48.),
            (Scale::Large, 50.),
        ] {
            set_scale(preset);
            assert_eq!(footer(), height);
            let l = Layout::new(1280., 800., 320., 0., 0.);
            assert_eq!(l.footer.h, height);
            assert_eq!(l.explorer.bottom(), l.footer.y);
        }
        set_scale(Scale::Medium);
        // --desktop-sidebar-utility-icon-color = mix(muted 80%, sidebar).
        let dark = Theme::new(true);
        let expected = mix(dark.muted, dark.sidebar, 0.8);
        assert_eq!(dark.sidebar_utility, expected);
        assert!(dark.sidebar_utility != dark.muted);
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
