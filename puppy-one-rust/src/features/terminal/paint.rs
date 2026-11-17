//! Painting the visible cells, and the xterm palette.
use super::*;

/// One visible cell of a row, ready to paint.
pub(super) struct CellPaint {
    pub(super) col: u16,
    /// Columns covered (wide characters take two).
    pub(super) span: u16,
    pub(super) text: String,
    pub(super) font: Font,
    pub(super) fg: Rgba,
    /// `None` is the terminal background (left unpainted).
    pub(super) bg: Option<Rgba>,
    pub(super) underline: bool,
}
impl CellPaint {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn of(
        t: &Theme,
        grid: &Grid,
        screen: &vt100::Screen,
        row: u16,
        col: u16,
        selected: bool,
        linked: bool,
    ) -> Option<Self> {
        let cell = screen.cell(row, col)?;
        if cell.is_wide_continuation() {
            return None;
        }
        let mut font = grid.font.clone();
        if cell.bold() {
            font.weight = FontWeight::BOLD;
        }
        if cell.italic() {
            font.style = FontStyle::Italic;
        }
        let fg = color(t, cell.fgcolor(), t.terminal_fg);
        let bg = color(t, cell.bgcolor(), t.terminal_bg);
        let (fg, bg) = if cell.inverse() { (bg, fg) } else { (fg, bg) };
        let bg = if selected { t.selection } else { bg };
        let text = cell.contents();
        Some(Self {
            col,
            span: if cell.is_wide() { 2 } else { 1 },
            text: if text.is_empty() { " ".into() } else { text },
            font,
            fg,
            bg: (bg != t.terminal_bg).then_some(bg),
            // The hovered link is underlined (`WebLinksAddon` decoration).
            underline: cell.underline() || linked,
        })
    }
}
/// xterm's renderer: backgrounds and decorations per cell, and every glyph
/// at its cell's left edge, so the font's natural advance never moves the
/// grid. The row is shaped once for fallback faces and clusters.
pub(super) fn paint_cells(
    window: &mut Window,
    grid: &Grid,
    origin: Point<Pixels>,
    cells: &[CellPaint],
) {
    let cell_x = |cell: &CellPaint| origin.x + px(f32::from(cell.col) * grid.cell_w);
    let cell_width = |cell: &CellPaint| px(f32::from(cell.span) * grid.cell_w);
    for cell in cells {
        if let Some(bg) = cell.bg {
            window.paint_quad(fill(
                Bounds::new(
                    point(cell_x(cell), origin.y),
                    size(cell_width(cell), px(grid.cell_h)),
                ),
                bg,
            ));
        }
    }
    // Box drawing, blocks, shades and Powerline fill their whole cell.
    let custom: Vec<bool> = cells.iter().map(|c| glyphs::is_custom(&c.text)).collect();
    for (cell, _) in cells.iter().zip(&custom).filter(|(_, custom)| **custom) {
        glyphs::paint(
            window,
            &cell.text,
            Bounds::new(
                point(cell_x(cell), origin.y),
                size(cell_width(cell), px(grid.cell_h)),
            ),
            grid.size,
            cell.fg,
        );
    }
    let mut text = String::new();
    let mut starts = Vec::with_capacity(cells.len());
    let runs: Vec<TextRun> = cells
        .iter()
        .zip(&custom)
        .map(|(cell, custom)| {
            starts.push(text.len());
            let shown = if *custom { " " } else { cell.text.as_str() };
            text.push_str(shown);
            TextRun {
                len: shown.len(),
                font: cell.font.clone(),
                color: cell.fg.into(),
                background_color: None,
                underline: None,
                strikethrough: None,
            }
        })
        .collect();
    if text.trim().is_empty() {
        return;
    }
    let size = px(grid.size);
    let line = window
        .text_system()
        .shape_line(text.into(), size, &runs, None);
    let baseline = origin.y + px(grid.baseline);
    // A cell's later glyphs (combining marks) keep their offset from its first.
    let mut first: Vec<Option<Pixels>> = vec![None; cells.len()];
    for run in line.runs.iter() {
        for glyph in &run.glyphs {
            let i = starts
                .partition_point(|s| *s <= glyph.index)
                .saturating_sub(1);
            let lead = *first[i].get_or_insert(glyph.position.x);
            let at = point(cell_x(&cells[i]) + glyph.position.x - lead, baseline);
            if glyph.is_emoji {
                window.paint_emoji(at, run.font_id, glyph.id, size).ok();
            } else {
                window
                    .paint_glyph(at, run.font_id, glyph.id, size, cells[i].fg.into())
                    .ok();
            }
        }
    }
    for cell in cells.iter().filter(|c| c.underline) {
        window.paint_quad(fill(
            Bounds::new(
                point(cell_x(cell), baseline + px(1.)),
                gpui::size(cell_width(cell), px(1.)),
            ),
            cell.fg,
        ));
    }
}
pub(super) fn color(t: &Theme, color: vt100::Color, default: Rgba) -> Rgba {
    match color {
        vt100::Color::Default => default,
        vt100::Color::Rgb(r, g, b) => Theme::true_color(r, g, b),
        vt100::Color::Idx(i) => t.ansi_index(i),
    }
}
