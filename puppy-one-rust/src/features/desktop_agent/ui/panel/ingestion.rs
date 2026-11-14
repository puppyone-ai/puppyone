//! `useAgentReferenceIngestion`: files dropped, pasted or picked from this
//! computer, and Explorer entries, become the draft's references.
use super::AgentChatTabPanel;
use crate::features::desktop_agent::application::agent_client_port::{AgentFile, AgentFileSource};
use crate::features::desktop_agent::ui::composer::mime_for;
use crate::localization::t;
use gpui::*;
use std::path::PathBuf;

impl AgentChatTabPanel {
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
            drop(self.controller.stage_external_files(files));
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
            drop(self.controller.stage_external_files(files));
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
        drop(self.controller.add_workspace_paths(paths, Vec::new()));
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
}
