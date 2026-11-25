//! PuppyOne component library: the product's presentation over GPUI Kit's
//! headless behaviour (`gpui-base`).
//!
//! Every component is a `RenderOnce` struct with a builder API, Kit's state
//! traits where they apply (`Selectable`, `Disableable`, `Sizable`), `Styled`
//! for the occasional layout override, and colours from the active
//! [`Appearance`](crate::ui::appearance::Appearance). Feature code composes
//! these; it does not draw controls of its own.
mod agent_presence;
mod button;
mod checkbox;
mod dialog;
mod icon;
mod layer;
mod menu;
mod notice;
mod popover;
mod resize_handle;
mod segmented;
mod select;
mod settings;
mod sidebar;
mod space_mark;
mod spinner;
mod stepper;
mod surface;
mod switch;

pub use agent_presence::{FilePresence, PresenceVariant};
pub use button::{Button, ButtonVariant, IconButton};
pub use checkbox::{native_checkbox, tinted_checkbox};
pub use dialog::Dialog;
pub use icon::{FileIcon, Icon, ProductIcon};
pub use layer::{cover, covering};
pub use menu::{Menu, MenuItem, MenuVariant, bind_keys as bind_menu_keys};
pub use notice::{FloatingNotice, NoticeAction, NoticePlacement, NoticeStack, NoticeTone};
pub use popover::{AnchoredMenu, PopoverMenu};
pub use resize_handle::ResizeHandle;
pub use segmented::{Segment, SegmentLayout, SegmentedControl};
pub use select::{Select, SelectOption};
pub use settings::{
    MutedRow, SettingRow, SettingsCategory, SettingsCategoryList, SettingsChange, SettingsList,
    SettingsNote, SettingsSection, SettingsSubsection, ValueRow,
};
pub use sidebar::{
    RowActionButton, RowVariant, SectionHeader, SidebarGroup, SidebarRow, selected_gradient,
};
pub use space_mark::{PersonMark, SpaceMark, SpaceMarkSize, SpacePlanBadge};
pub use spinner::Spinner;
pub use stepper::Stepper;
pub use surface::{
    SurfaceCorners, SurfaceElevation, SurfaceFrame, SurfaceStyledExt, SurfaceVariant, inner_radius,
};
pub use switch::Switch;

/// Attach a product tooltip (Kit tooltip on the shared overlay layer).
pub fn tooltip(
    text: impl Into<gpui::SharedString>,
) -> impl Fn(&mut gpui::Window, &mut gpui::App) -> gpui::AnyView + 'static {
    use gpui::AppContext as _;
    let text = text.into();
    move |window, cx| {
        let tip = gpui_kit::component::tooltip::Tooltip::new(text.clone()).build(window, cx);
        cx.new(|_| CoveringTooltip(tip)).into()
    }
}

/// The Kit tooltip, reported to [`crate::ui::native_cover`] so a tooltip
/// that drops over an HTML page shows above it.
struct CoveringTooltip(gpui::AnyView);
/// The Kit tooltip's popup sits `m_3` inside its view.
const KIT_TOOLTIP_MARGIN: f32 = 12.;
impl gpui::Render for CoveringTooltip {
    fn render(
        &mut self,
        _: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        use gpui::{InteractiveElement as _, ParentElement as _, Styled as _};
        use gpui_kit::component::ActiveTheme as _;
        let radius = f32::from(cx.theme().radius);
        gpui::div()
            .relative()
            .debug_selector(|| "tooltip".into())
            .child(self.0.clone())
            .child(crate::ui::native_cover::reporter(
                KIT_TOOLTIP_MARGIN,
                radius,
            ))
    }
}
