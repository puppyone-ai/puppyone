//! Port of `TypographySettingsView.tsx`: `TypographyScaleSetting` + `TypographyPreview`.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Page;
use crate::{
    localization::t as tr,
    theme::{self, Theme},
    typography::Scale,
    ui::components::{
        Icon, Segment, SegmentLayout, SegmentedControl, SettingRow, SettingsList, SettingsSection,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};
impl SettingsWorkspaceSurface {
    pub(super) fn typography(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let selected = self.preferences.read(cx).state.text_scale;
        let segments = [Scale::Small, Scale::Medium, Scale::Large]
            .into_iter()
            .map(|scale| {
                let prefs = self.preferences.clone();
                Segment::new(tr(scale.label_key()))
                    .selected(scale == selected)
                    .on_select(move |_, cx| {
                        prefs.update(cx, |p, cx| p.change(|p| p.text_scale = scale, cx))
                    })
            });
        SettingsSection::new(tr(Page::Typography.title()))
            .child(
                SettingsList::new()
                    .lead(true)
                    .child(
                        SettingRow::new(tr("settings.typography.textSize.title")).control(
                            SegmentedControl::new("text-scale")
                                .layout(SegmentLayout::HugFirst(9.))
                                .segments(segments),
                        ),
                    )
                    .child(preview(t)),
            )
            .into_any_element()
    }
}
/// `TypographyPreview` (`settings-controls.css`): a static workspace on the
/// live type roles: header, Files sidebar, a Markdown sample on the product
/// heading rhythm (`--po-md-h*-gap-*`) and a Chat sidebar.
fn preview(t: Theme) -> Div {
    let m = theme::ty();
    let md = crate::editor::tokens::Tokens::get(t.dark, theme::scale());
    let icon = |name: &'static str, size: f32| {
        Icon::new(name)
            .with_size(px(size))
            .stroke(2.)
            .color(t.muted)
    };
    let pane_title = || {
        h_flex()
            .gap(px(7.))
            .px(px(6.))
            .pb(px(10.))
            .font_weight(FontWeight::MEDIUM)
    };
    let file = |name: &'static str, selected: bool| {
        h_flex()
            .gap(px(6.))
            .p(px(6.))
            .pl(px(26.))
            .rounded(px(5.))
            .when(selected, |d| d.bg(t.control))
            .child(icon("file-text", 15.))
            .child(div().truncate().child(name))
    };
    // `grid-template-columns: 1fr 2.1fr 1.15fr`: the track takes its exact
    // share; padding and borders stay inside (flex would add them first).
    let track = |grow: f32, cell: Div| {
        div()
            .flex_grow(grow)
            .flex_basis(px(0.))
            .min_w_0()
            .flex()
            .child(cell.flex_1().min_w_0())
    };
    // The product draws Geist as a variable font at these exact weights;
    // the editor's static instances carry each one as its own family.
    let geist = |weight: f32| -> SharedString { format!("PuppyOne Geist {weight}").into() };
    let left = v_flex()
        .py(px(12.))
        .px(px(8.))
        .bg(t.panel)
        .border_r_1()
        .border_color(t.divider)
        .text_size(px(m.left.content))
        .line_height(px(m.left.line_height))
        .text_color(t.text)
        .child(pane_title().child(tr("shell.navigation.files")))
        .child(
            h_flex()
                .gap(px(6.))
                .p(px(6.))
                .child(icon("chevron-down", 14.))
                .child(
                    Icon::product(crate::ui::components::ProductIcon::Folder)
                        .with_size(px(15.))
                        .stroke(2.)
                        .color(t.muted),
                )
                .child("PuppyOne"),
        )
        .child(file("Notes.md", true))
        .child(file("Ideas.md", false));
    // Collapsed heading margins: max(previous after, next before).
    let gap = |name: &str| md.len(name, 16.);
    let h1_top = gap("--po-md-h1-gap-before");
    let h2_top = gap("--po-md-h1-gap-after").max(gap("--po-md-h2-gap-before"));
    let h3_top = gap("--po-md-h2-gap-after").max(gap("--po-md-h3-gap-before"));
    let p_top = gap("--po-md-h3-gap-after").max(gap("--po-md-paragraph-gap-before"));
    let heading = |size: f32, weight: f32, top: f32, text: &'static str| {
        div()
            .mt(px(top))
            .text_size(px(size))
            .line_height(px(size * 1.5))
            .font_family(geist(weight))
            .font_weight(FontWeight(weight))
            .text_color(md.color("--po-md-heading-color"))
            // 34.5 / 28.5px line boxes stay fractional, as in the product.
            .child(crate::ui::fractional_text(tr(text)))
    };
    let body = tr("settings.typography.preview.body");
    let bold = tr("settings.typography.preview.bold");
    let text = format!("{body} {bold}.");
    let strong = body.len() + 1..body.len() + 1 + bold.len();
    let strong_weight = md.number("--po-md-strong-weight");
    let body_font = |weight: f32| Font {
        family: geist(weight),
        features: FontFeatures::default(),
        fallbacks: None,
        weight: FontWeight(weight),
        style: FontStyle::Normal,
    };
    let run = |len: usize, weight: f32, color: Rgba| TextRun {
        len,
        font: body_font(weight),
        color: color.into(),
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    let content = md.color("--po-md-content-color");
    let runs = vec![
        run(strong.start, 450., content),
        run(
            strong.len(),
            strong_weight,
            md.color("--po-md-strong-color"),
        ),
        run(text.len() - strong.end, 450., content),
    ];
    let editor = v_flex()
        .p(px(18.))
        .bg(t.canvas)
        .child(heading(
            m.editor.headings[0],
            650.,
            h1_top,
            "settings.typography.preview.headingOne",
        ))
        .child(heading(
            m.editor.headings[1],
            625.,
            h2_top,
            "settings.typography.preview.headingTwo",
        ))
        .child(heading(
            m.editor.headings[2],
            600.,
            h3_top,
            "settings.typography.preview.headingThree",
        ))
        .child(
            // `.desktop-typography-preview-body`: reading weight 450, 1.75 lines.
            // Its `margin-block-end: 0` (0,2,0) loses to the Markdown
            // surface's `p` rule (0,2,1), so the source-line and paragraph
            // gaps stay below it inside the flow-root surface.
            div()
                .mt(px(p_top))
                .mb(px(md.len("--po-md-source-line-gap", m.editor.content)
                    + md.len("--po-md-paragraph-gap-after", m.editor.content)))
                .text_size(px(m.editor.content))
                .line_height(px(m.editor.content * 1.75))
                .font_family(geist(450.))
                .font_weight(FontWeight(450.))
                .text_color(content)
                // 26.25px lines: GPUI's text element would round them to 26.
                .child(crate::ui::fractional_text(text).with_runs(runs)),
        );
    let right = v_flex()
        .py(px(12.))
        .px(px(8.))
        .bg(t.panel)
        .border_l_1()
        .border_color(t.divider)
        .text_size(px(m.right.content))
        .line_height(px(m.right.control_line_height))
        .text_color(t.text)
        .child(
            pane_title()
                .child(icon("message-square", 15.))
                .child(tr("settings.typography.preview.chat")),
        )
        .child(
            v_flex()
                .px(px(6.))
                .py(px(4.))
                .child(
                    div()
                        .text_size(px(m.right.meta))
                        .line_height(px(m.right.meta_line_height))
                        .text_color(t.muted)
                        .child(tr("agent.name")),
                )
                .child(
                    div()
                        .mt(px(6.))
                        .line_height(px(m.right.content + 8.))
                        .font_family(geist(450.))
                        .font_weight(FontWeight(450.))
                        .child(tr("settings.typography.preview.message")),
                ),
        );
    v_flex()
        .mt(px(18.))
        .mx(px(10.))
        .rounded(px(10.))
        .border_1()
        .border_color(t.divider)
        .overflow_hidden()
        .bg(t.canvas)
        .child(
            h_flex()
                .min_h(px(theme::control()))
                .px(px(12.))
                .py(px(6.))
                .gap(px(8.))
                .bg(t.panel)
                .border_b_1()
                .border_color(t.divider)
                .text_size(px(m.header.content))
                .line_height(px(m.header.line_height))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.text)
                .child(
                    Icon::product(crate::ui::components::ProductIcon::Folder)
                        .with_size(px(15.))
                        .stroke(2.)
                        .color(t.muted),
                )
                .child("PuppyOne"),
        )
        .child(
            h_flex()
                .items_stretch()
                .child(track(1., left))
                .child(track(2.1, editor))
                .child(track(1.15, right)),
        )
}
