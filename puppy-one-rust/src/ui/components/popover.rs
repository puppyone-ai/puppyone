//! Floating surfaces. GPUI Kit owns the behaviour — trigger measurement,
//! placement and viewport clamping, outside-press and Escape dismissal, focus
//! capture and restore, deferred layering — and these add the product menu.
use super::Menu;
use gpui::{prelude::*, *};
use gpui_kit::base::{POPUP_PRIORITY, Popover, Positioner, Selectable};
use std::rc::Rc;

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;
type OpenChange = Rc<dyn Fn(&bool, &mut Window, &mut App)>;
/// Closes the surface it was handed to.
pub type Dismiss = Rc<dyn Fn(&mut Window, &mut App)>;
type ContentBuilder = Box<dyn FnOnce(Dismiss, &mut Window, &mut App) -> AnyElement>;
type TriggerBuilder = Box<dyn FnOnce(bool) -> AnyElement>;

/// A menu (or any surface) opened by clicking its trigger.
///
/// `anchor` names the corner of the surface placed against the trigger:
/// `TopLeft` hangs it below the trigger's start edge, `TopRight` below its
/// end edge; `offset` is the gap.
#[derive(IntoElement)]
pub struct PopoverMenu {
    id: ElementId,
    anchor: Anchor,
    offset: Pixels,
    open: Option<bool>,
    on_open_change: Option<OpenChange>,
    trigger: Option<TriggerBuilder>,
    content: Option<ContentBuilder>,
    style: StyleRefinement,
}
impl PopoverMenu {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            anchor: Anchor::TopLeft,
            offset: px(4.),
            open: None,
            on_open_change: None,
            trigger: None,
            content: None,
            style: StyleRefinement::default(),
        }
    }
    pub fn anchor(mut self, anchor: Anchor) -> Self {
        self.anchor = anchor;
        self
    }
    pub fn offset(mut self, offset: Pixels) -> Self {
        self.offset = offset;
        self
    }
    /// Controlled open state; pair with `on_open_change`.
    pub fn open(mut self, open: bool) -> Self {
        self.open = Some(open);
        self
    }
    pub fn on_open_change(
        mut self,
        handler: impl Fn(&bool, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_open_change = Some(Rc::new(handler));
        self
    }
    /// The trigger is told when its surface is open (`Selectable::open`).
    pub fn trigger<T: Selectable + IntoElement + 'static>(mut self, trigger: T) -> Self {
        self.trigger = Some(Box::new(move |open| trigger.open(open).into_any_element()));
        self
    }
    /// A product menu; its items close the popover after running.
    pub fn menu(self, build: impl FnOnce(Menu, &mut Window, &mut App) -> Menu + 'static) -> Self {
        let id = self.id.clone();
        self.content(move |dismiss, window, cx| {
            let menu = Menu::new(super::menu::child_id(&id, "menu"))
                .on_dismiss(move |window, cx| dismiss(window, cx));
            build(menu, window, cx).into_any_element()
        })
    }
    /// Any surface; call `dismiss` to close it.
    pub fn content<E: IntoElement>(
        mut self,
        build: impl FnOnce(Dismiss, &mut Window, &mut App) -> E + 'static,
    ) -> Self {
        self.content = Some(Box::new(move |dismiss, window, cx| {
            build(dismiss, window, cx).into_any_element()
        }));
        self
    }
}
impl Styled for PopoverMenu {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for PopoverMenu {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let mut popover = Popover::new(self.id)
            .anchor(self.anchor)
            .offset(self.offset);
        *popover.style() = self.style;
        if let Some(open) = self.open {
            popover = popover.open(open);
        }
        if let Some(handler) = self.on_open_change {
            popover = popover.on_open_change(move |open, window, cx| handler(open, window, cx));
        }
        if let Some(trigger) = self.trigger {
            popover = popover.trigger_with(move |open, _, _| trigger(open));
        }
        if let Some(content) = self.content {
            popover = popover.content(move |_, window, cx| {
                let state = cx.entity().downgrade();
                let dismiss: Dismiss = Rc::new(move |window, cx| {
                    let _ = state.update(cx, |state, cx| state.dismiss(window, cx));
                });
                content(dismiss, window, cx)
            });
        }
        popover
    }
}

/// A surface pinned at a point — a context menu at the pointer — clamped
/// into the window. Its owner holds the open state; a press outside calls
/// `on_dismiss`.
#[derive(IntoElement)]
pub struct AnchoredMenu {
    id: ElementId,
    position: Point<Pixels>,
    anchor: Anchor,
    margin: Pixels,
    content: AnyElement,
    on_dismiss: Option<Handler>,
}
impl AnchoredMenu {
    pub fn new(
        id: impl Into<ElementId>,
        position: Point<Pixels>,
        content: impl IntoElement,
    ) -> Self {
        Self {
            id: id.into(),
            position,
            anchor: Anchor::TopLeft,
            margin: px(12.),
            content: content.into_any_element(),
            on_dismiss: None,
        }
    }
    /// Which corner of the surface sits at the point (`TopLeft` by default).
    pub fn anchor(mut self, anchor: Anchor) -> Self {
        self.anchor = anchor;
        self
    }
    /// Minimum distance from the window edge.
    pub fn margin(mut self, margin: Pixels) -> Self {
        self.margin = margin;
        self
    }
    pub fn on_dismiss(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
}
impl RenderOnce for AnchoredMenu {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let dismiss = self.on_dismiss;
        deferred(
            Positioner::corner(self.anchor, self.position)
                .margin(self.margin)
                .occlude()
                .child(
                    div()
                        .id(self.id)
                        .when_some(dismiss, |d, dismiss| {
                            d.on_mouse_down_out(move |_, window, cx| dismiss(window, cx))
                        })
                        .child(self.content),
                ),
        )
        .with_priority(POPUP_PRIORITY)
    }
}
