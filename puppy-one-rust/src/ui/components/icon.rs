//! Product icons: Lucide glyphs from `assets/icons` and file-type glyphs from
//! the active file icon theme.
pub use crate::asset_catalog::ProductIcon;
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
    spin: Option<ElementId>,
    rotation: f32,
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
            spin: None,
            rotation: 0.,
            style: StyleRefinement::default(),
        }
    }
    pub fn product(meaning: ProductIcon) -> Self {
        Self::new(SharedString::from(format!("product-{}", meaning.id())))
    }
    /// Turned clockwise by `radians` about its centre.
    pub fn rotate(mut self, radians: f32) -> Self {
        self.rotation = radians;
        self
    }
    /// Turn once every 900ms (`.is-spinning`); `id` keys the animation.
    pub fn spinning(mut self, id: impl Into<ElementId>) -> Self {
        self.spin = Some(id.into());
        self
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
        let pixels = self.pixels();
        let disclosure = crate::asset_catalog::is_disclosure(&self.name);
        let icon = svg()
            .path(self.path())
            .size(if disclosure { px(12.) } else { pixels })
            .flex_shrink_0()
            .text_color(color)
            .when(self.rotation != 0., |svg| {
                svg.with_transformation(Transformation::rotate(radians(self.rotation)))
            })
            .when_some(self.group_hover, |svg, (group, color)| {
                svg.group_hover(group, move |s| s.text_color(color))
            })
            .refine_style(&self.style);
        let icon = match self.spin {
            Some(id) => icon
                .with_animation(
                    id,
                    Animation::new(std::time::Duration::from_millis(900)).repeat(),
                    |svg, delta| svg.with_transformation(Transformation::rotate(percentage(delta))),
                )
                .into_any_element(),
            None => icon.into_any_element(),
        };
        if disclosure {
            div()
                .size(pixels)
                .flex()
                .flex_shrink_0()
                .items_center()
                .justify_center()
                .child(icon)
                .into_any_element()
        } else {
            icon
        }
    }
}
impl From<ProductIcon> for Icon {
    fn from(meaning: ProductIcon) -> Self {
        Self::product(meaning)
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
    node_type: Option<SharedString>,
    mime: Option<SharedString>,
    icon_theme: SharedString,
    size: Pixels,
    style: StyleRefinement,
}
impl FileIcon {
    /// The format registry resolves names, extensions and optional MIME/type.
    /// The active icon theme selects a renderer, never reclassifies the file.
    pub fn file(name: impl Into<SharedString>, icon_theme: impl Into<SharedString>) -> Self {
        Self::for_node(name, None, None, icon_theme)
    }
    pub fn for_node(
        name: impl Into<SharedString>,
        node_type: Option<SharedString>,
        mime: Option<SharedString>,
        icon_theme: impl Into<SharedString>,
    ) -> Self {
        Self {
            name: name.into(),
            node_type,
            mime,
            icon_theme: icon_theme.into(),
            size: px(18.),
            style: StyleRefinement::default(),
        }
    }
    pub fn folder(icon_theme: impl Into<SharedString>) -> Self {
        Self::for_node("folder", Some("folder".into()), None, icon_theme)
    }
    pub fn size_px(mut self, size: f32) -> Self {
        self.size = px(if size.is_finite() {
            size.clamp(1., 512.)
        } else {
            18.
        });
        self
    }
}
impl Styled for FileIcon {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl FileIcon {
    pub(crate) fn resource(
        &self,
        scale: f32,
        palette: crate::theme::Theme,
        foreground: Rgba,
    ) -> Resource {
        let context = crate::file_kind::RenderContext {
            name: &self.name,
            node_type: self.node_type.as_deref(),
            mime: self.mime.as_deref(),
            size: f32::from(self.size),
        };
        let resolved = crate::file_kind::resolve(&self.icon_theme, context);
        let colors: Vec<_> = resolved
            .glyph()
            .bindings
            .iter()
            .map(|b| {
                let c = palette.file_ink(&b.token, foreground);
                [c.r, c.g, c.b, c.a].map(|c| (c.clamp(0., 1.) * 255.).round() as u8)
            })
            .collect();
        let physical = (f32::from(self.size) * scale).ceil().clamp(1., 4096.) as u32;
        Resource::Embedded(SharedString::from(resolved.asset_path(physical, &colors)))
    }
}
impl RenderOnce for FileIcon {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let resource = self.resource(
            window.scale_factor(),
            cx.palette(),
            window.text_style().color.into(),
        );
        img(ImageSource::Resource(resource))
            .size(self.size)
            .object_fit(ObjectFit::Contain)
            .flex_shrink_0()
            .refine_style(&self.style)
    }
}
