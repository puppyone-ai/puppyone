//! `useAgentReferenceIngestion`: files dropped, pasted or picked from this
//! computer, and Explorer entries, become the draft's references; a status
//! says how many a batch added and how many could not be, and a drag from
//! another workspace is refused.
use super::AgentChatTabPanel;
use crate::agent::contract::dto::ReferenceStatus;
use crate::features::desktop_agent::application::agent_client_port::{AgentFile, AgentFileSource};
use crate::features::desktop_agent::ui::composer::mime_for;
use crate::localization::{t, tf};
use crate::ui::resource_drag::ResourceDrag;
use gpui::*;
use std::{collections::HashSet, path::PathBuf};

impl AgentChatTabPanel {
    /// The draft's references now, to tell a batch's own failures apart.
    fn reference_ids(&self) -> HashSet<String> {
        self.controller
            .get_snapshot()
            .references
            .iter()
            .map(|r| r.id.clone())
            .collect()
    }

    /// `announceBatchResult`: once `batch` ends, how many it added and how
    /// many of its own references could not be added.
    fn announce_batch<E>(
        &mut self,
        before: HashSet<String>,
        batch: impl Future<Output = Result<usize, E>> + 'static,
        cx: &mut Context<Self>,
    ) {
        cx.spawn(async move |this, cx| {
            let Ok(count) = batch.await else {
                return;
            };
            let _ = this.update(cx, |s, cx| {
                let failed = s
                    .controller
                    .get_snapshot()
                    .references
                    .iter()
                    .filter(|r| r.status == ReferenceStatus::Error && !before.contains(&r.id))
                    .count();
                let text = if failed > 0 {
                    tf(
                        "agent.reference.batchPartial",
                        &[("count", count.into()), ("failed", failed.into())],
                    )
                } else {
                    tf("agent.reference.batchResult", &[("count", count.into())])
                };
                s.announce(text, cx);
            });
        })
        .detach();
    }

    /// Workspace entries dropped on the chat: only this chat's workspace
    /// grants its paths; an entry of another is refused and said so.
    pub(super) fn drop_resources(&mut self, drag: &ResourceDrag, cx: &mut Context<Self>) {
        let Some(root) = drag.workspace.as_ref().and_then(|w| w.local_root()) else {
            self.announce(t("agent.reference.resourceUnavailable"), cx);
            return;
        };
        if !same_root(root, std::path::Path::new(self.controller.workspace_root())) {
            self.announce(t("agent.reference.workspaceMismatch"), cx);
            return;
        }
        if let Some(paths) = drag.local_paths() {
            self.add_workspace_paths(paths, cx);
        }
    }

    fn announce(&mut self, text: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.announcement = Some(text.into());
        cx.notify();
    }

    /// Files dropped from outside the workspace (`useAgentReferenceIngestion`).
    pub(super) fn add_external_paths(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        let mut files = Vec::new();
        for path in paths {
            if path.is_dir() {
                drop(
                    self.controller
                        .add_path_text_or_draft(&path.to_string_lossy()),
                );
                continue;
            }
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let size = std::fs::metadata(&path)
                .map(|m| m.len() as f64)
                .unwrap_or(0.);
            files.push(AgentFile {
                mime: mime_for(&name).into(),
                name,
                size,
                source: AgentFileSource::Path(path.to_string_lossy().into_owned()),
            });
        }
        if !files.is_empty() {
            let before = self.reference_ids();
            let batch = self.controller.stage_external_files(files);
            self.announce_batch(before, batch, cx);
        }
        cx.notify();
    }

    /// `onPaste`: images and files from the clipboard (`stageExternalFiles`).
    pub(super) fn paste_files(
        &mut self,
        pasted: &crate::ui::form_input::PastedFiles,
        cx: &mut Context<Self>,
    ) {
        let files: Vec<AgentFile> = pasted
            .images
            .iter()
            .enumerate()
            .map(|(index, image)| {
                let (extension, mime) = match image.format {
                    ImageFormat::Jpeg => ("jpg", "image/jpeg"),
                    ImageFormat::Gif => ("gif", "image/gif"),
                    ImageFormat::Webp => ("webp", "image/webp"),
                    ImageFormat::Svg => ("svg", "image/svg+xml"),
                    ImageFormat::Bmp => ("bmp", "image/bmp"),
                    ImageFormat::Tiff => ("tiff", "image/tiff"),
                    _ => ("png", "image/png"),
                };
                AgentFile {
                    name: format!("pasted-image-{}.{extension}", index + 1),
                    mime: mime.into(),
                    size: image.bytes.len() as f64,
                    source: AgentFileSource::Bytes(std::rc::Rc::new(image.bytes.clone())),
                }
            })
            .collect();
        if !files.is_empty() {
            let before = self.reference_ids();
            let batch = self.controller.stage_external_files(files);
            self.announce_batch(before, batch, cx);
        }
        if !pasted.paths.is_empty() {
            self.add_external_paths(pasted.paths.clone(), cx);
        }
        cx.notify();
    }

    /// Explorer entries: workspace-relative paths.
    pub(super) fn add_workspace_paths(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        let paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        let before = self.reference_ids();
        let batch = self.controller.add_workspace_paths(paths, Vec::new());
        self.announce_batch(before, batch, cx);
        cx.notify();
    }

    pub(super) fn pick_external_files(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some(t("agent.reference.addFromComputer").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = prompt.await {
                let _ = this.update(cx, |s, cx| s.add_external_paths(paths, cx));
            }
        })
        .detach();
    }

    /// Stages HTML File Mode context (`@<workspace_rel_path>`, optional PNG
    /// screenshot/annotation bytes, and structured prompt text) into the composer
    /// and focuses the prompt editor.
    pub fn stage_html_context(
        &mut self,
        workspace_rel_path: &str,
        png: Option<(String, Vec<u8>)>,
        prompt: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let ws_task = if !workspace_rel_path.is_empty() {
            let already = self
                .controller
                .get_snapshot()
                .references
                .iter()
                .any(|r| r.relative_path.as_deref() == Some(workspace_rel_path));
            (!already).then(|| {
                self.controller
                    .add_workspace_paths(vec![workspace_rel_path.to_owned()], Vec::new())
            })
        } else {
            None
        };
        let png_task = png.map(|(name, bytes)| {
            self.controller.stage_external_files(vec![AgentFile {
                name,
                mime: "image/png".into(),
                size: bytes.len() as f64,
                source: AgentFileSource::Bytes(std::rc::Rc::new(bytes)),
            }])
        });
        let prompt = prompt.to_owned();
        self.composer.update(cx, |c, cx| c.focus(window, cx));
        cx.spawn_in(window, async move |this, cx| {
            if let Some(task) = ws_task {
                let _ = task.await;
            }
            if let Some(task) = png_task {
                let _ = task.await;
            }
            // First update inserts any new `@file` mention tokens and flushes
            // `ComposerEvent::DraftChanged` before we append `prompt`.
            let _ = this.update_in(cx, |this, window, cx| {
                let state = this.state();
                let view = this.view_model(&state);
                this.sync_composer(&state, &view, window, cx);
            });
            let _ = this.update_in(cx, |this, window, cx| {
                if !prompt.is_empty() {
                    let (mut draft_text, mentions) = this.composer.read(cx).document(cx);
                    if !draft_text.is_empty() && !draft_text.ends_with([' ', '\n']) {
                        draft_text.push('\n');
                    }
                    draft_text.push_str(&prompt);
                    this.controller.set_draft_document(&draft_text, &mentions);
                    let state = this.state();
                    let view = this.view_model(&state);
                    this.sync_composer(&state, &view, window, cx);
                }
                this.composer.update(cx, |c, cx| c.focus(window, cx));
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    #[cfg(test)]
    pub fn debug_staged_summary(&self) -> (String, Vec<String>) {
        let snap = self.controller.get_snapshot();
        let refs = snap
            .references
            .iter()
            .map(|r| {
                r.relative_path
                    .clone()
                    .unwrap_or_else(|| r.display_name.clone())
            })
            .collect();
        (snap.draft, refs)
    }
}

/// Whether two workspace roots are the same folder.
fn same_root(a: &std::path::Path, b: &std::path::Path) -> bool {
    a == b
        || a.canonicalize()
            .ok()
            .zip(b.canonicalize().ok())
            .is_some_and(|(a, b)| a == b)
}
