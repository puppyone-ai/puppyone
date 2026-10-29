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
pub(crate) mod menu;
mod notice;
mod popover;
mod resize_handle;
mod segmented;
mod select;
mod settings;
mod sidebar;
mod spinner;
mod switch;

pub use agent_presence::{FilePresence, PresenceVariant};
pub use button::{Button, ButtonVariant, IconButton};
pub use checkbox::{Checkbox, native_checkbox};
pub use dialog::Dialog;
pub use icon::{FileIcon, Icon, ProductIcon};
pub use menu::{Menu, MenuItem, MenuRow, MenuVariant};
pub use notice::{FloatingNotice, NoticeAction, NoticePlacement, NoticeStack, NoticeTone};
pub use popover::{AnchoredMenu, PopoverMenu};
pub use resize_handle::ResizeHandle;
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
