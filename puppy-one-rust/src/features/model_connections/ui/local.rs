//! The local models category: saved local services, the services running
//! on this Mac with the models each serves (`Connect`, or `Add` per model),
//! installed apps that are stopped with the models they downloaded
//! (`Start`), and where to get a model app when there is none.
use super::super::infrastructure::{Candidate, Installed, SourceKind};
use super::rows::{identity, row_mark, table, table_row, text_action};
use super::{ErrorAt, ModelConnections, PageState};
use crate::agent::model_connections::providers as registry;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::components::{Button, ButtonVariant, Icon, SettingsCategory},
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex};
use gpui_kit::component::Sizable as _;

/// Model apps to install, with where to get them and their GitHub stars
/// (`gh api repos/<repo>`, 2026-11-21; LM Studio's app is not open
/// source, so it shows none): `(provider, page, stars)`.
const GUIDES: [(&str, &str, Option<u32>); 6] = [
    ("ollama", "https://ollama.com/download", Some(187_820)),
    ("lm-studio", "https://lmstudio.ai/download", None),
    (
        "omlx",
        "https://github.com/jundot/omlx/releases",
        Some(23_793),
    ),
    ("mlx", "https://github.com/ml-explore/mlx-lm", Some(7_719)),
    (
        "llama-cpp",
        "https://github.com/ggml-org/llama.cpp",
        Some(135_924),
    ),
    ("jan", "https://jan.ai/download", Some(45_984)),
];

/// `★ 188k`, `★ 7.7k`, `★ 950`.
fn stars(count: u32) -> String {
    match count {
        0..1_000 => format!("★ {count}"),
        1_000..10_000 => format!("★ {:.1}k", f64::from(count) / 1000.),
        _ => format!("★ {}k", (f64::from(count) / 1000.).round()),
    }
}
/// The guide's first model, one paste in the shell: install Ollama with
/// its official script when missing, wait for its server, then
/// `ollama run` (which downloads the model first).
const STARTER_MACOS: &str = "command -v ollama >/dev/null 2>&1 || curl -fsSL https://ollama.com/install.sh | sh; ollama list >/dev/null 2>&1 || { open -a Ollama --args hidden; for i in $(seq 30); do ollama list >/dev/null 2>&1 && break; sleep 1; done; }; ollama run qwen3.5:9b";
const STARTER_WINDOWS: &str = "if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { irm https://ollama.com/install.ps1 | iex; $env:Path += \";$env:LOCALAPPDATA\\Programs\\Ollama\" }; if (-not (ollama list 2>$null)) { Start-Process ollama -ArgumentList serve -WindowStyle Hidden; Start-Sleep 3 }; ollama run qwen3.5:9b";
const STARTER_UNIX: &str = "command -v ollama >/dev/null 2>&1 || curl -fsSL https://ollama.com/install.sh | sh; ollama list >/dev/null 2>&1 || { (ollama serve >/dev/null 2>&1 &); for i in $(seq 30); do ollama list >/dev/null 2>&1 && break; sleep 1; done; }; ollama run qwen3.5:9b";
/// The command for this system's shell.
fn starter() -> &'static str {
    use crate::platform::conventions::{Conventions, LocalModelStarter};
    match Conventions::current().local_model_starter {
        LocalModelStarter::MacosTerminal => STARTER_MACOS,
        LocalModelStarter::PowerShell => STARTER_WINDOWS,
        LocalModelStarter::PosixShell => STARTER_UNIX,
    }
}
/// Models a discovered service shows before `Show all`.
const SHOWN_MODELS: usize = 4;

/// A model under a discovered or installed service, indented to its name.
fn model_line(t: Theme, id: impl Into<ElementId>, name: String) -> Stateful<Div> {
    h_flex()
        .id(id)
        .w_full()
        .min_w_0()
        .min_h(px(26.))
        .pl(px(36.))
        .pr(px(8.))
        .gap(px(10.))
        .rounded(px(6.))
        .text_size(px(theme::ty().ui.caption))
        .text_color(t.muted)
        .child(div().flex_1().min_w_0().truncate().child(name))
}

impl ModelConnections {
    /// Saved local services, services discovery found (`Connect` binds in
    /// one step) and installed services that are not running (`Start`).
    pub(super) fn local_category(&self, t: Theme, cx: &mut Context<Self>) -> SettingsCategory {
        let mut rows: Vec<AnyElement> = self
            .items
            .iter()
            .filter(|c| c.source_kind == SourceKind::Local)
            .enumerate()
            .map(|(index, item)| self.connection_row(item, ("connection-local", index), t, cx))
            .collect();
        let candidates: Vec<_> = self
            .discovery
            .candidates
            .iter()
            .filter(|c| !self.items.iter().any(|i| i.endpoint == c.endpoint))
            .cloned()
            .collect();
        if rows.is_empty()
            && candidates.is_empty()
            && self.discovery.stopped.is_empty()
            && self.loaded
        {
            rows.push(
                table_row(t)
                    .text_color(t.subtle)
                    .child(tr(if self.discover_rx.is_some() {
                        "settings.modelConnections.discovering"
                    } else {
                        "settings.modelConnections.empty.local"
                    }))
                    .into_any_element(),
            );
        }
        for (index, candidate) in candidates.into_iter().enumerate() {
            rows.extend(self.candidate_rows(index, candidate, t, cx));
        }
        for (index, stopped) in self.discovery.stopped.iter().enumerate() {
            rows.extend(self.stopped_rows(index, stopped, t, cx));
        }
        rows.extend(self.inline_error(ErrorAt::Local, t));
        let discovering = self.discover_rx.is_some();
        let actions = h_flex()
            .gap(px(8.))
            .child(
                text_action(
                    t,
                    "discover-local-models",
                    if discovering {
                        "loader-circle"
                    } else {
                        "refresh-cw"
                    },
                    12.,
                    tr(if discovering {
                        "settings.modelConnections.discovering"
                    } else {
                        "settings.modelConnections.discover"
                    })
                    .into(),
                )
                .tooltip(tr("settings.modelConnections.discoveryHelp"))
                .on_click(cx.listener(|s, _, _, cx| s.discover(cx))),
            )
            .child(
                text_action(
                    t,
                    "add-local",
                    "plus",
                    14.,
                    tr("settings.modelConnections.add").into(),
                )
                .tooltip(tr("settings.modelConnections.add.local"))
                .on_click(cx.listener(|s, _, _, cx| {
                    s.navigate(PageState::Add(SourceKind::Local, None, None), cx)
                })),
            );
        SettingsCategory::new(tr("settings.modelConnections.source.local"))
            .action(actions)
            .body(table(t, rows))
    }

    /// A running service: `Connect` binds it with the best model; each model
    /// it serves can be added on its own.
    fn candidate_rows(
        &self,
        index: usize,
        candidate: Candidate,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let connecting = self.connecting.as_deref() == Some(candidate.endpoint.as_str());
        let provider = registry::local_for(candidate.driver);
        let detail: SharedString = if candidate.needs_key {
            tr("native.modelConnections.readsKey").into()
        } else if candidate.models.is_empty() {
            tf(
                "native.modelConnections.foundEmpty",
                &[("endpoint", candidate.endpoint.clone().into())],
            )
            .into()
        } else {
            tf(
                "native.modelConnections.foundModels",
                &[
                    ("count", candidate.models.len().to_string().into()),
                    ("endpoint", candidate.endpoint.clone().into()),
                ],
            )
            .into()
        };
        let (customize, connect) = (candidate.clone(), candidate.clone());
        let mut rows = vec![
            table_row(t)
                .id(("candidate", index))
                .child(row_mark(t, provider, SourceKind::Local))
                .child(identity(t, candidate.name.clone().into(), detail))
                .child(
                    text_action(
                        t,
                        ("customize-candidate", index),
                        "settings",
                        12.,
                        tr("native.modelConnections.customize").into(),
                    )
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.navigate(
                            PageState::Add(SourceKind::Local, Some(customize.clone()), None),
                            cx,
                        )
                    })),
                )
                // A service listing no model has nothing to connect yet.
                .when(candidate.needs_key || !candidate.models.is_empty(), |row| {
                    row.child(
                        Button::new(("connect-candidate", index))
                            .variant(ButtonVariant::OutlinePrimary)
                            .label(tr(if connecting {
                                "native.modelConnections.connecting"
                            } else {
                                "settings.modelConnections.connect"
                            }))
                            .disabled(self.busy)
                            .on_click(cx.listener(move |s, _, _, cx| {
                                s.quick_connect(connect.clone(), None, cx)
                            })),
                    )
                })
                .into_any_element(),
        ];
        let expanded = self.expanded.as_deref() == Some(candidate.endpoint.as_str());
        let shown = if expanded {
            candidate.models.len()
        } else {
            SHOWN_MODELS
        };
        for (n, model) in candidate.models.iter().take(shown).enumerate() {
            let adding = self.connecting.as_deref()
                == Some(format!("{}#{model}", candidate.endpoint).as_str());
            let (target, chosen) = (candidate.clone(), model.clone());
            rows.push(
                model_line(t, ("candidate-model", index * 1000 + n), model.clone())
                    .hover(move |s| s.bg(t.hover))
                    .child(
                        text_action(
                            t,
                            ("add-candidate-model", index * 1000 + n),
                            if adding { "loader-circle" } else { "plus" },
                            12.,
                            tr(if adding {
                                "native.modelConnections.connecting"
                            } else {
                                "native.modelConnections.addModel"
                            })
                            .into(),
                        )
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.quick_connect(target.clone(), Some(chosen.clone()), cx)
                        })),
                    )
                    .into_any_element(),
            );
        }
        if candidate.models.len() > SHOWN_MODELS {
            let endpoint = candidate.endpoint.clone();
            let label = if expanded {
                tr("native.modelConnections.showFewer").to_string()
            } else {
                tf(
                    "native.modelConnections.showAll",
                    &[("count", candidate.models.len().to_string().into())],
                )
                .to_string()
            };
            rows.push(
                model_line(t, ("candidate-more", index), String::new())
                    .child(
                        text_action(
                            t,
                            ("toggle-candidate-models", index),
                            if expanded {
                                "chevron-up"
                            } else {
                                "chevron-down"
                            },
                            12.,
                            label.into(),
                        )
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.expanded = if s.expanded.as_deref() == Some(endpoint.as_str()) {
                                None
                            } else {
                                Some(endpoint.clone())
                            };
                            cx.notify();
                        })),
                    )
                    .into_any_element(),
            );
        }
        rows
    }

    /// An installed app that is not serving: `Start`, and the models it has
    /// downloaded, which become addable once it runs.
    fn stopped_rows(
        &self,
        index: usize,
        stopped: &Installed,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let starting = self
            .starting
            .as_ref()
            .is_some_and(|(d, _)| *d == stopped.driver);
        let detail: SharedString = if stopped.models.is_empty() {
            tr("native.modelConnections.installed").into()
        } else {
            tf(
                "native.modelConnections.installedModels",
                &[("count", stopped.models.len().to_string().into())],
            )
            .into()
        };
        let driver = stopped.driver;
        let mut rows = vec![
            table_row(t)
                .id(("stopped", index))
                .child(row_mark(t, registry::local_for(driver), SourceKind::Local))
                .child(identity(t, stopped.name.into(), detail))
                .child(
                    Button::new(("start-service", index))
                        .icon(if starting {
                            Icon::new("loader-circle").spinning(("start-spin", index))
                        } else {
                            Icon::new("play")
                        })
                        .label(tr(if starting {
                            "native.modelConnections.starting"
                        } else {
                            "native.modelConnections.start"
                        }))
                        .disabled(self.starting.is_some())
                        .on_click(cx.listener(move |s, _, _, cx| s.start_service(driver, cx))),
                )
                .into_any_element(),
        ];
        if !stopped.models.is_empty() {
            let mut names = stopped
                .models
                .iter()
                .take(SHOWN_MODELS)
                .cloned()
                .collect::<Vec<_>>()
                .join(" · ");
            if stopped.models.len() > SHOWN_MODELS {
                names.push_str(" · …");
            }
            rows.push(model_line(t, ("stopped-models", index), names).into_any_element());
        }
        rows
    }

    /// Where to get a local model app: one row per app with its page, and
    /// a first model to pull. Open when no local model exists, else folded.
    pub(super) fn guide_category(
        &self,
        t: Theme,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> SettingsCategory {
        // A model to use exists: a saved local connection, or a service or
        // app with models. Services without any keep the guide open.
        let local = self
            .items
            .iter()
            .any(|c| c.source_kind == SourceKind::Local)
            || self
                .discovery
                .candidates
                .iter()
                .any(|c| c.needs_key || !c.models.is_empty())
            || self.discovery.stopped.iter().any(|i| !i.models.is_empty());
        let open = !local || self.guide_open;
        let mut category = SettingsCategory::new(tr("native.modelConnections.guide.title"));
        if local {
            category = category.action(
                text_action(
                    t,
                    "toggle-guide",
                    if open { "chevron-up" } else { "chevron-down" },
                    12.,
                    tr(if open {
                        "native.modelConnections.guide.hide"
                    } else {
                        "native.modelConnections.guide.show"
                    })
                    .into(),
                )
                .on_click(cx.listener(|s, _, _, cx| {
                    s.guide_open = !s.guide_open;
                    cx.notify();
                })),
            );
        }
        if !open {
            return category;
        }
        // Where the user pastes [`starter`].
        let shell: crate::localization::Arg =
            match crate::platform::conventions::Conventions::current().local_model_starter {
                crate::platform::conventions::LocalModelStarter::PowerShell => "PowerShell".into(),
                _ => tr("native.modelConnections.guide.terminal")
                    .to_string()
                    .into(),
            };
        let mut rows: Vec<AnyElement> = vec![
            table_row(t)
                .id("guide-starter")
                .child(
                    Icon::new("sparkles")
                        .with_size(px(18.))
                        .stroke(1.75)
                        .color(t.muted),
                )
                .child(identity(
                    t,
                    tr("native.modelConnections.guide.starter").into(),
                    tf(
                        "native.modelConnections.guide.starterDetail",
                        &[("shell", shell)],
                    )
                    .into(),
                ))
                .child(self.copy_button(
                    "copy-starter",
                    "starter",
                    "native.modelConnections.guide.copyCommand",
                    starter().into(),
                    window,
                    cx,
                ))
                .into_any_element(),
        ];
        for (index, (id, page, star_count)) in GUIDES.into_iter().enumerate() {
            let provider = registry::get(id);
            rows.push(
                table_row(t)
                    .id(("guide", index))
                    .child(row_mark(t, provider, SourceKind::Local))
                    .child(identity(
                        t,
                        provider.map(|p| p.name).unwrap_or(id).into(),
                        match star_count {
                            Some(count) => format!(
                                "{} · {}",
                                tr(&format!("native.modelConnections.guide.{id}")),
                                stars(count)
                            ),
                            None => tr(&format!("native.modelConnections.guide.{id}")).to_string(),
                        }
                        .into(),
                    ))
                    .child(
                        text_action(
                            t,
                            ("open-guide", index),
                            "external-link",
                            12.,
                            tr("native.modelConnections.guide.get").into(),
                        )
                        .on_click(move |_, _, _| {
                            let _ = crate::platform::desktop::open_url(page);
                        }),
                    )
                    .into_any_element(),
            );
        }
        rows.push(
            table_row(t)
                .text_size(px(theme::ty().ui.caption))
                .text_color(t.subtle)
                .child(tr("native.modelConnections.guide.after"))
                .into_any_element(),
        );
        category.body(table(t, rows))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn star_counts_read_compactly() {
        assert_eq!(super::stars(187_820), "★ 188k");
        assert_eq!(super::stars(7_719), "★ 7.7k");
        assert_eq!(super::stars(950), "★ 950");
    }
}
