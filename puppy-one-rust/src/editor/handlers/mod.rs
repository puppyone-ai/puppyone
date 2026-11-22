//! Layer ③: Turns an [`OpenPlan`] into a live [`ViewerSurface`].
//!
//! Dispatches across built-in preset viewers (`builtin.rs`), external apps
//! (`external.rs`), and the install card stub (`install_card.rs`). Plugin
//! runtimes and conversion chains plug in here in Steps 5 and 7.

pub mod builtin;
pub mod external;
pub mod install_card;

#[cfg(test)]
mod tests;

use crate::{
    editor::{
        opening::{self, OpenPreferences, OpeningContext},
        registry::{
            self, EditorDocument, PresetViewer, SurfaceInput, SurfaceRequest, ViewerMatch,
            ViewerSurface,
        },
    },
    localization::{t, tf},
    plugin_contract::{
        CandidateStatus, Catalog, HandlerId, OpenPlan, PluginManifest, SkippedCandidate,
        UnavailableReason,
    },
};
use gpui::{App, Window};
use std::path::PathBuf;

/// Result of turning an [`OpenPlan`] into a pane surface.
pub struct OpenedHandler {
    pub handler: HandlerId,
    pub viewer: &'static PresetViewer,
    pub editable: bool,
    pub surface: Box<dyn ViewerSurface>,
    /// One-time top-of-pane explanation notice when a stored preference fell
    /// through or the primary handler failed and degraded to `plan.fallback`.
    pub notice: Option<String>,
    pub used_fallback: bool,
}

/// Inputs to [`HandlerFactory::open`].
pub struct HandlerOpenRequest<'a> {
    pub plan: &'a OpenPlan,
    pub document: &'a EditorDocument,
    pub surface: &'a SurfaceRequest<'a>,
    pub local_path: Option<PathBuf>,
    pub on_fallback: Option<external::FallbackCallback>,
    pub installed: &'a [PluginManifest],
    pub catalog: &'a Catalog,
}

/// Layer ③ factory turning an [`OpenPlan`] into a mounted [`ViewerSurface`].
#[derive(Clone, Default)]
pub struct HandlerFactory {
    external_launcher: Option<external::ExternalLauncher>,
}

impl HandlerFactory {
    pub fn new() -> Self {
        Self::default()
    }

    /// Injects a deterministic external-app launcher (used by unit tests).
    #[cfg(test)]
    pub fn with_external_launcher(launcher: external::ExternalLauncher) -> Self {
        Self {
            external_launcher: Some(launcher),
        }
    }

    /// Opens the surface specified by `req.plan`, falling back to
    /// `req.plan.fallback` with an explanation notice if the primary built-in
    /// handler cannot be opened.
    pub fn open(
        &self,
        req: &HandlerOpenRequest<'_>,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<OpenedHandler, String> {
        let empty_prefs = OpenPreferences::default();
        let label_ctx = OpeningContext::with_defaults(&empty_prefs, req.installed, req.catalog);
        let fallback_label = localized_handler_label(&req.plan.fallback, &label_ctx);
        let preference_notice = format_preference_notice(
            req.plan.preference_notice.as_ref(),
            &req.plan.handler,
            &label_ctx,
        );

        match &req.plan.handler {
            HandlerId::Builtin(viewer_id) => {
                match builtin::open(viewer_id, req.surface, window, cx) {
                    Ok((viewer, surface)) => {
                        let editable = match req.surface.input {
                            SurfaceInput::Text(text) => viewer.editable(
                                &ViewerMatch {
                                    document: req.document,
                                    format: req.surface.format,
                                },
                                text,
                            ),
                            _ => false,
                        };
                        Ok(OpenedHandler {
                            handler: req.plan.handler.clone(),
                            viewer,
                            editable,
                            surface,
                            notice: preference_notice,
                            used_fallback: false,
                        })
                    }
                    Err(err) => self.open_fallback(req, &err, window, cx),
                }
            }
            HandlerId::App(_) => {
                let local_path = req
                    .local_path
                    .clone()
                    .filter(|_| req.document.source_kind.is_local());
                let surface = external::open(
                    external::ExternalOpenOptions {
                        name: req.document.name.clone(),
                        local_path,
                        fallback_label,
                        launcher: self.external_launcher.clone(),
                        on_fallback: req.on_fallback.clone(),
                    },
                    cx,
                );
                let viewer = fallback_placeholder_viewer();
                Ok(OpenedHandler {
                    handler: req.plan.handler.clone(),
                    viewer,
                    editable: false,
                    surface,
                    notice: preference_notice,
                    used_fallback: false,
                })
            }
            HandlerId::Plugin { .. } => {
                let handler_label = localized_handler_label(&req.plan.handler, &label_ctx);
                let size_bytes = lookup_plugin_size(&req.plan.handler, req.plan, req.catalog);
                let surface = install_card::open(
                    install_card::InstallCardOptions {
                        name: req.document.name.clone(),
                        handler_id: req.plan.handler.clone(),
                        handler_label,
                        size_bytes,
                        fallback_label,
                        on_fallback: req.on_fallback.clone(),
                    },
                    cx,
                );
                let viewer = fallback_placeholder_viewer();
                Ok(OpenedHandler {
                    handler: req.plan.handler.clone(),
                    viewer,
                    editable: false,
                    surface,
                    notice: preference_notice,
                    used_fallback: false,
                })
            }
        }
    }

    fn open_fallback(
        &self,
        req: &HandlerOpenRequest<'_>,
        reason: &str,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<OpenedHandler, String> {
        let fallback_id = req
            .plan
            .fallback
            .builtin_id()
            .unwrap_or(registry::manifest().fallback_viewer_id.as_str());
        let (viewer, surface) = builtin::open(fallback_id, req.surface, window, cx)?;
        let editable = match req.surface.input {
            SurfaceInput::Text(text) => viewer.editable(
                &ViewerMatch {
                    document: req.document,
                    format: req.surface.format,
                },
                text,
            ),
            _ => false,
        };
        Ok(OpenedHandler {
            handler: HandlerId::builtin(viewer.id),
            viewer,
            editable,
            surface,
            notice: Some(reason.to_owned()),
            used_fallback: true,
        })
    }
}

fn fallback_placeholder_viewer() -> &'static PresetViewer {
    registry::registry()
        .by_id(&registry::manifest().fallback_viewer_id)
        .expect("fallback placeholder viewer is always registered")
}

fn lookup_plugin_size(handler: &HandlerId, plan: &OpenPlan, catalog: &Catalog) -> Option<u64> {
    if let Some(CandidateStatus::Installable { size_bytes }) = plan
        .alternatives
        .iter()
        .find(|alt| &alt.handler == handler)
        .map(|alt| alt.status)
    {
        return Some(size_bytes);
    }
    let (plugin_id, _) = handler.plugin_parts()?;
    catalog
        .plugins
        .iter()
        .find(|p| p.id == plugin_id)
        .and_then(|p| p.versions.first())
        .map(|v| v.archive_size_bytes)
}

/// Returns a localized display label for any [`HandlerId`].
pub fn localized_handler_label(handler: &HandlerId, ctx: &OpeningContext<'_>) -> String {
    if handler.is_system_default_app() {
        return t("editor.openDefaultApp").into();
    }
    opening::handler_display_label(handler, ctx)
}

/// Formats the one-time notice shown at the top of a pane when a stored
/// opening preference fell through to another handler (§4.3).
pub fn format_preference_notice(
    skipped: Option<&SkippedCandidate>,
    chosen_handler: &HandlerId,
    ctx: &OpeningContext<'_>,
) -> Option<String> {
    let skipped = skipped?;
    let handler_label = localized_handler_label(&skipped.handler, ctx);
    let fallback_label = localized_handler_label(chosen_handler, ctx);
    let reason_key = match skipped.reason {
        UnavailableReason::NotInstalled => "native.editor.unavailable.notInstalled",
        UnavailableReason::SourceNotAllowed => "native.editor.unavailable.sourceNotAllowed",
        UnavailableReason::PlatformUnsupported => "native.editor.unavailable.platformUnsupported",
        UnavailableReason::HostApiIncompatible => "native.editor.unavailable.hostApiIncompatible",
        UnavailableReason::AppVersionIncompatible => {
            "native.editor.unavailable.appVersionIncompatible"
        }
        UnavailableReason::SniffedExecutableDisallowed => {
            "native.editor.unavailable.sniffedExecutableDisallowed"
        }
        UnavailableReason::NotFound => "native.editor.unavailable.notFound",
    };
    Some(tf(
        "native.editor.preferenceFallbackNotice",
        &[
            ("handler", handler_label.into()),
            ("reason", t(reason_key).into()),
            ("fallback", fallback_label.into()),
        ],
    ))
}
