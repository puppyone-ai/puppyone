//! Session status, grid metrics, fitting and scrollback.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionStatus {
    Running,
    Exited,
    Error,
}
impl SessionStatus {
    pub fn label_key(self) -> &'static str {
        match self {
            Self::Running => "terminal.status.running",
            Self::Exited => "terminal.status.exited",
            Self::Error => "terminal.status.error",
        }
    }
}
/// `terminalPathLabel`: a session's tab title is its folder's name.
pub fn path_label(path: &std::path::Path) -> String {
    let value = path.to_string_lossy();
    let value = value.trim();
    if value.is_empty() {
        return "—".into();
    }
    let trimmed = value.trim_end_matches(['/', '\\']);
    let trimmed = if trimmed.is_empty() { value } else { trimmed };
    trimmed
        .split(['/', '\\'])
        .rfind(|s| !s.is_empty())
        .unwrap_or(trimmed)
        .to_owned()
}
/// `.desktop-terminal-session` padding: `14px 0 16px 16px`.
pub(super) const PAD_TOP: f32 = 14.;
pub(super) const PAD_LEFT: f32 = 16.;
pub(super) const PAD_BOTTOM: f32 = 16.;
/// FitAddon keeps xterm's scrollbar width out of the columns.
pub(super) const FIT_SCROLLBAR: f32 = 14.;
/// The scrollbar lane and its active thumb (`--po-scrollbar-size`,
/// `--po-scrollbar-thumb-active-size`, `--po-scrollbar-thumb-active-inset`);
/// at rest the thumb is transparent.
pub(super) const SCROLLBAR_LANE: f32 = 12.;
pub(super) const THUMB_WIDTH: f32 = 8.;
pub(super) const THUMB_INSET: f32 = 2.;
/// The scrollable element's minimum slider length.
pub(super) const THUMB_MIN: f32 = 20.;
/// `po-scrollbar-active` lingers this long after a scroll.
pub(super) const SCROLLBAR_IDLE: Duration = Duration::from_millis(900);
/// `lineHeight`, `scrollback`, `fontWeight` and `fontWeightBold`
/// (terminalRuntime.ts).
pub(super) const LINE_HEIGHT: f32 = 1.24;
pub(super) const SCROLLBACK: usize = 6000;
pub(super) const WEIGHT: FontWeight = FontWeight(450.);
/// xterm's cursor blink: the phase, and the idle time after which the
/// cursor stops blinking and stays shown.
pub(super) const BLINK: Duration = Duration::from_millis(600);
pub(super) const BLINK_IDLE: Duration = Duration::from_secs(5 * 60);

/// xterm's cell for the terminal font (WebGL renderer): the "W" advance
/// floored to device pixels, and the canvas font box — Blink rounds the
/// ascent and descent to whole pixels — rounded up to device pixels,
/// multiplied by the line height and floored.
#[derive(Clone)]
pub(super) struct Grid {
    pub(super) font: Font,
    pub(super) size: f32,
    pub(super) cell_w: f32,
    pub(super) cell_h: f32,
    /// The glyph baseline below the cell top.
    pub(super) baseline: f32,
}
impl Default for Grid {
    fn default() -> Self {
        let size = crate::theme::ty().right.terminal;
        let (cell_w, cell_h, baseline) =
            cell_metrics(size * 0.6, size.round(), (size * 0.25).round(), 2.);
        let mut font = font(crate::theme::MONO);
        font.weight = WEIGHT;
        Self {
            font,
            size,
            cell_w,
            cell_h,
            baseline,
        }
    }
}
impl Grid {
    pub(super) fn measure(window: &Window, cx: &App) -> Self {
        let mut font = crate::ui::fonts::font(crate::typography::fonts::Role::Terminal, cx);
        font.weight = WEIGHT;
        let size = crate::theme::ty().right.terminal;
        let text = window.text_system();
        let id = text.resolve_font(&font);
        let advance = text
            .advance(id, px(size), 'W')
            .map(|a| f32::from(a.width))
            .unwrap_or(size * 0.6);
        let ascent = f32::from(text.ascent(id, px(size)));
        let descent = f32::from(text.descent(id, px(size))).abs();
        let (cell_w, cell_h, baseline) =
            cell_metrics(advance, ascent, descent, window.scale_factor());
        Self {
            font,
            size,
            cell_w,
            cell_h,
            baseline,
        }
    }
}
/// The cell width, height and baseline in pixels. The glyph box (Blink's
/// whole-pixel ascent plus descent) is centred in the cell on device
/// pixels, and glyphs stand on its ideographic baseline (the box bottom
/// less the descent at device size), as xterm's texture atlas draws them.
pub(super) fn cell_metrics(advance: f32, ascent: f32, descent: f32, scale: f32) -> (f32, f32, f32) {
    let width = (advance * scale).floor().max(1.);
    let char_height = ((ascent.round() + descent.round()) * scale).ceil().max(1.);
    let height = (char_height * LINE_HEIGHT).floor().max(1.);
    let top = ((height - char_height) / 2.).round();
    let baseline = top + char_height - (descent * scale).round();
    (width / scale, height / scale, baseline / scale)
}
/// FitAddon: rows and columns that fit the session inside its padding.
pub(super) fn fit(width: f32, height: f32, grid: &Grid) -> (u16, u16) {
    let rows = ((height - PAD_TOP - PAD_BOTTOM).max(0.) / grid.cell_h).floor();
    let cols = ((width - PAD_LEFT - FIT_SCROLLBAR).max(0.) / grid.cell_w).floor();
    (rows.clamp(1., 500.) as u16, cols.clamp(2., 1000.) as u16)
}
/// The vertical scrollbar over `lane` (top and height): the thumb's top
/// and length for `offset` lines above the bottom of `history`.
pub(super) fn thumb(
    lane: (f32, f32),
    rows: u16,
    history: usize,
    offset: usize,
) -> Option<(f32, f32)> {
    if history == 0 {
        return None;
    }
    let (top, height) = lane;
    let ratio = f32::from(rows) / (f32::from(rows) + history as f32);
    let length = (ratio * height).round().max(THUMB_MIN).min(height);
    let position = (history - offset.min(history)) as f32 / history as f32;
    Some((top + position * (height - length), length))
}
/// The scrollback length (vt100 clamps an out-of-range offset to it).
pub(super) fn history(parser: &mut vt100::Parser) -> usize {
    let at = parser.screen().scrollback();
    parser.set_scrollback(usize::MAX);
    let length = parser.screen().scrollback();
    parser.set_scrollback(at);
    length
}
/// `writeSystemLine`: product messages in xterm palette grey 244.
pub(super) fn system_line(message: &str) -> Vec<u8> {
    format!("\x1b[38;5;244m{message}\x1b[0m\r\n").into_bytes()
}
