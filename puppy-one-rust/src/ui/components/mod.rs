//! PuppyOne component library: the product's presentation over GPUI Kit's
//! headless behaviour (`gpui-base`).
//!
//! Every component is a `RenderOnce` struct with a builder API, Kit's state
//! traits where they apply (`Selectable`, `Disableable`, `Sizable`), `Styled`
//! for the occasional layout override, and colours from the active
//! [`Appearance`](crate::ui::appearance::Appearance). Feature code composes
//! these; it does not draw controls of its own.
mod button;
mod dialog;
mod icon;
pub(crate) mod menu;
mod popover;
mod segmented;
mod select;
mod settings;
mod sidebar;
mod spinner;
mod switch;

pub use button::{Button, ButtonVariant, IconButton};
pub use dialog::Dialog;
pub use icon::{FileIcon, Icon};
pub use menu::{Menu, MenuItem, MenuVariant};
pub use popover::{AnchoredMenu, Dismiss, PopoverMenu};
pub use segmented::{Segment, SegmentLayout, SegmentedControl};
pub use select::{Select, SelectOption};
pub use settings::{
    MutedRow, SettingRow, SettingsCategory, SettingsCategoryList, SettingsList, SettingsSection,
    SettingsSubsection, ValueRow,
};
pub use sidebar::{RowActionButton, RowVariant, SectionHeader, SidebarGroup, SidebarRow};
pub use spinner::Spinner;
pub use switch::Switch;

/// Attach a product tooltip (Kit tooltip on the shared overlay layer).
pub fn tooltip(
    text: impl Into<gpui::SharedString>,
) -> impl Fn(&mut gpui::Window, &mut gpui::App) -> gpui::AnyView + 'static {
    let text = text.into();
    move |window, cx| gpui_kit::component::tooltip::Tooltip::new(text.clone()).build(window, cx)
}
