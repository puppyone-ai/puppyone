//! Buttons: labelled commands and square icon commands, on GPUI Kit's
//! headless button (focus, keyboard activation, accessibility).
use super::{Icon, tooltip};
use crate::{
    theme::{self, Theme, metric},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Button as BaseButton, Disableable, Selectable, StyledExt as _},
    component::{Sizable, Size},
};
use std::rc::Rc;

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

/// How a labelled button presents itself.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonVariant {
    /// Bordered and quiet (`.desktop-settings-action`).
    #[default]
    Outline,
    /// Bordered, tinted with the accent.
    OutlinePrimary,
    /// Bordered, tinted with danger.
    OutlineDanger,
    /// Filled with the control material (`.desktop-git-operation-button`).
    Filled,
    /// Filled with the accent (`.desktop-git-operation-button.is-primary`).
    FilledPrimary,
    /// No chrome until hovered; hover raises the text colour
    /// (`.desktop-titlebar-workspace-button`, toolbar commands).
    Ghost,
    /// `.desktop-titlebar-action`: hover only adds the backplate; pressed or
    /// expanded wears the active fill.
    Titlebar,
    /// Dialog secondary action (`.desktop-dialog-button`).
    Secondary,
    /// Dialog primary action: the inverted text colour (`.desktop-dialog-button.primary`).
    Solid,
    /// Dialog destructive action (`.desktop-dialog-button.destructive`).
    SolidDanger,
}
impl ButtonVariant {
    fn outlined(self) -> bool {
        matches!(
            self,
            Self::Outline | Self::OutlinePrimary | Self::OutlineDanger
        )
    }
    fn dialog(self) -> bool {
        matches!(self, Self::Secondary | Self::Solid | Self::SolidDanger)
    }
}
/// Colours of a variant in one state.
struct Paint {
    border: Option<Rgba>,
    bg: Rgba,
    fg: Rgba,
    hover_bg: Rgba,
    hover_fg: Rgba,
}
fn paint(variant: ButtonVariant, selected: bool, open: bool, disabled: bool, t: Theme) -> Paint {
    // The product's Git primary is the brand blue in light mode.
    let accent = if t.dark { t.accent } else { t.brand_blue };
    let clear = theme::alpha(t.text, 0.);
    match variant {
        ButtonVariant::Outline => Paint {
            border: Some(t.divider),
            bg: clear,
            fg: if disabled { t.text_disabled } else { t.muted },
            hover_bg: t.hover,
            hover_fg: t.text,
        },
        ButtonVariant::OutlinePrimary => Paint {
            border: Some(theme::alpha(t.accent, 0.28)),
            bg: theme::alpha(t.accent, 0.09),
            fg: t.accent,
            hover_bg: theme::alpha(t.accent, 0.14),
            hover_fg: t.accent,
        },
        ButtonVariant::OutlineDanger => Paint {
            border: Some(theme::alpha(t.danger, 0.22)),
            bg: theme::alpha(t.danger, 0.07),
            fg: t.danger,
            hover_bg: theme::alpha(t.danger, 0.12),
            hover_fg: t.danger,
        },
        ButtonVariant::Filled if disabled => Paint {
            border: None,
            bg: clear,
            fg: t.text_disabled,
            hover_bg: clear,
            hover_fg: t.text_disabled,
        },
        ButtonVariant::Filled => Paint {
            border: None,
            bg: t.control,
            fg: t.muted,
            hover_bg: t.control_hover,
            hover_fg: t.text,
        },
        ButtonVariant::FilledPrimary if disabled => Paint {
            border: None,
            bg: theme::mix(accent, t.control, 0.12),
            fg: t.text_disabled,
            hover_bg: theme::mix(accent, t.control, 0.12),
            hover_fg: t.text_disabled,
        },
        ButtonVariant::FilledPrimary => Paint {
            border: None,
            bg: accent,
            fg: t.text_inverse,
            hover_bg: theme::mix(accent, t.text, 0.86),
            hover_fg: t.text_inverse,
        },
        ButtonVariant::Secondary => Paint {
            border: Some(if disabled { t.border } else { t.border_strong }),
            bg: if disabled { t.control } else { clear },
            fg: if disabled { t.text_disabled } else { t.muted },
            hover_bg: t.hover,
            hover_fg: t.text,
        },
        ButtonVariant::Solid | ButtonVariant::SolidDanger if disabled => Paint {
            border: Some(t.border),
            bg: t.control,
            fg: t.text_disabled,
            hover_bg: t.control,
            hover_fg: t.text_disabled,
        },
        ButtonVariant::Solid => {
            let hover = theme::mix(t.text, t.panel, 0.88);
            Paint {
                border: Some(t.text),
                bg: t.text,
                fg: t.text_inverse,
                hover_bg: hover,
                hover_fg: t.text_inverse,
            }
        }
        ButtonVariant::SolidDanger => Paint {
            border: Some(theme::mix(t.danger, t.border, 0.72)),
            bg: t.danger,
            fg: t.text_inverse,
            hover_bg: theme::mix(t.danger, t.text, 0.86),
            hover_fg: t.text_inverse,
        },
        ButtonVariant::Ghost => Paint {
            border: None,
            bg: if selected {
                t.selected
            } else if open {
                t.hover
            } else {
                clear
            },
            fg: if selected || open { t.text } else { t.muted },
            hover_bg: if selected { t.selected } else { t.hover },
            hover_fg: t.text,
        },
        ButtonVariant::Titlebar if selected || open => Paint {
            border: None,
            bg: t.selected,
            fg: t.text,
            hover_bg: t.selected,
            hover_fg: t.text,
        },
        ButtonVariant::Titlebar => Paint {
            border: None,
            bg: clear,
            fg: t.muted,
            hover_bg: t.hover,
            hover_fg: t.muted,
        },
    }
}
/// Control heights: `xsmall` 22, `small` 24, medium 28, `large` 32.
fn height(size: Size) -> Pixels {
    match size {
        Size::XSmall => px(theme::control_mini()),
        Size::Small => px(24.),
        Size::Medium => px(theme::control_compact()),
        Size::Large => px(theme::control()),
        Size::Size(size) => size,
    }
}

/// A labelled command.
#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    base: BaseButton,
    style: StyleRefinement,
    variant: ButtonVariant,
    size: Size,
    label: Option<SharedString>,
    accessible: Option<SharedString>,
    icon: Option<Icon>,
    trailing: Option<AnyElement>,
    selected: bool,
    /// Its popover is open (`aria-expanded`).
    open: bool,
    disabled: bool,
    tooltip: Option<SharedString>,
    on_click: Option<ClickHandler>,
}
impl Button {
    pub fn new(id: impl Into<ElementId>) -> Self {
        let id = id.into();
        Self {
            base: BaseButton::new(id.clone()),
            id,
            style: StyleRefinement::default(),
            variant: ButtonVariant::default(),
            size: Size::Medium,
            label: None,
            accessible: None,
            icon: None,
            trailing: None,
            selected: false,
            open: false,
            disabled: false,
            tooltip: None,
            on_click: None,
        }
    }
    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;
        self
    }
    pub fn primary(self) -> Self {
        self.variant(ButtonVariant::OutlinePrimary)
    }
    pub fn danger(self) -> Self {
        self.variant(ButtonVariant::OutlineDanger)
    }
    pub fn ghost(self) -> Self {
        self.variant(ButtonVariant::Ghost)
    }
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }
    /// Leading icon. A bare name gets the variant's size and stroke.
    pub fn icon(mut self, icon: impl Into<Icon>) -> Self {
        self.icon = Some(icon.into());
        self
    }
    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing = Some(element.into_any_element());
        self
    }
    pub fn tooltip(mut self, text: impl Into<SharedString>) -> Self {
        self.tooltip = Some(text.into());
        self
    }
    /// The accessible name when it differs from the visible label (or there
    /// is none).
    pub fn accessibility_label(mut self, label: impl Into<SharedString>) -> Self {
        self.accessible = Some(label.into());
        self
    }
    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
    pub fn track_focus(mut self, handle: &FocusHandle) -> Self {
        self.base = self.base.track_focus(handle);
        self
    }
}
impl Sizable for Button {
    fn with_size(mut self, size: impl Into<Size>) -> Self {
        self.size = size.into();
        self
    }
}
impl Selectable for Button {
    fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
    fn is_selected(&self) -> bool {
        self.selected
    }
    fn open(mut self, open: bool) -> Self {
        self.open = open;
        self
    }
    fn is_open(&self) -> bool {
        self.open
    }
}
impl Disableable for Button {
    fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}
impl Styled for Button {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl InteractiveElement for Button {
    fn interactivity(&mut self) -> &mut Interactivity {
        self.base.interactivity()
    }
}
impl StatefulInteractiveElement for Button {}
impl RenderOnce for Button {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let variant = self.variant;
        let disabled = self.disabled;
        let p = paint(variant, self.selected, self.open, disabled, t);
        let outlined = variant.outlined();
        let dialog = variant.dialog();
        let filled = matches!(
            variant,
            ButtonVariant::Filled | ButtonVariant::FilledPrimary
        );
        // Outline: 13px icon at stroke 2; filled Git actions: 15px at 2.25.
        let icon = self.icon.map(|icon| {
            if outlined {
                icon.with_size(px(13.)).stroke(2.)
            } else if filled {
                icon.with_size(px(15.)).stroke(2.25)
            } else {
                icon
            }
        });
        let label = self.label.clone();
        let (hover_bg, hover_fg) = (p.hover_bg, p.hover_fg);
        let group = hover_group(&self.id);
        let icon = icon.map(|icon| {
            if disabled {
                icon
            } else {
                icon.group_hover_color(group.clone(), hover_fg)
            }
        });
        self.base
            .group(group)
            .disabled(disabled)
            .selected(self.selected)
            .when_some(self.accessible.or(label.clone()), |b, name| {
                b.accessibility_label(name)
            })
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .gap(px(match variant {
                ButtonVariant::FilledPrimary => 5.,
                ButtonVariant::Filled => 4.,
                _ => 6.,
            }))
            .h(height(if dialog && self.size == Size::Medium {
                Size::Large
            } else {
                self.size
            }))
            .px(px(if dialog {
                14.
            } else if outlined {
                9.
            } else {
                7.
            }))
            .rounded(px(if outlined || dialog {
                metric::CONTROL_RADIUS
            } else {
                metric::TOOLBAR_ACTION_RADIUS
            }))
            .when_some(p.border, |b, border| b.border_1().border_color(border))
            .bg(p.bg)
            .text_color(p.fg)
            .when(outlined || dialog, |b| {
                b.text_size(px(theme::ty().ui.meta)).font_weight(
                    if matches!(variant, ButtonVariant::Solid | ButtonVariant::SolidDanger) {
                        FontWeight::SEMIBOLD
                    } else {
                        FontWeight::MEDIUM
                    },
                )
            })
            // `GitOperationButton` sets the right-sidebar control type.
            .when(filled, |b| {
                let ty = theme::ty().right;
                b.text_size(px(ty.content))
                    .line_height(px(ty.control_line_height))
            })
            .when(disabled && outlined, |b| b.opacity(0.62))
            .when(!disabled, |b| {
                b.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
            })
            .when_some(self.tooltip, |b, text| b.tooltip(tooltip(text)))
            .when_some(self.on_click.filter(|_| !disabled), |b, handler| {
                b.on_click(move |event, window, cx| handler(event, window, cx))
            })
            .children(icon)
            .when_some(label, |b, label| {
                b.child(div().min_w_0().truncate().child(label))
            })
            .children(self.trailing)
            .refine_style(&self.style)
    }
}

/// A square icon command. Its label is the accessible name and the tooltip.
///
/// Sizes: `xsmall` 22, `small` 24, medium 28, `large` 32.
#[derive(IntoElement)]
pub struct IconButton {
    id: ElementId,
    base: BaseButton,
    style: StyleRefinement,
    icon: Icon,
    size: Size,
    label: Option<SharedString>,
    tooltip: Option<SharedString>,
    show_tooltip: bool,
    selected: bool,
    /// Its popover is open (`aria-expanded`): the control-hover backplate.
    open: bool,
    disabled: bool,
    danger: bool,
    color: Option<Hsla>,
    on_click: Option<ClickHandler>,
}
impl IconButton {
    pub fn new(id: impl Into<ElementId>, icon: impl Into<Icon>) -> Self {
        let id = id.into();
        Self {
            base: BaseButton::new(id.clone()),
            id,
            style: StyleRefinement::default(),
            icon: icon.into(),
            size: Size::Medium,
            label: None,
            tooltip: None,
            show_tooltip: true,
            selected: false,
            open: false,
            disabled: false,
            danger: false,
            color: None,
            on_click: None,
        }
    }
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }
    /// A tooltip other than the accessible name.
    pub fn tooltip(mut self, text: impl Into<SharedString>) -> Self {
        self.tooltip = Some(text.into());
        self
    }
    /// Keep the accessible name but show no tooltip.
    pub fn no_tooltip(mut self) -> Self {
        self.show_tooltip = false;
        self
    }
    pub fn danger(mut self) -> Self {
        self.danger = true;
        self
    }
    /// Resting icon colour (hover still raises it to the text colour).
    pub fn color(mut self, color: impl Into<Hsla>) -> Self {
        self.color = Some(color.into());
        self
    }
    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
    pub fn track_focus(mut self, handle: &FocusHandle) -> Self {
        self.base = self.base.track_focus(handle);
        self
    }
}
impl Sizable for IconButton {
    fn with_size(mut self, size: impl Into<Size>) -> Self {
        self.size = size.into();
        self
    }
}
impl Selectable for IconButton {
    fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
    fn is_selected(&self) -> bool {
        self.selected
    }
    fn open(mut self, open: bool) -> Self {
        self.open = open;
        self
    }
    fn is_open(&self) -> bool {
        self.open
    }
}
impl Disableable for IconButton {
    fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}
impl Styled for IconButton {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl InteractiveElement for IconButton {
    fn interactivity(&mut self) -> &mut Interactivity {
        self.base.interactivity()
    }
}
impl StatefulInteractiveElement for IconButton {}
impl RenderOnce for IconButton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let disabled = self.disabled;
        let (fg, hover_bg, hover_fg) = if self.danger {
            (t.danger, theme::alpha(t.danger, 0.12), t.danger)
        } else if self.selected {
            (t.text, t.selected, t.text)
        } else if self.open {
            (t.text, t.control_hover, t.text)
        } else {
            (
                self.color.map(Rgba::from).unwrap_or(t.utility),
                t.hover,
                t.text,
            )
        };
        let label = self.label.clone();
        let group = hover_group(&self.id);
        let icon = if disabled {
            self.icon
        } else {
            self.icon.group_hover_color(group.clone(), hover_fg)
        };
        self.base
            .group(group)
            .disabled(disabled)
            .selected(self.selected)
            .when_some(label.clone(), |b, label| b.accessibility_label(label))
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .size(height(self.size))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_color(fg)
            .when(self.selected, |b| b.bg(t.selected))
            .when(self.open && !self.selected, |b| b.bg(t.control_hover))
            .when(disabled, |b| b.opacity(0.5))
            .when(!disabled, |b| {
                b.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
            })
            .when_some(
                self.tooltip.or(label).filter(|_| self.show_tooltip),
                |b, text| b.tooltip(tooltip(text)),
            )
            .when_some(self.on_click.filter(|_| !disabled), |b, handler| {
                b.on_click(move |event, window, cx| handler(event, window, cx))
            })
            .child(icon)
            .refine_style(&self.style)
    }
}
/// The hover group a control names so its icon follows its hover colour.
pub(super) fn hover_group(id: &ElementId) -> SharedString {
    format!("control-{id}").into()
}
