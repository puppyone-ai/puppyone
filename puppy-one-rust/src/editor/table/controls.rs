//! The editable table's controls (editable-table.css): the add-row /
//! add-column rails in the action gutters, the drag grips, and the column
//! resize rail. Builders are stateless: each format positions them in its
//! own coordinates and passes the handlers that run its operations.
use super::{operation::Axis, style::EditableTableStyle};
use gpui::{prelude::*, *};
use std::rc::Rc;

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;
/// A handler that receives the event's value (a position, a hover state).
type HandlerWith<T> = Rc<dyn Fn(T, &mut Window, &mut App)>;

/// The 13px rail visual centred in the action gutter.
const RAIL: f32 = 13.;

/// One structure rail (`.po-editable-table-structure-button`): revealed
/// while `group` (the interaction root) is hovered; its visual lights and
/// shows a `+` on direct hover.
fn rail(
    style: &EditableTableStyle,
    id: SharedString,
    group: SharedString,
    bounds: Bounds<f32>,
    bar: Bounds<f32>,
    on_click: Handler,
) -> AnyElement {
    let (hover_bg, hover_border, hover_color) = (
        style.structure_hover_background,
        style.structure_hover_border,
        style.structure_hover_color,
    );
    let rail_group = id.clone();
    let plus = |w: f32, h: f32| {
        let rail_group = rail_group.clone();
        div()
            .absolute()
            .left(px(bar.origin.x + (bar.size.width - w) / 2.))
            .top(px(bar.origin.y + (bar.size.height - h) / 2.))
            .w(px(w))
            .h(px(h))
            .rounded(px(1.))
            .group_hover(rail_group, move |s| s.bg(hover_color))
    };
    div()
        .id(id.clone())
        .group(id.clone())
        .absolute()
        .left(px(bounds.origin.x))
        .top(px(bounds.origin.y))
        .w(px(bounds.size.width))
        .h(px(bounds.size.height))
        .opacity(0.)
        .group_hover(group, |s| s.opacity(1.))
        .cursor(crate::theme::clickable_cursor())
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(move |_, window, cx| on_click(window, cx))
        .child(
            div()
                .absolute()
                .left(px(bar.origin.x))
                .top(px(bar.origin.y))
                .w(px(bar.size.width))
                .h(px(bar.size.height))
                .rounded(px(2.))
                .border_1()
                .border_color(Rgba::default())
                .bg(style.structure_background)
                .group_hover(id, move |s| s.bg(hover_bg).border_color(hover_border)),
        )
        .child(plus(7., 1.))
        .child(plus(1., 7.))
        .into_any_element()
}

/// The add-row rail below and the add-column rail after a table whose
/// border box is `table`.
pub fn rails(
    style: &EditableTableStyle,
    id: &str,
    group: SharedString,
    table: Bounds<f32>,
    add_row: Handler,
    add_column: Handler,
) -> Vec<AnyElement> {
    let g = style.action_gutter;
    let inset = (g - RAIL) / 2.;
    let (x, y, w, h) = (
        table.origin.x,
        table.origin.y,
        table.size.width,
        table.size.height,
    );
    vec![
        rail(
            style,
            format!("{id}-add-row").into(),
            group.clone(),
            rect(x, y + h, w, g),
            rect(0., inset, w, RAIL),
            add_row,
        ),
        rail(
            style,
            format!("{id}-add-column").into(),
            group,
            rect(x + w, y, g, h),
            rect(inset, 0., RAIL, h),
            add_column,
        ),
    ]
}

fn rect(x: f32, y: f32, w: f32, h: f32) -> Bounds<f32> {
    Bounds {
        origin: point(x, y),
        size: size(w, h),
    }
}

/// What a grip hands back.
#[derive(Clone)]
pub struct GripHandlers {
    /// A press (left button) at a window position: start a drag.
    pub press: HandlerWith<Point<Pixels>>,
    /// A secondary press: open the axis menu.
    pub menu: Handler,
    pub hover: HandlerWith<bool>,
}

/// The grip's hit target (`.po-editable-table-column-handle` 32×24,
/// `.po-editable-table-row-handle` 24×32).
pub fn grip_size(axis: Axis) -> (f32, f32) {
    match axis {
        Axis::Column => (32., 24.),
        Axis::Row => (24., 32.),
    }
}

/// A drag grip (`.po-editable-table-drag-handle`): the 22×14 / 14×22 face
/// with three dots (`radial-gradient` on a 4px tile), selection-coloured
/// while pressed, dragged or showing its menu (`active`).
pub fn grip(
    style: &EditableTableStyle,
    axis: Axis,
    id: SharedString,
    bounds: Bounds<f32>,
    active: bool,
    dragging: bool,
    handlers: GripHandlers,
) -> AnyElement {
    let (w, h) = match axis {
        Axis::Column => (22., 14.),
        Axis::Row => (14., 22.),
    };
    // `.is-menu-active` / `.is-dragging`: white dots on the selection fill.
    let white = crate::theme::on_solid();
    let (face, dots, hover) = if active {
        (style.selection_border, white, white)
    } else {
        (
            style.handle_background,
            style.handle_color,
            style.handle_hover_color,
        )
    };
    let left = (bounds.size.width - w) / 2.;
    let top = (bounds.size.height - h) / 2.;
    let dot = |i: f32| {
        let (x, y) = match axis {
            Axis::Column => (7. + 4. * i, 7.),
            Axis::Row => (7., 7. + 4. * i),
        };
        let group = id.clone();
        div()
            .absolute()
            .left(px(x - 1.))
            .top(px(y - 1.))
            .size(px(2.))
            .rounded(px(1.))
            .bg(dots)
            .group_hover(group, move |s| s.bg(hover))
    };
    let GripHandlers {
        press,
        menu,
        hover: on_hover,
    } = handlers;
    div()
        .id(id.clone())
        .group(id.clone())
        .absolute()
        .left(px(bounds.origin.x))
        .top(px(bounds.origin.y))
        .w(px(bounds.size.width))
        .h(px(bounds.size.height))
        .cursor(if dragging {
            CursorStyle::ClosedHand
        } else {
            CursorStyle::OpenHand
        })
        .on_hover(move |hovered, window, cx| on_hover(*hovered, window, cx))
        .on_mouse_down(MouseButton::Left, move |e: &MouseDownEvent, window, cx| {
            cx.stop_propagation();
            press(e.position, window, cx);
        })
        .on_mouse_down(MouseButton::Right, move |_, window, cx| {
            cx.stop_propagation();
            menu(window, cx);
        })
        .child(
            div()
                .absolute()
                .left(px(left))
                .top(px(top))
                .w(px(w))
                .h(px(h))
                .rounded(px(2.))
                .bg(face)
                .child(dot(0.))
                .child(dot(1.))
                .child(dot(2.)),
        )
        .into_any_element()
}

/// What the resize rail hands back: a press at window x, or a double-click.
#[derive(Clone)]
pub struct ResizeHandlers {
    pub press: HandlerWith<f32>,
    pub auto_fit: Handler,
}

/// The column resize rail (`.csv-table-editor__column-resize-handle`): 9px
/// centred on a column's end edge (`edge`) over `top..top + height`; its 1px
/// accent line shows on hover and while `resizing`.
pub fn resize_rail(
    style: &EditableTableStyle,
    id: SharedString,
    edge: f32,
    top: f32,
    height: f32,
    resizing: bool,
    handlers: ResizeHandlers,
) -> AnyElement {
    let accent = style.accent;
    let ring = BoxShadow {
        color: Rgba {
            a: accent.a * 0.18,
            ..accent
        }
        .into(),
        offset: point(px(0.), px(0.)),
        blur_radius: px(0.),
        spread_radius: px(1.),
        inset: false,
    };
    let line = div().absolute().left(px(4.)).top_0().w(px(1.)).h_full();
    let line = if resizing {
        line.bg(accent).shadow(vec![ring])
    } else {
        let group = id.clone();
        line.group_hover(group, move |s| s.bg(accent).shadow(vec![ring.clone()]))
    };
    let ResizeHandlers { press, auto_fit } = handlers;
    div()
        .id(id.clone())
        .group(id)
        .absolute()
        .left(px(edge - 4.5))
        .top(px(top))
        .w(px(9.))
        .h(px(height))
        .cursor(CursorStyle::ResizeLeftRight)
        .on_mouse_down(MouseButton::Left, move |e: &MouseDownEvent, window, cx| {
            cx.stop_propagation();
            if e.click_count >= 2 {
                auto_fit(window, cx)
            } else {
                press(f32::from(e.position.x), window, cx)
            }
        })
        .child(line)
        .into_any_element()
}
