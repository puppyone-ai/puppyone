//! Settings → File types (`features/plugins/file_types.rs`, Layer ①).
//!
//! Consumes only Layer ② (`editor::opening::configurable_file_types`) and
//! `PreferencesStore`; never touches the plugin store or preference files directly.

use crate::{
    editor::opening::{
        OpenPreferences, OpeningContext, configurable_file_types, handler_display_label,
    },
    features::settings::PreferencesStore,
    localization::{t as tr, tf},
    plugin_contract::{CandidateStatus, Catalog, HandlerId},
    ui::components::{
        Button, ButtonVariant, MutedRow, Select, SelectOption, SettingRow, SettingsList,
        SettingsSection,
    },
};
use gpui::{prelude::*, *};

/// Renders the Settings → File types page.
pub fn render_file_types_settings(preferences: &Entity<PreferencesStore>, cx: &App) -> AnyElement {
    let defaults = preferences.read(cx).state.file_type_defaults.clone();
    let open_prefs = OpenPreferences::new(defaults.clone(), Default::default());
    let catalog = Catalog::empty();
    let opening_ctx = OpeningContext::with_defaults(&open_prefs, &[], &catalog);
    let entries = configurable_file_types(&opening_ctx);

    let reset_button = (!defaults.is_empty()).then(|| {
        let prefs = preferences.clone();
        Button::new("file-types-reset-defaults")
            .variant(ButtonVariant::Outline)
            .label(tr("native.settings.fileTypes.resetAll"))
            .on_click(move |_, _, cx| {
                prefs.update(cx, |store, cx| {
                    store.change(|p| p.file_type_defaults.clear(), cx)
                });
            })
    });

    let rows: Vec<AnyElement> = entries
        .into_iter()
        .map(|entry| {
            let format_id = entry.format_id.clone();
            let default_handler = entry.default_handler.clone();
            let active_handler = entry.active_handler.clone();
            let row_label = format_row_label(&entry.label, &entry.extensions);
            let current_label =
                option_label(&active_handler, &default_handler, &opening_ctx, false);
            let options_data: Vec<(HandlerId, String, bool)> = entry
                .options
                .iter()
                .map(|opt| {
                    let installable = matches!(opt.status, CandidateStatus::Installable { .. });
                    let label =
                        option_label(&opt.handler, &default_handler, &opening_ctx, installable);
                    let selected = opt.handler == active_handler;
                    (opt.handler.clone(), label, selected)
                })
                .collect();

            let prefs = preferences.clone();
            let select = Select::new(
                SharedString::from(format!("file-type-default-{format_id}")),
                current_label,
                move |_| {
                    options_data
                        .iter()
                        .map(|(handler, label, selected)| {
                            let prefs = prefs.clone();
                            let format_id = format_id.clone();
                            let default_handler = default_handler.clone();
                            let handler = handler.clone();
                            SelectOption::new(label.clone())
                                .selected(*selected)
                                .on_select(move |_, cx| {
                                    prefs.update(cx, |store, cx| {
                                        store.change(
                                            |p| {
                                                if handler == default_handler {
                                                    p.file_type_defaults.remove(&format_id);
                                                } else {
                                                    p.file_type_defaults
                                                        .insert(format_id.clone(), handler.clone());
                                                }
                                            },
                                            cx,
                                        )
                                    });
                                })
                        })
                        .collect()
                },
            )
            .width_range(160., 240.);

            SettingRow::new(row_label)
                .control(select)
                .into_any_element()
        })
        .collect();

    let mut section = SettingsSection::new(tr("native.settings.fileTypes.title"));
    if let Some(reset) = reset_button {
        section = section.action(reset);
    }

    section
        .child(MutedRow::new(tr("native.settings.fileTypes.description")))
        .child(SettingsList::new().lead(true).children(rows))
        .into_any_element()
}

fn format_row_label(label: &str, extensions: &[String]) -> String {
    if extensions.is_empty() {
        return label.to_owned();
    }
    let preview: Vec<&str> = extensions.iter().take(2).map(String::as_str).collect();
    format!("{label} ({})", preview.join(", "))
}

fn option_label(
    handler: &HandlerId,
    default_handler: &HandlerId,
    ctx: &OpeningContext<'_>,
    installable: bool,
) -> String {
    let base = if handler.is_system_default_app() {
        tr("editor.openDefaultApp").into()
    } else {
        handler_display_label(handler, ctx)
    };
    let label = if handler == default_handler {
        tf(
            "native.settings.fileTypes.defaultOption",
            &[("name", base.into())],
        )
    } else {
        base
    };
    if installable {
        format!("{label} …")
    } else {
        label
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn row_label_includes_primary_extensions_and_marks_default_option() {
        assert_eq!(
            format_row_label(
                "Markdown",
                &[".md".into(), ".markdown".into(), ".mdx".into()]
            ),
            "Markdown (.md, .markdown)"
        );
        assert_eq!(format_row_label("Plain Text", &[]), "Plain Text");

        let prefs = OpenPreferences::default();
        let catalog = Catalog::empty();
        let ctx = OpeningContext::with_defaults(&prefs, &[], &catalog);
        let default_h = HandlerId::builtin("markdown");
        let text_h = HandlerId::builtin("text");
        assert!(option_label(&default_h, &default_h, &ctx, false).contains("Markdown"));
        assert_eq!(option_label(&text_h, &default_h, &ctx, false), "Plain Text");
    }
}
