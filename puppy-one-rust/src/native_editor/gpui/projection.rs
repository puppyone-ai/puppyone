//! Convert semantic spans to the renderer-neutral input regions.
use crate::{
    native_editor::{
        core::{
            document::{Kind, Style},
            projection::Projection,
        },
        features::table,
        host::session::Session,
    },
    ui::input::TextRegion,
};
pub(super) fn regions(session: &Session, projection: &Projection) -> Vec<TextRegion> {
    projection
        .spans
        .iter()
        .map(|span| {
            let kind = &session.state.document.blocks[span.key.0].kind;
            let mut region = TextRegion {
                range: span.range.clone(),
                group: span.key.0,
                font_size: 16.,
                after: 16.,
                ..Default::default()
            };
            match kind {
                Kind::Text(Style::Heading(level), _) => {
                    region.heading = true;
                    region.heading_level = *level;
                    region.font_size = match level {
                        1 => 32.,
                        2 => 26.,
                        3 => 21.,
                        _ => 18.,
                    };
                    region.before = if span.key.0 == 0 { 0. } else { 12. };
                    region.after = 18.;
                }
                Kind::Text(Style::Quote, _) => region.quote = true,
                Kind::Code { .. } | Kind::Raw(_) => {
                    region.code = true;
                    region.font_size = 14.;
                }
                Kind::List { start, items } => {
                    region.prefix = match items[span.key.1].checked {
                        Some(true) => "☑".into(),
                        Some(false) => "☐".into(),
                        None => start
                            .map(|n| format!("{}.", n + span.key.1 as u64))
                            .unwrap_or_else(|| "•".into()),
                    };
                    region.after = if span.key.1 + 1 == items.len() {
                        16.
                    } else {
                        3.
                    };
                }
                Kind::Table { align, rows } => {
                    let cell = table::projection::cell(align, rows.len(), span.key.1);
                    region.columns = cell.columns;
                    region.column = cell.column;
                    region.alignment = cell.alignment;
                    region.heading = cell.heading;
                    region.after = cell.after;
                }
                _ => {}
            }
            if session.state.source_mode {
                region.code = false;
                region.font_size = 14.;
            }
            region
        })
        .collect()
}
