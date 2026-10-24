//! The find widget (editor/find/editorFind.tsx `EditorFindHost`,
//! editor-find.css): a 304px bar 10px from the pane's top-end corner with the
//! query, the "n of m" result, previous / next and close. Enter / ⇧Enter
//! move, Escape closes and returns focus to the editor. The editor's adapter
//! does the searching; this bar only reports intents.
use crate::{
    localization::{Arg, t, tf},
    theme::{self, Theme},
    ui::{
        components::{Icon, tooltip},
        form_input::{InputEvent, TextInput},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;

#[derive(Clone, Debug, PartialEq)]
pub enum FindEvent {
    Query(String),
    Move { forward: bool },
    Close,
}

pub struct FindBar {
    input: Entity<TextInput>,
    pub open: bool,
    /// `EditorFindResult`.
    pub current: usize,
    pub total: usize,
    dark: bool,
    _subscription: Subscription,
}

impl EventEmitter<FindEvent> for FindBar {}

impl FindBar {
    pub fn new(dark: bool, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| {
            let mut input = TextInput::new(t("editor.find.placeholder"), false, 512, window, cx);
            input.appearance = false;
            input.submit_on_enter = true;
            input.min_height = 0.;
            input
        });
        let subscription = cx.subscribe(&input, |this: &mut Self, input, event: &InputEvent, cx| match event {
            InputEvent::Changed => cx.emit(FindEvent::Query(input.read(cx).text().to_owned())),
            InputEvent::Submit => this.step(true, cx),
        });
        Self { input, open: false, current: 0, total: 0, dark, _subscription: subscription }
    }

    pub fn query(&self, cx: &App) -> String {
        self.input.read(cx).text().to_owned()
    }

    /// `openFind`: show the bar and select its query.
    pub fn show(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open = true;
        let handle = self.input.read(cx).focus_handle(cx);
        handle.focus(window, cx);
        window.dispatch_action(Box::new(gpui_kit::base::input::SelectAll), cx);
        let query = self.query(cx);
        cx.emit(FindEvent::Query(query));
        cx.notify();
    }

    pub fn hide(&mut self, cx: &mut Context<Self>) {
        self.open = false;
        self.current = 0;
        self.total = 0;
        cx.notify();
    }

    pub fn set_result(&mut self, current: usize, total: usize, cx: &mut Context<Self>) {
        if (self.current, self.total) != (current, total) {
            self.current = current;
            self.total = total;
            cx.notify();
        }
    }

    fn step(&mut self, forward: bool, cx: &mut Context<Self>) {
        if !self.query(cx).is_empty() {
            cx.emit(FindEvent::Move { forward });
        }
    }
}

impl Render for FindBar {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t_ = Theme::new(self.dark);
        let has_query = !self.query(cx).is_empty();
        let can_move = has_query && self.total > 0;
        let result = if !has_query {
            None
        } else if self.total > 0 {
            Some(tf("editor.find.resultCount", &[("current", Arg::Number(self.current as i64)), ("total", Arg::Number(self.total as i64))]))
        } else {
            Some(t("editor.find.noResults").to_owned())
        };
        let control_tight = theme::control_tight();
        let button = |id: &'static str, icon: &'static str, label: &'static str, enabled: bool| {
            let fg = if enabled { t_.muted } else { t_.text_disabled };
            let (hover_bg, hover_fg) = (t_.control_hover, t_.text);
            div()
                .id(id)
                .flex()
                .items_center()
                .justify_center()
                .w(px(24.))
                .h(px(control_tight))
                .flex_shrink_0()
                .rounded(px(4.))
                .tooltip(tooltip(t(label)))
                .child(Icon::new(icon).color(fg))
                .when(enabled, |d| d.cursor(theme::clickable_cursor()).hover(move |s| s.bg(hover_bg).text_color(hover_fg)))
        };
        // `--po-elevation-low`.
        let shadow = BoxShadow { color: theme::alpha(t_.shadow, 0.28).into(), offset: point(px(0.), px(2.)), blur_radius: px(4.), spread_radius: px(-2.), inset: false };
        // `:focus-within` strengthens the border.
        let focused = self.input.read(cx).focus_handle(cx).contains_focused(window, cx);
        let border = if focused { theme::mix(t_.muted, t_.border, 0.48) } else { theme::mix(t_.border_subtle, Rgba::default(), 0.86) };
        div()
            .id("editor-find-widget")
            .occlude()
            .absolute()
            .top(px(10.))
            .right(px(12.))
            .w(px(304.))
            .h(px(theme::control()))
            .flex()
            .items_center()
            .gap(px(2.))
            .px(px(3.))
            .py(px(2.))
            .border_1()
            .border_color(border)
            .rounded(px(8.))
            .bg(theme::mix(t_.overlay, t_.panel_raised, 0.88))
            .text_color(t_.subtle)
            .shadow(vec![shadow])
            .capture_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| {
                let key = e.keystroke.key.as_str();
                if key == "escape" {
                    cx.stop_propagation();
                    cx.emit(FindEvent::Close);
                } else if key == "enter" && e.keystroke.modifiers.shift {
                    cx.stop_propagation();
                    this.step(false, cx);
                }
            }))
            .child(div().ml(px(4.)).mr(px(2.)).flex_shrink_0().child(Icon::new("search").small().color(theme::mix(t_.accent, t_.muted, 0.42))))
            .child(div().flex_1().min_w_0().h(px(control_tight)).flex().items_center().px(px(4.)).text_size(px(theme::ty().ui.label)).child(self.input.clone()))
            .children(result.map(|label| {
                div()
                    .min_w(px(44.))
                    .max_w(px(72.))
                    .pl(px(7.))
                    .pr(px(5.))
                    .border_l_1()
                    .border_color(t_.divider)
                    .text_color(t_.subtle)
                    .text_size(px(theme::ty().ui.caption))
                    .flex()
                    .justify_center()
                    .whitespace_nowrap()
                    .overflow_hidden()
                    .text_ellipsis()
                    .child(label)
            }))
            .child(button("editor-find-previous", "chevron-up", "editor.find.previous", can_move).on_click(cx.listener(|this, _, _, cx| this.step(false, cx))))
            .child(button("editor-find-next", "chevron-down", "editor.find.next", can_move).on_click(cx.listener(|this, _, _, cx| this.step(true, cx))))
            .child(button("editor-find-close", "x", "editor.find.close", true).on_click(cx.listener(|_, _, _, cx| cx.emit(FindEvent::Close))))
    }
}
