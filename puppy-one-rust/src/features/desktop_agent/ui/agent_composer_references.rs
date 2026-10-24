//! Reference chips and native image previews.
use super::*;
impl AgentChat {
    pub(super) fn render_references(&mut self, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let mut references = row().flex_wrap().gap(px(5.));
        for reference in &self.session.references {
            let id = reference.id.clone();
            if let crate::agent::domain::reference_input::ReferenceContent::Image { mime, data } =
                &reference.content
            {
                if !self.image_previews.contains_key(&id) {
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
                            id.clone(),
                            std::sync::Arc::new(Image::from_bytes(format, bytes)),
                        );
                    }
                }
                if let Some(image) = self.image_previews.get(&id) {
                    references = references.child(
                        img(image.clone())
                            .size(px(56.))
                            .object_fit(ObjectFit::Contain),
                    );
                }
            }
            let remove = crate::localization::tf(
                "agent.reference.remove",
                &[("name", reference.name.clone().into())],
            );
            references = references.child(
                row()
                    .h(px(crate::theme::control_tight()))
                    .pl(px(7.))
                    .pr(px(2.))
                    .gap(px(4.))
                    .rounded(px(6.))
                    .border_1()
                    .border_color(t.divider)
                    .bg(crate::theme::alpha(t.active, 0.92))
                    .text_size(px(crate::theme::ty().left.meta))
                    .text_color(t.sidebar_text)
                    .child(crate::ui::icon_sized("file", 12., t.subtle))
                    .child(
                        div()
                            .max_w(px(180.))
                            .truncate()
                            .child(reference.name.clone()),
                    )
                    .child(
                        crate::ui::icon_button(
                            SharedString::from(format!("reference-{id}")),
                            "x",
                            t,
                        )
                        .size(px(18.))
                        .accessibility_label(remove)
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.session.references.retain(|r| r.id != id);
                            cx.notify();
                        })),
                    ),
            );
        }
        self.image_previews
            .retain(|id, _| self.session.references.iter().any(|r| &r.id == id));
        if self.attachment_rx.is_some() {
            references = references.child(
                div()
                    .text_size(px(crate::theme::ty().left.meta))
                    .text_color(t.subtle)
                    .child(crate::localization::t("agent.reference.resolving")),
            );
        }

        references
    }
}
