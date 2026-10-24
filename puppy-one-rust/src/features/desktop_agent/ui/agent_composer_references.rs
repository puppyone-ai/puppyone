//! Composer references (`AgentVisualAttachmentList` + `AgentPromptEditor`
//! mentions, `styles/composer.css`): images sit on the 40px attachment
//! shelf above the editor; every other reference is an atomic `@path`
//! mention at the start of the prompt. Kit's editor cannot host inline
//! widgets, so mentions lead the editor's first line and Backspace on an
//! empty prompt removes the last one, like deleting an atomic range.
use super::*;
use crate::agent::domain::reference_input::{Reference, ReferenceContent};

/// `--agent-reference-card-height`.
const CARD: f32 = 40.;

impl AgentChat {
    /// `agentReferenceMentionText`: `@` + the workspace-relative path, or the
    /// display name for files from elsewhere.
    fn mention_text(&self, reference: &Reference) -> String {
        let label = std::path::Path::new(&reference.source)
            .strip_prefix(&self.root)
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| reference.name.clone());
        format!("@{label}")
    }
    fn image_preview(&mut self, reference: &Reference) -> Option<std::sync::Arc<Image>> {
        let ReferenceContent::Image { mime, data } = &reference.content else {
            return None;
        };
        if !self.image_previews.contains_key(&reference.id) {
            use base64::Engine;
            let format = match mime.as_str() {
                "image/png" => Some(ImageFormat::Png),
                "image/jpeg" => Some(ImageFormat::Jpeg),
                "image/gif" => Some(ImageFormat::Gif),
                "image/webp" => Some(ImageFormat::Webp),
                _ => None,
            };
            if let (Some(format), Ok(bytes)) = (
                format,
                base64::engine::general_purpose::STANDARD.decode(data),
            ) {
                self.image_previews.insert(
                    reference.id.clone(),
                    std::sync::Arc::new(Image::from_bytes(format, bytes)),
                );
            }
        }
        self.image_previews.get(&reference.id).cloned()
    }
    /// `.desktop-agent-visual-attachments`: 40px cards, 14px apart, inset
    /// 12px; the remove control appears on hover at the top-right corner.
    pub(super) fn render_visual_attachments(&mut self, cx: &mut Context<Self>) -> Option<Div> {
        let t = Theme::new(self.dark);
        let a = super::agent_theme::AgentTheme::new(&t);
        let images: Vec<Reference> = self
            .session
            .references
            .iter()
            .filter(|r| matches!(r.content, ReferenceContent::Image { .. }))
            .cloned()
            .collect();
        self.image_previews
            .retain(|id, _| self.session.references.iter().any(|r| &r.id == id));
        if images.is_empty() {
            return None;
        }
        let action_hover = crate::theme::mix(t.menu_bg, t.text, 0.88);
        let mut shelf = row()
            .w_full()
            .min_w_0()
            .flex_wrap()
            .items_start()
            .gap(px(14.))
            .pt(px(12.))
            .px(px(12.));
        for reference in images {
            let preview = self.image_preview(&reference);
            let id = reference.id.clone();
            let group = SharedString::from(format!("visual-attachment-{id}"));
            let remove = crate::localization::tf(
                "agent.reference.remove",
                &[("name", reference.name.clone().into())],
            );
            shelf = shelf.child(
                div()
                    .id(SharedString::from(format!("visual-attachment-card-{id}")))
                    .group(group.clone())
                    .relative()
                    .size(px(CARD))
                    .flex_shrink_0()
                    .rounded(px(6.))
                    .border_1()
                    .border_color(a.border_subtle)
                    .bg(a.row_hover)
                    .tooltip(crate::ui::tooltip(reference.name.clone()))
                    .child(
                        div()
                            .size_full()
                            .rounded(px(5.))
                            .overflow_hidden()
                            .flex()
                            .items_center()
                            .justify_center()
                            .map(|d| match preview {
                                Some(image) => d.child(
                                    img(image)
                                        .size_full()
                                        .rounded(px(5.))
                                        .object_fit(ObjectFit::Cover),
                                ),
                                None => {
                                    d.child(crate::ui::icon_stroke("image", 18., 2., a.text_muted))
                                }
                            }),
                    )
                    .child(
                        // `.desktop-agent-visual-attachment-actions`.
                        div()
                            .id(SharedString::from(format!("visual-attachment-remove-{id}")))
                            .absolute()
                            .top(px(-6.))
                            .right(px(-6.))
                            .size(px(20.))
                            .rounded_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(t.menu_bg)
                            .text_color(a.text_muted)
                            .invisible()
                            .group_hover(group, |s| s.visible())
                            .hover(move |s| s.bg(action_hover))
                            .tooltip(crate::ui::tooltip(remove))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                s.session.references.retain(|r| r.id != id);
                                cx.notify();
                            }))
                            .child(crate::ui::icon_stroke("x", 12., 2., a.text_muted)),
                    ),
            );
        }
        Some(shelf)
    }
    /// `.desktop-agent-prompt-mention` chips for path references, plus a
    /// resolving chip while new references are being read.
    pub(super) fn render_mentions(&self) -> Vec<AnyElement> {
        let t = Theme::new(self.dark);
        let a = super::agent_theme::AgentTheme::new(&t);
        let chip = |label: String, resolving: bool| {
            div()
                .flex_shrink_0()
                .mt(px(0.5))
                .px(px(4.))
                .rounded(px(4.))
                .border_1()
                .border_color(crate::theme::mix(a.accent, a.border_subtle, 0.36))
                .bg(crate::theme::alpha(a.accent, 0.16 * 0.58))
                .text_color(crate::theme::mix(a.accent, a.text, 0.78))
                .text_size(px(14.))
                .line_height(px(18.))
                .font_weight(FontWeight(450.))
                .whitespace_nowrap()
                .when(resolving, |d| d.opacity(0.68))
                .child(label)
                .into_any_element()
        };
        let mut chips: Vec<AnyElement> = self
            .session
            .references
            .iter()
            .filter(|r| !matches!(r.content, ReferenceContent::Image { .. }))
            .map(|r| chip(self.mention_text(r), false))
            .collect();
        if self.attachment_rx.is_some() {
            chips.push(chip(
                crate::localization::t("agent.reference.resolving").into(),
                true,
            ));
        }
        chips
    }
    /// Backspace on an empty prompt deletes the mention before the caret.
    pub(super) fn remove_last_mention(&mut self) -> bool {
        let Some(index) = self
            .session
            .references
            .iter()
            .rposition(|r| !matches!(r.content, ReferenceContent::Image { .. }))
        else {
            return false;
        };
        self.session.references.remove(index);
        true
    }
}
