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
    /// A copy button's key: `copy`, flipping to `check` after a copy.
    copy: Option<SharedString>,
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
            copy: None,
            style: StyleRefinement::default(),
        }
    }
    pub fn product(meaning: ProductIcon) -> Self {
        Self::new(SharedString::from(format!("product-{}", meaning.id())))
    }
    /// A copy button's glyph (`ui::copy_feedback`): after `key` copies it
    /// flips over to `check`, holds, then flips back.
    pub fn copy(key: impl Into<SharedString>) -> Self {
        let mut icon = Self::new("copy");
        icon.copy = Some(key.into());
        icon
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
        icon_path(&self.name, self.stroke)
    }
}
/// `icons/<name>.svg`, or its redraw at `stroke`.
fn icon_path(name: &str, stroke: Option<f32>) -> SharedString {
    match stroke {
        Some(stroke) => format!("icons/{name}@{stroke}.svg").into(),
        None => format!("icons/{name}.svg").into(),
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
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
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
        let copied = self
            .copy
            .as_ref()
            .and_then(|key| crate::ui::copy_feedback::started(key, window, cx));
        let stroke = self.stroke;
        let icon = match (self.spin, copied) {
            (_, Some(at)) => {
                let (name, scale, turning) = crate::ui::copy_feedback::face(at, cx.reduce_motion());
                if turning {
                    window.request_animation_frame();
                }
                icon.path(icon_path(name, stroke))
                    .with_transformation(Transformation::scale(size(scale, 1.)))
                    .into_any_element()
            }
            (Some(id), None) => icon
                .with_animation(
                    id,
                    Animation::new(std::time::Duration::from_millis(900)).repeat(),
                    |svg, delta| svg.with_transformation(Transformation::rotate(percentage(delta))),
                )
                .into_any_element(),
            (None, None) => icon.into_any_element(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::Theme;
    use core::prelude::v1::test;

    fn key(icon: &FileIcon, scale: f32, palette: Theme, foreground: Rgba) -> String {
        let Resource::Embedded(path) = icon.resource(scale, palette, foreground) else {
            panic!("File icons must use the embedded asset source");
        };
        assert!(crate::file_kind::glyph_svg(&path).is_some());
        path.to_string()
    }

    #[test]
    fn file_icon_resources_bind_palette_foreground_and_device_resolution() {
        let light = Theme::new(false);
        let dark = Theme::new(true);
        let folder = FileIcon::folder("default");
        let red = light.danger;
        let blue = light.accent;
        assert_ne!(red, blue);
        let first = key(&folder, 1., light, red);
        assert_eq!(first, key(&folder, 1., light, red));
        assert_ne!(first, key(&folder, 1., light, blue));
        assert_ne!(first, key(&folder, 2., light, red));
        assert!(first.contains("/folder/18/18/"));
        assert!(key(&folder, 1.25, light, red).contains("/folder/18/23/"));
        let svg = String::from_utf8(crate::file_kind::glyph_svg(&first).unwrap()).unwrap();
        assert!(svg.contains(&crate::theme::css_hex(red)));
        let office = FileIcon::file("model.xlsx", "default");
        assert_ne!(key(&office, 2., light, red), key(&office, 2., dark, red));
        // A known file family outranks a contradictory provider hint.
        let hinted = FileIcon::for_node("model.xlsx", Some("image".into()), None, "default");
        assert_eq!(key(&office, 2., light, red), key(&hinted, 2., light, red));
        let mime = FileIcon::for_node(
            "unknown.zzz",
            None,
            Some("application/vnd.sqlite3".into()),
            "default",
        );
        assert!(key(&mime, 2., light, red).contains("/database/"));
    }

    #[test]
    fn file_icon_size_limits_keep_generated_resources_loadable() {
        let palette = Theme::new(false);
        for (requested, expected) in [
            (f32::NAN, 18.),
            (f32::INFINITY, 18.),
            (f32::NEG_INFINITY, 18.),
            (-1., 1.),
            (0., 1.),
            (14.5, 14.5),
            (900., 512.),
        ] {
            let icon = FileIcon::file("README.md", "default").size_px(requested);
            assert_eq!(f32::from(icon.size), expected);
            let path = key(&icon, 2., palette, palette.text);
            assert!(path.contains(&format!("/{expected}/{}/", (expected * 2.).ceil())));
        }
        let icon = FileIcon::file("README.md", "default").size_px(512.);
        assert!(key(&icon, 16., palette, palette.text).contains("/512/4096/"));
    }
}
