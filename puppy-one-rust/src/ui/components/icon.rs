//! Product icons: Lucide glyphs from `assets/icons` and file-type glyphs from
//! the active file icon theme.
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
use gpui_kit::{
    base::StyledExt as _,
    component::{Sizable, Size},
};

/// A Lucide icon. Without an explicit colour it takes the text colour of
/// where it is placed. An SVG paints its own colour only, so a control that
/// changes its text colour on hover hands its icon the hover colour through
/// [`Icon::group_hover_color`].
///
/// Sizes: `xsmall` 12, `small` 14, medium (default) 15, `large` 16, or
/// `with_size(px(n))`.
#[derive(IntoElement, Clone)]
pub struct Icon {
    name: SharedString,
    stroke: Option<f32>,
    size: Size,
    color: Option<Hsla>,
    group_hover: Option<(SharedString, Hsla)>,
    style: StyleRefinement,
}
impl Icon {
    /// The icon as imported (stroke 1.8).
    pub fn new(name: impl Into<SharedString>) -> Self {
        Self {
            name: name.into(),
            stroke: None,
            size: Size::Medium,
            color: None,
            group_hover: None,
            style: StyleRefinement::default(),
        }
    }
    /// Redraw at the call site's `strokeWidth` (Lucide's default is 2).
    pub fn stroke(mut self, stroke: f32) -> Self {
        self.stroke = Some(stroke);
        self
    }
    pub fn color(mut self, color: impl Into<Hsla>) -> Self {
        self.color = Some(color.into());
        self
    }
    /// The colour while the pointer is over `group` (the owning control).
    pub fn group_hover_color(
        mut self,
        group: impl Into<SharedString>,
        color: impl Into<Hsla>,
    ) -> Self {
        self.group_hover = Some((group.into(), color.into()));
        self
    }
    /// Size in pixels.
    pub fn pixels(&self) -> Pixels {
        match self.size {
            Size::XSmall => px(12.),
            Size::Small => px(14.),
            Size::Medium => px(15.),
            Size::Large => px(16.),
            Size::Size(size) => size,
        }
    }
    fn path(&self) -> SharedString {
        match self.stroke {
            Some(stroke) => format!("icons/{}@{stroke}.svg", self.name).into(),
            None => format!("icons/{}.svg", self.name).into(),
        }
    }
}
impl Sizable for Icon {
    fn with_size(mut self, size: impl Into<Size>) -> Self {
        self.size = size.into();
        self
    }
}
impl Styled for Icon {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for Icon {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        let color = self.color.unwrap_or(window.text_style().color);
        svg()
            .path(self.path())
            .size(self.pixels())
            .flex_shrink_0()
            .text_color(color)
            .when_some(self.group_hover, |svg, (group, color)| {
                svg.group_hover(group, move |s| s.text_color(color))
            })
            .refine_style(&self.style)
    }
}
impl From<&'static str> for Icon {
    fn from(name: &'static str) -> Self {
        Icon::new(name)
    }
}

/// A file-type glyph from a file icon theme (`file_kind`), 18px by default,
/// drawn for the active colour mode.
#[derive(IntoElement, Clone)]
pub struct FileIcon {
    name: SharedString,
    folder: bool,
    icon_theme: SharedString,
    size: Pixels,
    style: StyleRefinement,
}
impl FileIcon {
    /// The glyph of a file called `name` (only its extension matters).
    pub fn file(name: impl Into<SharedString>, icon_theme: impl Into<SharedString>) -> Self {
        Self {
            name: name.into(),
            folder: false,
            icon_theme: icon_theme.into(),
            size: px(18.),
            style: StyleRefinement::default(),
        }
    }
    pub fn folder(icon_theme: impl Into<SharedString>) -> Self {
        Self {
            folder: true,
            ..Self::file("folder", icon_theme)
        }
    }
    pub fn size_px(mut self, size: f32) -> Self {
        self.size = px(size);
        self
    }
}
impl Styled for FileIcon {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for FileIcon {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        img(SharedString::from(crate::file_kind::asset_path(
            &self.icon_theme,
            &self.name,
            self.folder,
            cx.is_dark(),
        )))
        .size(self.size)
        .flex_shrink_0()
        .refine_style(&self.style)
    }
}
