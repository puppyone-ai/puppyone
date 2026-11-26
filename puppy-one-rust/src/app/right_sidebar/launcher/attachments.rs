//! Pre-launch file, folder, and image attachment ingestion, inline `@mention`
//! token rendering, visual thumbnail shelf, and seeded handoff to a newly
//! created local Agent chat tab.
use super::state::{StagedAttachment, StagedAttachmentKind, same_root, workspace_relative_path};
use super::*;
use crate::agent::contract::reference_input::classify_agent_attachment;
use crate::features::desktop_agent::{
    AgentTheme, SeededAttachment, SeededPromptSegment, SeededSubmission, mention_chip, mime_for,
};
use crate::localization::{Arg, t as tr, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Icon, tooltip};
use crate::ui::form_input::{PastedFiles, TokenRenderer};
use crate::ui::resource_drag::ResourceDrag;
use gpui_kit::base::h_flex;
use std::path::PathBuf;
use std::sync::Arc;

/// Thumbnail card height on the visual attachment shelf (matches active chat).
const CARD: f32 = 40.;

/// Renders atomic inline `@path` mention tokens inside the launcher composer
/// using the exact shared [`mention_chip`] primitive from active Agent Chat.
pub(super) fn launcher_token_renderer() -> TokenRenderer {
    Rc::new(|token, _, cx| {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let label = token.token().label().to_string();
        mention_chip(&a, label, false)
            .when(token.is_selected(), |d| d.bg(theme::alpha(a.accent, 0.16)))
            .into_any_element()
    })
}

fn is_image_path(path: &std::path::Path, display_name: &str) -> (String, bool) {
    if path.is_dir() {
        return (String::new(), false);
    }
    let mime = mime_for(display_name).to_owned();
    let is_image = classify_agent_attachment(&mime, display_name) == "image";
    (mime, is_image)
}

fn visual_image_source(attachment: &StagedAttachment) -> Option<ImageSource> {
    match &attachment.kind {
        StagedAttachmentKind::PastedImage {
            mime,
            format,
            bytes,
        } => {
            if mime == "image/svg+xml"
                || attachment
                    .display_name
                    .to_ascii_lowercase()
                    .ends_with(".svg")
            {
                let raster = crate::platform::svg::rasterize_svg(bytes, 2.0).ok()?;
                let buf = image::RgbaImage::from_raw(
                    raster.pixel_width,
                    raster.pixel_height,
                    raster.bgra,
                )?;
                return Some(ImageSource::Render(Arc::new(RenderImage::new(vec![
                    image::Frame::new(buf),
                ]))));
            }
            Some(ImageSource::from(Arc::new(Image::from_bytes(
                *format,
                (**bytes).clone(),
            ))))
        }
        StagedAttachmentKind::WorkspacePath { path, .. }
        | StagedAttachmentKind::ExternalFile { path, .. } => {
            let is_svg = path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("svg"));
            if is_svg {
                let bytes = std::fs::read(path).ok()?;
                let raster = crate::platform::svg::rasterize_svg(&bytes, 2.0).ok()?;
                let buf = image::RgbaImage::from_raw(
                    raster.pixel_width,
                    raster.pixel_height,
                    raster.bgra,
                )?;
                Some(ImageSource::Render(Arc::new(RenderImage::new(vec![
                    image::Frame::new(buf),
                ]))))
            } else {
                Some(ImageSource::from(path.clone()))
            }
        }
    }
}

impl WorkbenchLauncher {
    /// Handles workspace entries dragged from the left Explorer onto the
    /// launcher page or composer card. Refuses drags from other workspaces or
    /// non-local/Cloud projects with the same localized status notices as an
    /// active Agent Chat tab.
    pub(super) fn drop_resources(
        &mut self,
        slot: LauncherSlot,
        group: Id,
        tab: Option<Id>,
        drag: &ResourceDrag,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.hosted.is_open() {
            self.set_notice(slot, tr("agent.reference.resourceUnavailable"), cx);
            return;
        }
        let Some(drag_root) = drag.workspace.as_ref().and_then(|w| w.local_root()) else {
            self.set_notice(slot, tr("agent.reference.resourceUnavailable"), cx);
            return;
        };
        let Some(shown_root) = self.shown.root.clone() else {
            self.set_notice(slot, tr("agent.reference.resourceUnavailable"), cx);
            return;
        };
        if !same_root(drag_root, &shown_root) {
            self.set_notice(slot, tr("agent.reference.workspaceMismatch"), cx);
            return;
        }
        if let Some(paths) = drag.local_paths() {
            self.add_workspace_paths(slot, group, tab, paths, window, cx);
        }
    }

    /// Stages workspace-scoped local paths on `slot`: raster/SVG images appear
    /// on the 40px visual shelf; all other files/folders insert atomic
    /// `@relative/path` mention tokens into the page's prompt input.
    pub(super) fn add_workspace_paths(
        &mut self,
        slot: LauncherSlot,
        group: Id,
        tab: Option<Id>,
        paths: Vec<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.hosted.is_open() {
            return;
        }
        let Some(root) = self.shown.root.clone() else {
            self.set_notice(slot, tr("agent.reference.resourceUnavailable"), cx);
            return;
        };
        let input = self.ensure_page_input(slot, group, tab, window, cx);
        self.clear_notice(slot);

        let mut token_insertions: Vec<(String, String)> = Vec::new();
        let mut mismatched = false;

        for path in paths {
            let Some(relative_path) = workspace_relative_path(&root, &path) else {
                mismatched = true;
                continue;
            };
            let display_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| relative_path.clone());
            let (_mime, is_image) = is_image_path(&path, &display_name);

            let already = self.pages.get(&slot).is_some_and(|page| {
                page.attachments.iter().any(|att| {
                    matches!(
                        &att.kind,
                        StagedAttachmentKind::WorkspacePath { relative_path: rel, .. }
                            if rel == &relative_path
                    )
                })
            });
            if already {
                continue;
            }

            let id = self.page_mut(slot, cx).alloc_attachment_id();
            if !is_image {
                token_insertions.push((id.clone(), format!("@{relative_path}")));
            }
            self.page_mut(slot, cx).attachments.push(StagedAttachment {
                id,
                display_name,
                is_image,
                kind: StagedAttachmentKind::WorkspacePath {
                    path,
                    relative_path,
                },
            });
        }

        if mismatched && token_insertions.is_empty() && !self.has_attachments(slot) {
            self.set_notice(slot, tr("agent.reference.workspaceMismatch"), cx);
        } else if mismatched {
            self.set_notice(slot, tr("agent.reference.workspaceMismatch"), cx);
        }

        if !token_insertions.is_empty() {
            input.update(cx, |i, cx| {
                i.insert_tokens(&token_insertions, window, cx);
            });
        }
        input.focus_handle(cx).focus(window, cx);
        cx.notify();
    }

    /// Handles external files/folders dropped from OS Finder, pasted from the
    /// clipboard, or chosen via "Add from computer". Paths inside the active
    /// workspace root are automatically normalized as workspace references.
    pub(super) fn add_external_paths(
        &mut self,
        slot: LauncherSlot,
        group: Id,
        tab: Option<Id>,
        paths: Vec<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.hosted.is_open() {
            return;
        }
        let input = self.ensure_page_input(slot, group, tab, window, cx);
        self.clear_notice(slot);

        let root = self.shown.root.clone();
        let mut workspace_paths = Vec::new();
        let mut token_insertions: Vec<(String, String)> = Vec::new();
        let mut dir_texts: Vec<String> = Vec::new();

        for path in paths {
            if let Some(root) = root.as_ref()
                && workspace_relative_path(root, &path).is_some()
            {
                workspace_paths.push(path);
                continue;
            }
            if path.is_dir() {
                dir_texts.push(path.to_string_lossy().into_owned());
                continue;
            }
            let display_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if display_name.is_empty() {
                continue;
            }
            let (mime, is_image) = is_image_path(&path, &display_name);
            let already = self.pages.get(&slot).is_some_and(|page| {
                page.attachments.iter().any(|att| {
                    matches!(
                        &att.kind,
                        StagedAttachmentKind::ExternalFile { path: existing, .. }
                            if existing == &path
                    )
                })
            });
            if already {
                continue;
            }

            let id = self.page_mut(slot, cx).alloc_attachment_id();
            if !is_image {
                token_insertions.push((id.clone(), format!("@{display_name}")));
            }
            self.page_mut(slot, cx).attachments.push(StagedAttachment {
                id,
                display_name,
                is_image,
                kind: StagedAttachmentKind::ExternalFile { path, mime },
            });
        }

        if !workspace_paths.is_empty() {
            self.add_workspace_paths(slot, group, tab, workspace_paths, window, cx);
        }
        if !token_insertions.is_empty() {
            input.update(cx, |i, cx| {
                i.insert_tokens(&token_insertions, window, cx);
            });
        }
        for dir_text in dir_texts {
            input.update(cx, |i, cx| i.insert_text(&dir_text, window, cx));
        }
        input.focus_handle(cx).focus(window, cx);
        cx.notify();
    }

    /// Handles clipboard paste (`⌘V`) of images or files into the launcher
    /// composer.
    pub(super) fn paste_files(
        &mut self,
        slot: LauncherSlot,
        group: Id,
        tab: Option<Id>,
        pasted: &PastedFiles,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.hosted.is_open() {
            return;
        }
        self.clear_notice(slot);
        let existing_pasted = self
            .pages
            .get(&slot)
            .map(|p| {
                p.attachments
                    .iter()
                    .filter(|a| matches!(a.kind, StagedAttachmentKind::PastedImage { .. }))
                    .count()
            })
            .unwrap_or(0);

        for (index, image) in pasted.images.iter().enumerate() {
            let (extension, mime) = match image.format {
                ImageFormat::Jpeg => ("jpg", "image/jpeg"),
                ImageFormat::Gif => ("gif", "image/gif"),
                ImageFormat::Webp => ("webp", "image/webp"),
                ImageFormat::Svg => ("svg", "image/svg+xml"),
                ImageFormat::Bmp => ("bmp", "image/bmp"),
                ImageFormat::Tiff => ("tiff", "image/tiff"),
                _ => ("png", "image/png"),
            };
            let display_name = format!("pasted-image-{}.{extension}", existing_pasted + index + 1);
            let id = self.page_mut(slot, cx).alloc_attachment_id();
            self.page_mut(slot, cx).attachments.push(StagedAttachment {
                id,
                display_name,
                is_image: true,
                kind: StagedAttachmentKind::PastedImage {
                    mime: mime.to_owned(),
                    format: image.format,
                    bytes: Arc::new(image.bytes.clone()),
                },
            });
        }

        if !pasted.paths.is_empty() {
            self.add_external_paths(slot, group, tab, pasted.paths.clone(), window, cx);
        } else if !pasted.images.is_empty() {
            cx.notify();
        }
    }

    /// Opens the OS file picker for "Add from computer".
    pub(super) fn pick_external_files(
        &mut self,
        slot: LauncherSlot,
        group: Id,
        tab: Option<Id>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.hosted.is_open() {
            return;
        }
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some(tr("agent.reference.addFromComputer").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = prompt.await {
                let _ = this.update_in(cx, |s, window, cx| {
                    s.add_external_paths(slot, group, tab, paths, window, cx);
                });
            }
        })
        .detach();
    }

    /// Opens the OS file/folder picker for "Add from workspace", validating
    /// that chosen entries belong to the shown workspace root.
    pub(super) fn pick_workspace_files(
        &mut self,
        slot: LauncherSlot,
        group: Id,
        tab: Option<Id>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.hosted.is_open() {
            return;
        }
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: true,
            multiple: true,
            prompt: Some(tr("agent.reference.addFromWorkspace").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = prompt.await {
                let _ = this.update_in(cx, |s, window, cx| {
                    s.add_workspace_paths(slot, group, tab, paths, window, cx);
                });
            }
        })
        .detach();
    }

    /// Removes one staged attachment (from the visual shelf or inline editor).
    pub(super) fn remove_attachment(
        &mut self,
        slot: LauncherSlot,
        id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let removed = self
            .pages
            .get_mut(&slot)
            .is_some_and(|p| p.remove_attachment(id));
        if let Some(input) = self.pages.get(&slot).and_then(|p| p.input.clone()) {
            input.update(cx, |i, cx| {
                i.remove_token(id, window, cx);
            });
        }
        if removed {
            cx.notify();
        }
    }

    /// Synchronizes `page.attachments` whenever the user edits `page.input`,
    /// removing any non-image attachment whose `@mention` chip was deleted.
    pub(super) fn sync_page_attachments(&mut self, slot: LauncherSlot, cx: &App) {
        let Some(input) = self.pages.get(&slot).and_then(|p| p.input.clone()) else {
            return;
        };
        let live_tokens = input.read(cx).token_ids(cx);
        if let Some(page) = self.pages.get_mut(&slot) {
            page.retain_token_attachments(&live_tokens);
        }
    }

    /// Snapshots the launcher page's current text, inline mention positions,
    /// and staged attachments into a [`SeededSubmission`] for handoff to a new
    /// [`crate::features::desktop_agent::AgentChatTabPanel`].
    pub(super) fn build_seeded_submission(&self, slot: LauncherSlot, cx: &App) -> SeededSubmission {
        let Some(page) = self.pages.get(&slot) else {
            return SeededSubmission::default();
        };
        let Some(input) = page.input.as_ref() else {
            return SeededSubmission::default();
        };
        let text = input.read(cx).current_text(cx);
        let mut spans = input.read(cx).token_spans(cx);
        spans.sort_by_key(|(_, range)| range.start);

        let attachments: Vec<SeededAttachment> = page
            .attachments
            .iter()
            .map(|att| match &att.kind {
                StagedAttachmentKind::WorkspacePath {
                    path,
                    relative_path,
                } => SeededAttachment::WorkspacePath {
                    path: path.clone(),
                    relative_path: relative_path.clone(),
                },
                StagedAttachmentKind::ExternalFile { path, mime } => {
                    SeededAttachment::ExternalFile {
                        path: path.clone(),
                        display_name: att.display_name.clone(),
                        mime: mime.clone(),
                    }
                }
                StagedAttachmentKind::PastedImage { mime, bytes, .. } => {
                    SeededAttachment::PastedImage {
                        name: att.display_name.clone(),
                        mime: mime.clone(),
                        bytes: bytes.clone(),
                    }
                }
            })
            .collect();

        let mut segments = Vec::new();
        let mut cursor = 0usize;
        for (token_id, range) in spans {
            if range.start < cursor
                || range.end > text.len()
                || !text.is_char_boundary(range.start)
                || !text.is_char_boundary(range.end)
            {
                continue;
            }
            if range.start > cursor {
                segments.push(SeededPromptSegment::Text(
                    text[cursor..range.start].to_owned(),
                ));
            }
            if let Some(idx) = page.attachments.iter().position(|att| att.id == token_id) {
                segments.push(SeededPromptSegment::Mention(idx));
            } else {
                segments.push(SeededPromptSegment::Text(
                    text[range.start..range.end].to_owned(),
                ));
            }
            cursor = range.end;
        }
        if cursor < text.len() {
            segments.push(SeededPromptSegment::Text(text[cursor..].to_owned()));
        }

        SeededSubmission {
            text,
            segments,
            attachments,
        }
    }

    /// Renders the 40px visual image attachment shelf inside the Hero Composer
    /// card (identical card geometry and hover remove button to active chat).
    pub(super) fn render_visual_attachments(
        &self,
        slot: LauncherSlot,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let images: Vec<StagedAttachment> = self
            .pages
            .get(&slot)?
            .attachments
            .iter()
            .filter(|att| att.is_image)
            .cloned()
            .collect();
        if images.is_empty() {
            return None;
        }
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let action_hover = theme::mix(t_.menu_bg, t_.text, 0.88);
        let key_id = slot.element_key();
        let mut shelf = h_flex()
            .w_full()
            .min_w_0()
            .flex_wrap()
            .items_start()
            .gap(px(10.))
            .pt(px(10.))
            .pb(px(2.))
            .px(px(14.));

        for attachment in images {
            let id = attachment.id.clone();
            let name = attachment.display_name.clone();
            let image = visual_image_source(&attachment);
            let group = SharedString::from(format!("launcher-visual-attachment-{key_id}-{id}"));
            let remove_label = tf(
                "agent.reference.remove",
                &[("name", Arg::Text(name.clone()))],
            );
            let remove_id = id.clone();
            let card_selector = format!("launcher-attachment:{name}");
            let remove_selector = format!("launcher-attachment-remove:{name}");
            shelf = shelf.child(
                div()
                    .id(SharedString::from(format!(
                        "launcher-visual-card-{key_id}-{id}"
                    )))
                    .debug_selector(move || card_selector)
                    .group(group.clone())
                    .relative()
                    .size(px(CARD))
                    .flex_shrink_0()
                    .rounded(px(6.))
                    .border_1()
                    .border_color(a.border_subtle)
                    .bg(a.row_hover)
                    .tooltip(tooltip(name))
                    .child(
                        div()
                            .size_full()
                            .rounded(px(5.))
                            .overflow_hidden()
                            .flex()
                            .items_center()
                            .justify_center()
                            .map(|d| match image {
                                Some(image) => {
                                    d.child(img(image).size_full().object_fit(ObjectFit::Cover))
                                }
                                None => d.child(
                                    Icon::new("image")
                                        .with_size(px(18.))
                                        .stroke(2.)
                                        .color(a.text_muted),
                                ),
                            }),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!(
                                "launcher-visual-remove-{key_id}-{id}"
                            )))
                            .debug_selector(move || remove_selector)
                            .absolute()
                            .top(px(-6.))
                            .right(px(-6.))
                            .size(px(20.))
                            .rounded_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(t_.menu_bg)
                            .invisible()
                            .group_hover(group, |s| s.visible())
                            .hover(move |s| s.bg(action_hover))
                            .cursor(theme::clickable_cursor())
                            .tooltip(tooltip(remove_label))
                            .on_mouse_down(MouseButton::Left, |_, _, cx| {
                                cx.stop_propagation();
                            })
                            .on_click(cx.listener(move |s, _, w, cx| {
                                cx.stop_propagation();
                                s.remove_attachment(slot, &remove_id, w, cx);
                            }))
                            .child(
                                Icon::new("x")
                                    .with_size(px(12.))
                                    .stroke(2.)
                                    .color(a.text_muted),
                            ),
                    ),
            );
        }

        Some(shelf.into_any_element())
    }
}
