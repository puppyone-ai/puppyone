//! Tables in Chromium's auto layout inside a 12px scrollbar gutter.
use super::*;

/// Chromium auto table layout for `width: max-content; min-width: 100%`:
/// columns start at their max-content width (cells capped at 280px of content,
/// padded 9px each side) and share any extra width in proportion.
pub(super) fn column_widths(maxima: &[f32], available: f32) -> Vec<f32> {
    let total: f32 = maxima.iter().sum();
    if total <= 0. {
        return maxima.to_vec();
    }
    if total >= available {
        return maxima.to_vec();
    }
    maxima
        .iter()
        .map(|m| m + (available - total) * m / total)
        .collect()
}

pub(super) fn table(
    head: &[Vec<Inline>],
    rows: &[Vec<Vec<Inline>>],
    cx: &mut Context<'_>,
    path: &str,
) -> AnyElement {
    let t = cx.t;
    let a = super::super::agent_theme::AgentTheme::new(&t);
    let size = theme::ty().left.meta;
    let line = size * 1.5;
    let columns = head.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
    // Max-content per column, measured with the product faces.
    let measure = |inlines: &[Inline], bold: bool, window: &mut Window| -> f32 {
        let text = plain(inlines);
        let font = Font {
            family: "Geist".into(),
            weight: if bold {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::NORMAL
            },
            ..Font::default()
        };
        let run = TextRun {
            len: text.len(),
            font,
            color: Hsla::default(),
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        f32::from(
            window
                .text_system()
                .shape_line(text.into(), px(size), &[run], None)
                .width,
        )
    };
    let mut maxima = vec![0f32; columns];
    for (c, cell) in head.iter().enumerate() {
        maxima[c] = maxima[c].max(measure(cell, true, cx.window).clamp(76., 280.) + 18.);
    }
    for row in rows {
        for (c, cell) in row.iter().enumerate() {
            maxima[c] = maxima[c].max(measure(cell, false, cx.window).clamp(76., 280.) + 18.);
        }
    }
    // The table fills the answer width inside the wrapper border and the
    // 12px gutter `scrollbar-gutter: stable` reserves.
    let widths = column_widths(&maxima, cx.width - 2. - 12.);
    let cell = |content: AnyElement, width: f32, last_col: bool, last_row: bool, header: bool| {
        div()
            .w(px(width))
            .flex_shrink_0()
            .px(px(9.))
            .py(px(7.))
            .when(!last_col, |d| d.border_r_1())
            .when(!last_row, |d| d.border_b_1())
            .border_color(a.border_subtle)
            .when(header, |d| d.bg(a.table_header_surface))
            .child(content)
    };
    let mut all_rows: Vec<(Vec<Vec<Inline>>, bool)> = vec![];
    if !head.is_empty() {
        all_rows.push((head.to_vec(), true));
    }
    all_rows.extend(rows.iter().map(|r| (r.clone(), false)));
    let row_count = all_rows.len();
    let mut grid = div().flex().flex_col();
    for (r, (cells, header)) in all_rows.iter().enumerate() {
        // `tbody tr:nth-child(even)`.
        let body_index = if head.is_empty() {
            r
        } else {
            r.saturating_sub(1)
        };
        let mut row = div().flex().when(!header && body_index % 2 == 1, |d| {
            d.bg(a.table_alternate_surface)
        });
        for (c, &width) in widths.iter().enumerate().take(columns) {
            let inlines = cells.get(c).cloned().unwrap_or_default();
            let weight = if *header {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::NORMAL
            };
            let content = rich(
                &inlines,
                false,
                weight,
                size,
                line,
                cx,
                &format!("{path}.{r}.{c}"),
            );
            row = row.child(cell(
                content,
                width,
                c + 1 == columns,
                r + 1 == row_count,
                *header,
            ));
        }
        grid = grid.child(row);
    }
    div()
        .id(SharedString::from(format!("{}:{path}:table", cx.key)))
        .w_full()
        .overflow_x_scroll()
        .border_1()
        .border_color(a.border_subtle)
        .rounded(px(8.))
        .bg(a.markdown_disclosure_surface)
        .pr(px(12.))
        .child(grid)
        .into_any_element()
}
