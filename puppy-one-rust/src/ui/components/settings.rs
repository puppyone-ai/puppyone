//! Settings page building blocks: `components/SettingsControls.tsx` and
//! `styles/settings.css`. Layout only; pages own their state.
use crate::{
    theme::{self, metric},
    typography::Scale,
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use gpui_kit::base::StyledExt as _;

/// A per-text-size value (Small, Medium, Large).
fn by_scale(values: [f32; 3]) -> f32 {
    match theme::scale() {
        Scale::Small => values[0],
        Scale::Medium => values[1],
        Scale::Large => values[2],
    }
}

/// `.desktop-settings-section` with its page title and an optional action.
#[derive(IntoElement)]
pub struct SettingsSection {
    title: SharedString,
    action: Option<AnyElement>,
    children: Vec<AnyElement>,
}
impl SettingsSection {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            action: None,
            children: vec![],
        }
    }
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
}
impl ParentElement for SettingsSection {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}
impl RenderOnce for SettingsSection {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let size = theme::ty().ui.page_title;
        div()
            .flex()
            .flex_col()
            .w_full()
            .max_w(px(metric::READING_CONTENT_WIDTH))
            .mx_auto()
            .gap(px(16.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .w_full()
                    .min_w_0()
                    .mb(px(by_scale([10., 12., 14.])))
                    .justify_between()
                    .gap(px(12.))
                    .px(px(10.))
                    .child(
                        div()
                            .text_size(px(size))
                            .line_height(px(size * 1.25))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(self.title),
                    )
                    .children(self.action),
            )
            .children(self.children)
    }
}

/// `.desktop-settings-list`: rows 2px apart. A lead list gives its first
/// row the lead rhythm.
#[derive(IntoElement, Default)]
pub struct SettingsList {
    lead: bool,
    children: Vec<AnyElement>,
}
impl SettingsList {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn lead(mut self, lead: bool) -> Self {
        self.lead = lead;
        self
    }
}
impl ParentElement for SettingsList {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}
impl RenderOnce for SettingsList {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let lead = self.lead;
        div().flex().flex_col().w_full().gap(px(2.)).children(
            self.children
                .into_iter()
                .enumerate()
                .map(move |(index, row)| {
                    if lead && index == 0 {
                        div()
                            .w_full()
                            .flex()
                            .flex_col()
                            .justify_center()
                            .min_h(px(by_scale([50., 54., 58.])))
                            .child(row)
                            .into_any_element()
                    } else {
                        row
                    }
                }),
        )
    }
}

/// `SettingsSubsection`: an optional title and detail over a row list.
/// `lead` adds the lead-group spacing (titled) or lead row (untitled).
#[derive(IntoElement, Default)]
pub struct SettingsSubsection {
    title: Option<SharedString>,
    detail: Option<SharedString>,
    lead: bool,
    children: Vec<AnyElement>,
}
impl SettingsSubsection {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn title(mut self, title: impl Into<SharedString>) -> Self {
        self.title = Some(title.into());
        self
    }
    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }
    pub fn lead(mut self, lead: bool) -> Self {
        self.lead = lead;
        self
    }
}
impl ParentElement for SettingsSubsection {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}
impl RenderOnce for SettingsSubsection {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let titled = self.title.is_some();
        let lead = self.lead;
        let meta = theme::ty().ui.meta;
        div()
            .flex()
            .flex_col()
            .w_full()
            .min_w_0()
            .gap(px(4.))
            .when(lead && titled, |d| d.pt(px(by_scale([16., 18., 20.]))))
            .children(self.title.map(|title| {
                div()
                    .min_h(px(18.))
                    .px(px(10.))
                    .text_size(px(meta))
                    .line_height(px(18.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.subtle)
                    .child(title)
            }))
            .children(self.detail.map(|detail| {
                div()
                    .px(px(10.))
                    .mb(px(2.))
                    .text_size(px(meta))
                    .text_color(t.subtle)
                    .child(detail)
            }))
            .child(
                SettingsList::new()
                    .lead(lead && !titled)
                    .children(self.children),
            )
    }
}

/// `.desktop-settings-category`: a header (title and action) over rows or
/// one body element.
#[derive(IntoElement)]
pub struct SettingsCategory {
    title: SharedString,
    action: Option<AnyElement>,
    rows: Vec<AnyElement>,
    body: Option<AnyElement>,
}
impl SettingsCategory {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            action: None,
            rows: vec![],
            body: None,
        }
    }
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
    /// One element (a tree or table) instead of a row list.
    pub fn body(mut self, body: impl IntoElement) -> Self {
        self.body = Some(body.into_any_element());
        self
    }
}
impl ParentElement for SettingsCategory {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.rows.extend(elements);
    }
}
impl RenderOnce for SettingsCategory {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        div()
            .flex()
            .flex_col()
            .w_full()
            .min_w_0()
            .gap(px(7.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .min_h(px(by_scale([36., 40., 44.])))
                    .justify_between()
                    .gap(px(10.))
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.label))
                            .line_height(px(18.))
                            .text_color(t.muted)
                            .child(self.title),
                    )
                    .children(self.action),
            )
            .when(!self.rows.is_empty(), |d| {
                d.child(SettingsList::new().children(self.rows))
            })
            .children(self.body)
    }
}

/// `.desktop-settings-category-list`: categories 20px apart, inset 10px.
#[derive(IntoElement, Default)]
pub struct SettingsCategoryList {
    children: Vec<AnyElement>,
}
impl SettingsCategoryList {
    pub fn new() -> Self {
        Self::default()
    }
}
impl ParentElement for SettingsCategoryList {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}
impl RenderOnce for SettingsCategoryList {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .w_full()
            .max_w(px(720.))
            .gap(px(20.))
            .px(px(10.))
            .pt(px(7.))
            .children(self.children)
    }
}

/// `.desktop-settings-row.desktop-settings-row-control`: a label and its control.
#[derive(IntoElement)]
pub struct SettingRow {
    style: StyleRefinement,
    label: SharedString,
    label_element: Option<AnyElement>,
    control: Option<AnyElement>,
}
impl SettingRow {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            label_element: None,
            control: None,
            style: StyleRefinement::default(),
        }
    }
    /// A composed label (a title with an inline link) in the label slot.
    pub fn label_element(mut self, element: impl IntoElement) -> Self {
        self.label_element = Some(element.into_any_element());
        self
    }
    pub fn control(mut self, control: impl IntoElement) -> Self {
        self.control = Some(control.into_any_element());
        self
    }
}
impl Styled for SettingRow {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for SettingRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        div()
            .flex()
            .items_center()
            .w_full()
            .min_w_0()
            .min_h(px(42.))
            .justify_between()
            .gap(px(18.))
            .px(px(10.))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_size(px(theme::ty().ui.label))
            .child(
                div()
                    .flex_shrink_0()
                    .max_w(px(320.))
                    .line_height(px(18.))
                    .text_color(t.subtle)
                    .when_some(self.label_element, |d, label| d.child(label))
                    .when(!self.label.is_empty(), |d| d.child(self.label)),
            )
            .children(self.control)
            .refine_style(&self.style)
    }
}

/// `SettingsValueRow`: a label and a read-only value, optionally with an action.
#[derive(IntoElement)]
pub struct ValueRow {
    style: StyleRefinement,
    label: SharedString,
    value: SharedString,
    monospace: bool,
    action: Option<AnyElement>,
}
impl ValueRow {
    pub fn new(label: impl Into<SharedString>, value: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            value: value.into(),
            monospace: false,
            action: None,
            style: StyleRefinement::default(),
        }
    }
    pub fn monospace(mut self, monospace: bool) -> Self {
        self.monospace = monospace;
        self
    }
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
}
impl Styled for ValueRow {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for ValueRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let has_action = self.action.is_some();
        let monospace = self.monospace;
        div()
            .flex()
            .items_center()
            .w_full()
            .min_w_0()
            .min_h(px(if has_action { 42. } else { theme::control() }))
            .justify_between()
            .gap(px(18.))
            .px(px(10.))
            .text_size(px(theme::ty().ui.label))
            .line_height(px(18.))
            .child(div().flex_shrink_0().text_color(t.subtle).child(self.label))
            .child(
                div()
                    .flex()
                    .items_center()
                    .min_w_0()
                    .gap(px(8.))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_right()
                            .text_color(t.text)
                            .when(monospace, |d| {
                                d.font_family(theme::MONO)
                                    .text_size(px(theme::ty().ui.meta))
                                    .line_height(px(17.))
                            })
                            .child(self.value),
                    )
                    .children(self.action),
            )
            .refine_style(&self.style)
    }
}

/// `.desktop-settings-muted-row` / `.desktop-utility-empty`: subtle text,
/// or danger text for an error.
#[derive(IntoElement)]
pub struct MutedRow {
    style: StyleRefinement,
    text: SharedString,
    danger: bool,
}
impl MutedRow {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self {
            text: text.into(),
            danger: false,
            style: StyleRefinement::default(),
        }
    }
    pub fn danger(mut self) -> Self {
        self.danger = true;
        self
    }
}
impl Styled for MutedRow {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for MutedRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        div()
            .flex()
            .items_center()
            .w_full()
            .min_h(px(42.))
            .px(px(10.))
            .text_size(px(theme::ty().ui.label))
            .text_color(if self.danger { t.danger } else { t.subtle })
            .child(self.text)
            .refine_style(&self.style)
    }
}
