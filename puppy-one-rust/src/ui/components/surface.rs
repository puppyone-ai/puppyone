//! Framed product surfaces: menus, popovers, dialogs and bordered cards.
//!
//! Two GPUI rendering facts shape every bordered surface in the native port:
//! 1. GPUI paints a `div`'s `.bg(...)` *under* its `.border_1()`, so a
//!    translucent border (`border`, `divider`, `shell_divider`) muddies with
//!    the surface fill unless the fill is drawn on an inner padding-box layer
//!    ([`padding_box_fill`], `background-clip: padding-box`).
//! 2. GPUI's `.overflow_hidden()` pushes an axis-aligned rectangular
//!    `ContentMask`, never a rounded path. Any child that paints its own
//!    `.bg(...)` up to an outer corner of a framed surface must round that
//!    corner to [`inner_radius`] via [`SurfaceCorners`] /
//!    [`SurfaceStyledExt::surface_corners`].
use crate::{
    theme::{self, Theme, metric},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use gpui_kit::base::StyledExt as _;
use std::rc::Rc;

type KeyDownHandler = Rc<dyn Fn(&KeyDownEvent, &mut Window, &mut App)>;
type MouseDownHandler = Rc<dyn Fn(&MouseDownEvent, &mut Window, &mut App)>;

/// A stable id for a named part of a component.
pub(crate) fn child_id(parent: &ElementId, name: impl Into<SharedString>) -> ElementId {
    ElementId::NamedChild(std::sync::Arc::new(parent.clone()), name.into())
}

/// Inner radius of a 1px-bordered surface of outer `radius`, concentric with
/// the inside edge of its border.
pub fn inner_radius(radius: f32) -> f32 {
    (radius - 1.).max(0.)
}

/// `background-clip: padding-box`: fills the padding box of a positioned
/// 1px-bordered surface at `inner_radius(radius)` so a translucent border
/// composites over the backdrop rather than the surface fill.
///
/// Not for a scrolling element itself (an absolute child counts toward scroll
/// bounds); scroll an inner child inside [`SurfaceFrame`].
pub fn padding_box_fill(radius: f32, fill: Rgba) -> Div {
    div()
        .absolute()
        .inset_0()
        .rounded(px(inner_radius(radius)))
        .bg(fill)
}

/// Which outer corners of a [`SurfaceFrame`] an edge-touching child meets.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SurfaceCorners {
    pub top_left: bool,
    pub top_right: bool,
    pub bottom_left: bool,
    pub bottom_right: bool,
}
impl SurfaceCorners {
    pub const fn none() -> Self {
        Self {
            top_left: false,
            top_right: false,
            bottom_left: false,
            bottom_right: false,
        }
    }
    pub const fn all() -> Self {
        Self {
            top_left: true,
            top_right: true,
            bottom_left: true,
            bottom_right: true,
        }
    }
    /// A full-width header band touching the top edge.
    pub const fn top() -> Self {
        Self {
            top_left: true,
            top_right: true,
            bottom_left: false,
            bottom_right: false,
        }
    }
    /// A full-width footer band touching the bottom edge.
    pub const fn bottom() -> Self {
        Self {
            top_left: false,
            top_right: false,
            bottom_left: true,
            bottom_right: true,
        }
    }
    /// A full-height column touching the start edge.
    pub const fn left() -> Self {
        Self {
            top_left: true,
            top_right: false,
            bottom_left: true,
            bottom_right: false,
        }
    }
    /// A full-height column touching the end edge.
    pub const fn right() -> Self {
        Self {
            top_left: false,
            top_right: true,
            bottom_left: false,
            bottom_right: true,
        }
    }
    pub const fn top_left() -> Self {
        Self {
            top_left: true,
            ..Self::none()
        }
    }
    pub const fn top_right() -> Self {
        Self {
            top_right: true,
            ..Self::none()
        }
    }
    /// A sidebar column beneath a full-width header.
    pub const fn bottom_left() -> Self {
        Self {
            bottom_left: true,
            ..Self::none()
        }
    }
    /// An auxiliary column beneath a full-width header.
    pub const fn bottom_right() -> Self {
        Self {
            bottom_right: true,
            ..Self::none()
        }
    }
    pub const fn or(self, other: Self) -> Self {
        Self {
            top_left: self.top_left || other.top_left,
            top_right: self.top_right || other.top_right,
            bottom_left: self.bottom_left || other.bottom_left,
            bottom_right: self.bottom_right || other.bottom_right,
        }
    }
    pub const fn when(self, condition: bool, other: Self) -> Self {
        if condition { self.or(other) } else { self }
    }
}

/// Applies concentric inner corner radii to children touching a framed
/// surface's outer border.
pub trait SurfaceStyledExt: Styled + Sized {
    fn surface_corners(mut self, outer_radius: f32, corners: SurfaceCorners) -> Self {
        let r = px(inner_radius(outer_radius));
        if corners.top_left {
            self = self.rounded_tl(r);
        }
        if corners.top_right {
            self = self.rounded_tr(r);
        }
        if corners.bottom_left {
            self = self.rounded_bl(r);
        }
        if corners.bottom_right {
            self = self.rounded_br(r);
        }
        self
    }
}
impl<T: Styled> SurfaceStyledExt for T {}

/// Semantic shadow tier (`--po-elevation-*`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SurfaceElevation {
    #[default]
    None,
    /// `--po-elevation-low`: compact menus, sidebar action menus, pickers.
    Low,
    /// `--po-elevation-popover`: standard menus, notices, coachmarks.
    Popover,
    /// `.desktop-project-menu`: two-layer header switcher shadow.
    Project,
    /// Floating callout cards (Share card, Cloud Agent cards).
    Card,
    /// `.desktop-dialog-surface`: modal and task dialogs.
    Dialog,
}
impl SurfaceElevation {
    pub fn shadows(self, t: Theme) -> Vec<BoxShadow> {
        let box_shadow = |color: Rgba, y: f32, blur: f32, spread: f32| BoxShadow {
            inset: false,
            color: color.into(),
            offset: point(px(0.), px(y)),
            blur_radius: px(blur),
            spread_radius: px(spread),
        };
        match self {
            Self::None => vec![],
            Self::Low => vec![theme::elevation_low(&t)],
            Self::Popover => vec![box_shadow(
                theme::alpha(t.shadow, if t.dark { 0.36 } else { 0.64 }),
                3.,
                8.,
                -4.,
            )],
            Self::Project => vec![
                box_shadow(theme::alpha(t.shadow, 0.45), 2., 4., 0.),
                box_shadow(theme::alpha(t.shadow, 0.65), 6., 16., -4.),
            ],
            Self::Card => vec![
                box_shadow(theme::alpha(t.shadow, 0.35), 2., 4., 0.),
                box_shadow(theme::alpha(t.shadow, 0.60), 12., 32., -6.),
            ],
            Self::Dialog => vec![box_shadow(t.shadow, 24., 48., 0.)],
        }
    }
}

/// Which product surface a [`SurfaceFrame`] is.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SurfaceVariant {
    /// `.desktop-menu-surface`: 8px radius, `menu_bg`, `border`, popover shadow.
    #[default]
    Menu,
    /// Compact menu / inline picker: 8px radius, `menu_bg`, `border`, low shadow.
    CompactMenu,
    /// `.desktop-project-menu`: 8px radius, `header`, `shell_divider`, project shadow.
    ProjectMenu,
    /// Floating callout card: 12px radius, `menu_bg`, `shell_divider`, card shadow.
    PopoverCard,
    /// `.desktop-dialog-surface`: 12px radius, `overlay`, `border`, dialog shadow.
    Dialog,
    /// `.desktop-settings-dialog`: 14px radius, `canvas`, `divider`, dialog shadow.
    TaskDialog,
    /// Framed in-page card: 8px radius, `canvas`, `divider`, no shadow.
    Card,
}

#[derive(Clone, Copy)]
struct ResolvedSurface {
    radius: f32,
    fill: Rgba,
    stroke: Rgba,
    elevation: SurfaceElevation,
    occlude: bool,
    clip: bool,
}
impl SurfaceVariant {
    pub const fn elevation(self) -> SurfaceElevation {
        match self {
            Self::Menu => SurfaceElevation::Popover,
            Self::CompactMenu => SurfaceElevation::Low,
            Self::ProjectMenu => SurfaceElevation::Project,
            Self::PopoverCard => SurfaceElevation::Card,
            Self::Dialog | Self::TaskDialog => SurfaceElevation::Dialog,
            Self::Card => SurfaceElevation::None,
        }
    }
    fn resolve(self, t: Theme) -> ResolvedSurface {
        match self {
            Self::Menu => ResolvedSurface {
                radius: metric::MENU_RADIUS,
                fill: t.menu_bg,
                stroke: t.border,
                elevation: self.elevation(),
                occlude: true,
                clip: false,
            },
            Self::CompactMenu => ResolvedSurface {
                radius: metric::MENU_RADIUS,
                fill: t.menu_bg,
                stroke: t.border,
                elevation: self.elevation(),
                occlude: true,
                clip: false,
            },
            Self::ProjectMenu => ResolvedSurface {
                radius: metric::MENU_RADIUS,
                fill: t.header,
                stroke: t.shell_divider,
                elevation: self.elevation(),
                occlude: true,
                clip: false,
            },
            Self::PopoverCard => ResolvedSurface {
                radius: metric::DIALOG_RADIUS,
                fill: t.menu_bg,
                stroke: t.shell_divider,
                elevation: self.elevation(),
                occlude: true,
                clip: true,
            },
            Self::Dialog => ResolvedSurface {
                radius: metric::DIALOG_RADIUS,
                fill: t.overlay,
                stroke: t.border,
                elevation: self.elevation(),
                occlude: true,
                clip: true,
            },
            Self::TaskDialog => ResolvedSurface {
                radius: metric::TASK_DIALOG_RADIUS,
                fill: t.canvas,
                stroke: t.divider,
                elevation: self.elevation(),
                occlude: true,
                clip: true,
            },
            Self::Card => ResolvedSurface {
                radius: metric::CARD_RADIUS,
                fill: t.canvas,
                stroke: t.divider,
                elevation: self.elevation(),
                occlude: false,
                clip: true,
            },
        }
    }
}

/// Shared framed container for menus, popovers, dialogs and bordered cards.
#[derive(IntoElement)]
pub struct SurfaceFrame {
    id: ElementId,
    variant: SurfaceVariant,
    palette: Option<Theme>,
    radius: Option<f32>,
    fill: Option<Rgba>,
    stroke: Option<Rgba>,
    elevation: Option<SurfaceElevation>,
    occlude: Option<bool>,
    clip: Option<bool>,
    absorb_mouse_down: bool,
    focus: Option<FocusHandle>,
    key_down: Option<KeyDownHandler>,
    mouse_down_out: Option<MouseDownHandler>,
    #[cfg(any(test, all(debug_assertions, feature = "test-support")))]
    debug_selector: Option<String>,
    children: Vec<AnyElement>,
    style: StyleRefinement,
}
impl SurfaceFrame {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            variant: SurfaceVariant::Menu,
            palette: None,
            radius: None,
            fill: None,
            stroke: None,
            elevation: None,
            occlude: None,
            clip: None,
            absorb_mouse_down: false,
            focus: None,
            key_down: None,
            mouse_down_out: None,
            #[cfg(any(test, all(debug_assertions, feature = "test-support")))]
            debug_selector: None,
            children: Vec::new(),
            style: StyleRefinement::default(),
        }
    }
    pub fn menu(id: impl Into<ElementId>) -> Self {
        Self::new(id).variant(SurfaceVariant::Menu)
    }
    pub fn compact_menu(id: impl Into<ElementId>) -> Self {
        Self::new(id).variant(SurfaceVariant::CompactMenu)
    }
    pub fn project_menu(id: impl Into<ElementId>) -> Self {
        Self::new(id).variant(SurfaceVariant::ProjectMenu)
    }
    pub fn popover_card(id: impl Into<ElementId>) -> Self {
        Self::new(id).variant(SurfaceVariant::PopoverCard)
    }
    pub fn dialog(id: impl Into<ElementId>) -> Self {
        Self::new(id).variant(SurfaceVariant::Dialog)
    }
    pub fn task_dialog(id: impl Into<ElementId>) -> Self {
        Self::new(id).variant(SurfaceVariant::TaskDialog)
    }
    pub fn card(id: impl Into<ElementId>) -> Self {
        Self::new(id).variant(SurfaceVariant::Card)
    }
    pub fn variant(mut self, variant: SurfaceVariant) -> Self {
        self.variant = variant;
        self
    }
    /// Explicit palette for surfaces rendered outside the window's global
    /// `Appearance` (such as isolated editor views and lab captures).
    pub fn palette(mut self, palette: Theme) -> Self {
        self.palette = Some(palette);
        self
    }
    pub fn radius(mut self, radius: f32) -> Self {
        self.radius = Some(radius);
        self
    }
    /// Padding-box fill colour (drawn inside the 1px border).
    pub fn fill(mut self, fill: Rgba) -> Self {
        self.fill = Some(fill);
        self
    }
    /// 1px border colour.
    pub fn stroke(mut self, stroke: Rgba) -> Self {
        self.stroke = Some(stroke);
        self
    }
    pub fn elevation(mut self, elevation: SurfaceElevation) -> Self {
        self.elevation = Some(elevation);
        self
    }
    pub fn occlude(mut self, occlude: bool) -> Self {
        self.occlude = Some(occlude);
        self
    }
    pub fn clip(mut self, clip: bool) -> Self {
        self.clip = Some(clip);
        self
    }
    /// Stops primary and secondary mouse presses from reaching backdrops or
    /// canvases behind this surface.
    pub fn absorb_mouse_down(mut self) -> Self {
        self.absorb_mouse_down = true;
        self
    }
    pub fn track_focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
        self
    }
    pub fn on_key_down(
        mut self,
        handler: impl Fn(&KeyDownEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.key_down = Some(Rc::new(handler));
        self
    }
    pub fn on_mouse_down_out(
        mut self,
        handler: impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.mouse_down_out = Some(Rc::new(handler));
        self
    }
    #[cfg(any(test, all(debug_assertions, feature = "test-support")))]
    pub fn debug_selector(mut self, selector: impl FnOnce() -> String) -> Self {
        self.debug_selector = Some(selector());
        self
    }
    #[cfg(not(any(test, all(debug_assertions, feature = "test-support"))))]
    #[inline]
    pub fn debug_selector(self, _: impl FnOnce() -> String) -> Self {
        self
    }
}
impl ParentElement for SurfaceFrame {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}
impl Styled for SurfaceFrame {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for SurfaceFrame {
    fn render(mut self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = self.palette.unwrap_or_else(|| cx.palette());
        let defaults = self.variant.resolve(t);
        let radius = self.radius.unwrap_or(defaults.radius);
        let fill = self.fill.unwrap_or(defaults.fill);
        let stroke = self.stroke.unwrap_or(defaults.stroke);
        let elevation = self.elevation.unwrap_or(defaults.elevation);
        let occlude = self.occlude.unwrap_or(defaults.occlude);
        let clip = self.clip.unwrap_or(defaults.clip);
        // Never paint a border-box background under a translucent border.
        self.style.background = None;

        let frame = div()
            .id(self.id)
            .relative()
            .flex()
            .flex_col()
            .border_1()
            .border_color(stroke)
            .rounded(px(radius))
            .shadow(elevation.shadows(t))
            .text_color(t.text)
            .when(occlude, |d| d.occlude())
            .when(clip, |d| d.overflow_hidden())
            .when_some(self.focus, |d, focus| d.track_focus(&focus))
            .when_some(self.key_down, |d, on_key| {
                d.on_key_down(move |e, window, cx| on_key(e, window, cx))
            })
            .when_some(self.mouse_down_out, |d, outside| {
                d.on_mouse_down_out(move |e, window, cx| outside(e, window, cx))
            })
            .when(self.absorb_mouse_down, |d| {
                d.on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_mouse_down(MouseButton::Right, |_, _, cx| cx.stop_propagation())
            })
            .child(padding_box_fill(radius, fill))
            .children(self.children)
            .refine_style(&self.style);

        #[cfg(any(test, all(debug_assertions, feature = "test-support")))]
        let frame = if let Some(selector) = self.debug_selector {
            frame.debug_selector(move || selector)
        } else {
            frame
        };

        frame
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn inner_radius_stays_concentric_and_non_negative() {
        assert_eq!(inner_radius(14.), 13.);
        assert_eq!(inner_radius(8.), 7.);
        assert_eq!(inner_radius(1.), 0.);
        assert_eq!(inner_radius(0.), 0.);
    }

    #[test]
    fn surface_corners_compose_cleanly() {
        assert_eq!(
            SurfaceCorners::top().when(false, SurfaceCorners::bottom()),
            SurfaceCorners {
                top_left: true,
                top_right: true,
                bottom_left: false,
                bottom_right: false,
            }
        );
        assert_eq!(
            SurfaceCorners::top().when(true, SurfaceCorners::bottom()),
            SurfaceCorners::all()
        );
        assert_eq!(
            SurfaceCorners::bottom_left().or(SurfaceCorners::bottom_right()),
            SurfaceCorners::bottom()
        );
    }
}
