//! Native source-code surface. Kit owns the rope, history, selections,
//! indentation, parser, folds and scrolling; this adapter owns the product
//! language/appearance and the retained document snapshot/IME contract.
pub mod conflicts;
mod decorate;
mod find;
mod input;
mod style;
#[cfg(test)]
mod tests;

use crate::{
    editor::{
        code::language::Language,
        registry::{
            PaneEntries, SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface,
        },
        workbench::find::FindEvent,
    },
    typography::Scale,
};
use gpui::{prelude::*, *};
use gpui_kit::component::input::{Editor, EditorState, InputEvent, TabSize};

pub struct CodeView {
    pub(super) field: Entity<EditorState>,
    language: Language,
    committed: String,
    composing: bool,
    read_only: bool,
    find: find::CodeFind,
    dark: bool,
    scale: Scale,
    /// `ConflictMarkerBanner`: the block list is expanded.
    conflicts_expanded: bool,
    /// Bracket, selection-match and trailing-space decorations.
    passive: gpui_kit::component::input::RangeDecorationCollection,
    passive_key: Option<(usize, std::ops::Range<usize>, usize)>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<SurfaceEvent> for CodeView {}

impl CodeView {
    fn new(request: &SurfaceRequest, window: &mut Window, cx: &mut Context<Self>) -> Self {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        let language = Language::resolve(request.format.monaco_language.as_deref(), request.name);
        let text = match request.input {
            SurfaceInput::Text(text) => text,
            _ => "",
        };
        let field = cx.new(|cx| {
            EditorState::new(window, cx)
                .language(language.grammar().unwrap_or("puppyone-plaintext"))
                .tab_size(TabSize {
                    tab_size: language.tab_size(),
                    hard_tabs: false,
                })
                .searchable(false)
                .soft_wrap(false)
                .default_value(text)
        });
        let changed = cx.subscribe_in(&field, window, |this, _, event: &InputEvent, w, cx| {
            if matches!(event, InputEvent::Blur) {
                this.finish_composition(w, cx);
            }
            this.sync(w, cx);
            this.refresh_passive(cx);
        });
        // Kit marks provisional IME edits with notify, not Change. Track them
        // before the host can ask for a snapshot, without publishing drafts.
        let observed = cx.observe_in(&field, window, |this, _, w, cx| {
            this.sync(w, cx);
            this.refresh_passive(cx);
        });
        field.update(cx, |s, _| {
            s.set_gutter_metrics(Some(style::gutter(request.dark, request.scale)))
        });
        let find = find::CodeFind::new(&field, cx);
        let passive = field.update(cx, |s, cx| {
            s.create_range_decorations_collection(Vec::new(), cx)
        });
        style::project(request.dark, request.scale, cx);
        Self {
            field,
            language,
            committed: text.into(),
            composing: false,
            read_only: false,
            find,
            dark: request.dark,
            scale: request.scale,
            conflicts_expanded: false,
            passive,
            passive_key: None,
            _subscriptions: vec![changed, observed],
        }
    }
    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (composing, value) = self.field.update(cx, |s, cx| {
            let composing = s.marked_text_range(window, cx).is_some();
            (composing, (!composing).then(|| s.value().to_string()))
        });
        let ended = self.composing && !composing;
        self.composing = composing;
        if let Some(value) = value {
            let changed = self.committed != value;
            self.committed = value;
            if changed && self.find.active() {
                self.refresh_find(false, cx);
            }
            if changed || ended {
                cx.emit(SurfaceEvent::Changed);
            }
        }
    }
    fn finish_composition(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.composing {
            self.field.update(cx, |s, cx| s.unmark_text(window, cx));
            self.sync(window, cx);
            crate::ui::ime::discard_marked_text();
        }
    }
    fn replace(&mut self, text: &str, window: &mut Window, cx: &mut Context<Self>) {
        // External source replacement resets history and abandons provisional
        // input, without reporting it back as a local edit.
        let was_composing = self.composing;
        self.composing = false;
        self.committed = text.into();
        self.field.update(cx, |s, cx| {
            s.unmark_text(window, cx);
            s.set_value(text, window, cx);
        });
        if was_composing {
            crate::ui::ime::discard_marked_text();
        }
        if self.find.active() {
            self.refresh_find(false, cx);
        }
        cx.notify();
    }
    /// `bracketMatching`, `highlightSelectionMatches`, `highlightTrailingWhitespace`.
    fn refresh_passive(&mut self, cx: &mut Context<Self>) {
        use gpui_kit::component::input::{RangeDecoration, RangeDecorationStyle};
        let (cursor, selection, len) = {
            let s = self.field.read(cx);
            (s.cursor(), s.selected_range(), s.text().len())
        };
        let key = (cursor, selection.clone(), len);
        if self.passive_key.as_ref() == Some(&key) {
            return;
        }
        self.passive_key = Some(key);
        let text = self.committed.clone();
        let p = crate::theme::Theme::new(self.dark);
        let fill = |r: std::ops::Range<usize>, c: Rgba, a: f32| {
            RangeDecoration::new(r)
                .with_style(RangeDecorationStyle::Fill)
                .with_color(crate::theme::alpha(c, a).into())
        };
        let frame = |r: std::ops::Range<usize>, c: Rgba, a: f32| {
            RangeDecoration::new(r).with_color(crate::theme::alpha(c, a).into())
        };
        let mut marks = vec![];
        for r in decorate::trailing_whitespace(&text) {
            marks.push(fill(r, p.danger, 0.20));
        }
        for r in decorate::selection_matches(&text, selection.clone()) {
            marks.push(fill(r, p.accent, 0.10));
        }
        if selection.is_empty() {
            match decorate::brackets(&text, cursor) {
                Some(decorate::Brackets::Matched(a, b)) => {
                    for r in [a, b] {
                        marks.push(fill(r.clone(), p.accent, 0.18));
                        marks.push(frame(r, p.accent, 0.38));
                    }
                }
                Some(decorate::Brackets::Unmatched(r)) => {
                    marks.push(fill(r.clone(), p.danger, 0.16));
                    marks.push(frame(r, p.danger, 0.40));
                }
                None => {}
            }
        }
        self.passive.set(marks, cx);
    }
    /// A conflict resolution is an ordinary local edit (undoable, saved).
    fn resolve_conflicts(&mut self, resolved: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only || resolved == self.committed {
            return;
        }
        let whole = 0..self.committed.encode_utf16().count();
        self.field.update(cx, |s, cx| {
            s.replace_text_in_range(Some(whole), &resolved, window, cx)
        });
        self.sync(window, cx);
        cx.notify();
    }
    fn conflict_banner(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        use crate::localization::{t, tf};
        use crate::ui::appearance::ActiveAppearance;
        let blocks = conflicts::parse(&self.committed);
        if blocks.is_empty() {
            return None;
        }
        let p = cx.palette();
        let ty = crate::theme::ty();
        let button = |id: ElementId, label: String| {
            div()
                .id(id)
                .px(px(8.))
                .py(px(4.))
                .rounded(px(5.))
                .bg(p.control)
                .text_color(p.text)
                .text_size(px(ty.ui.meta))
                .hover(move |d| d.bg(p.control_hover))
                .cursor(crate::theme::clickable_cursor())
                .child(label)
        };
        let mut row = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(12.))
            .child(
                div()
                    .px(px(8.))
                    .py(px(2.))
                    .rounded(px(4.))
                    .bg(p.warning)
                    .text_color(p.text_inverse)
                    .text_size(px(ty.ui.caption))
                    .child(t("editor.conflict.badge")),
            )
            .child(tf(
                "editor.conflict.summary",
                &[("count", (blocks.len() as i64).into())],
            ));
        if !self.read_only {
            row = row
                .child(
                    button(
                        "conflict-keep-ours".into(),
                        t("editor.conflict.keepServer").into(),
                    )
                    .on_click(cx.listener(|v, _, w, cx| {
                        let resolved = conflicts::resolve_all(&v.committed, conflicts::Side::Ours);
                        v.resolve_conflicts(resolved, w, cx);
                    })),
                )
                .child(
                    button(
                        "conflict-keep-theirs".into(),
                        t("editor.conflict.keepIncoming").into(),
                    )
                    .on_click(cx.listener(|v, _, w, cx| {
                        let resolved =
                            conflicts::resolve_all(&v.committed, conflicts::Side::Theirs);
                        v.resolve_conflicts(resolved, w, cx);
                    })),
                );
        }
        row = row.child(
            button(
                "conflict-toggle".into(),
                t(if self.conflicts_expanded {
                    "editor.conflict.hideBlocks"
                } else {
                    "editor.conflict.showBlocks"
                })
                .into(),
            )
            .on_click(cx.listener(|v, _, _, cx| {
                v.conflicts_expanded = !v.conflicts_expanded;
                cx.notify();
            })),
        );
        let mut banner = div()
            .flex_none()
            .mx(px(12.))
            .my(px(8.))
            .px(px(14.))
            .py(px(10.))
            .flex()
            .flex_col()
            .gap(px(10.))
            .border_1()
            .border_color(crate::theme::alpha(p.warning, 0.32))
            .rounded(px(8.))
            .bg(crate::theme::alpha(p.warning, 0.12))
            .text_color(p.text)
            .text_size(px(ty.ui.body))
            .child(row);
        if self.conflicts_expanded {
            let total = blocks.len();
            for (index, block) in blocks.iter().enumerate() {
                let side = |side: conflicts::Side,
                            label: &str,
                            content: &str,
                            cx: &mut Context<Self>| {
                    let mut title = div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .text_size(px(ty.ui.meta))
                        .text_color(p.muted)
                        .child(label.to_owned());
                    if !self.read_only {
                        title = title.child(
                            button(
                                ElementId::Name(format!("conflict-pick-{index}-{side:?}").into()),
                                t("editor.conflict.pick").into(),
                            )
                            .on_click(cx.listener(
                                move |v, _, w, cx| {
                                    let resolved =
                                        conflicts::resolve_one(&v.committed, index, side);
                                    v.resolve_conflicts(resolved, w, cx);
                                },
                            )),
                        );
                    }
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .child(title)
                        .child(
                            div()
                                .p(px(8.))
                                .rounded(px(5.))
                                .bg(p.inset)
                                .font_family("PuppyOne Geist Mono 400")
                                .text_size(px(ty.ui.meta))
                                .child(content.to_owned()),
                        )
                };
                let ours_label = if block.ours_label.is_empty() {
                    t("editor.conflict.current").to_owned()
                } else {
                    block.ours_label.clone()
                };
                let theirs_label = if block.theirs_label.is_empty() {
                    t("editor.conflict.incoming").to_owned()
                } else {
                    block.theirs_label.clone()
                };
                banner = banner.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .child(
                            div()
                                .text_size(px(ty.ui.meta))
                                .text_color(p.subtle)
                                .child(tf(
                                    "editor.conflict.blockPosition",
                                    &[
                                        ("index", ((index + 1) as i64).into()),
                                        ("total", (total as i64).into()),
                                        ("line", ((block.start + 1) as i64).into()),
                                    ],
                                )),
                        )
                        .child(
                            div()
                                .flex()
                                .gap(px(10.))
                                .child(side(conflicts::Side::Ours, &ours_label, &block.ours, cx))
                                .child(side(
                                    conflicts::Side::Theirs,
                                    &theirs_label,
                                    &block.theirs,
                                    cx,
                                )),
                        ),
                );
            }
        }
        Some(banner.into_any_element())
    }
    fn rebind(&mut self, name: &str, cx: &mut Context<Self>) {
        let format =
            crate::editor::registry::resolve(&crate::editor::registry::EditorDocument::local(name))
                .format;
        let language = Language::resolve(format.monaco_language.as_deref(), name);
        if self.language != language {
            self.language = language;
            self.field.update(cx, |s, cx| {
                s.set_highlighter(language.grammar().unwrap_or("puppyone-plaintext"), cx);
                s.set_tab_size(
                    TabSize {
                        tab_size: language.tab_size(),
                        hard_tabs: false,
                    },
                    cx,
                );
            });
        }
    }
    /// Another view's local edit (the HTML visual editor): applied through
    /// the input handler so it joins this editor's undo history.
    fn edit_utf16(
        &mut self,
        edits: &[(std::ops::Range<usize>, String)],
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.read_only || self.composing {
            return false;
        }
        self.field.update(cx, |s, cx| {
            for (range, text) in edits.iter().rev() {
                EntityInputHandler::replace_text_in_range(s, Some(range.clone()), text, window, cx);
            }
        });
        self.sync(window, cx);
        true
    }
    /// Undo or redo while another view (the HTML visual editor) is shown:
    /// the same history, without taking focus.
    fn replay(&mut self, redo: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only || self.composing {
            return;
        }
        self.field
            .update(cx, |s, cx| s.replay_undo(redo, window, cx));
        self.sync(window, cx);
    }
    fn history(&mut self, redo: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        self.finish_composition(window, cx);
        self.field.focus_handle(cx).focus(window, cx);
        let action: Box<dyn Action> = if redo {
            Box::new(gpui_kit::base::input::Redo)
        } else {
            Box::new(gpui_kit::base::input::Undo)
        };
        window.dispatch_action(action, cx);
    }
}

impl Render for CodeView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let view = cx.entity();
        let focus = self.field.focus_handle(cx);
        // The final handler preserves Kit's input geometry and adds the missing
        // composition-end notification (unmark itself emits no Kit event).
        let input = canvas(
            |_, _, _| (),
            move |bounds, _, w, cx| {
                w.handle_input(&focus, ElementInputHandler::new(bounds, view.clone()), cx);
            },
        )
        .absolute()
        .size_full();
        let banner = self.conflict_banner(cx);
        div()
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .children(banner)
            .child(
                Editor::new(&self.field)
                    .appearance(false)
                    .bordered(false)
                    .readonly(self.read_only)
                    .h_full()
                    .font_family("PuppyOne Geist Mono 400")
                    .text_size(px(self.scale.metrics().editor.code))
                    .line_height(px(20.)),
            )
            .child(input)
    }
}

pub fn open(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    Box::new(CodeSurface {
        view: cx.new(|cx| CodeView::new(request, window, cx)),
    })
}
struct CodeSurface {
    view: Entity<CodeView>,
}
impl ViewerSurface for CodeSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        Some(cx.subscribe(&self.view, move |_, e: &SurfaceEvent, cx| {
            events(e.clone(), cx)
        }))
    }
    fn text(&self, cx: &App) -> Option<String> {
        Some(self.view.read(cx).committed.clone())
    }
    fn composing(&self, cx: &App) -> bool {
        self.view.read(cx).composing
    }
    fn replace_text(&self, text: &str, window: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| v.replace(text, window, cx));
    }
    fn edit_utf16(
        &self,
        edits: &[(std::ops::Range<usize>, String)],
        window: &mut Window,
        cx: &mut App,
    ) -> bool {
        self.view
            .update(cx, |v, cx| v.edit_utf16(edits, window, cx))
    }
    fn rebind_name(&self, name: &str, cx: &mut App) {
        self.view.update(cx, |v, cx| v.rebind(name, cx));
    }
    fn undo(&self, redo: bool, window: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| v.history(redo, window, cx));
    }
    fn command(&self, name: &str, window: &mut Window, cx: &mut App) {
        match name {
            "undo" | "redo" => self.undo(name == "redo", window, cx),
            "replay-undo" | "replay-redo" => self
                .view
                .update(cx, |v, cx| v.replay(name == "replay-redo", window, cx)),
            _ => {}
        }
    }
    fn apply(&self, read_only: bool, dark: bool, scale: Scale, window: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| {
            if read_only {
                v.finish_composition(window, cx);
            }
            let changed = (v.read_only, v.dark, v.scale) != (read_only, dark, scale);
            v.read_only = read_only;
            v.field.update(cx, |s, cx| s.set_readonly(read_only, cx));
            if (v.dark, v.scale) != (dark, scale) {
                style::project(dark, scale, cx);
                v.field.update(cx, |s, _| {
                    s.set_gutter_metrics(Some(style::gutter(dark, scale)))
                });
            }
            v.dark = dark;
            v.scale = scale;
            if changed {
                cx.notify();
            }
        });
    }
    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        Some(self.view.read(cx).field.focus_handle(cx))
    }
    fn pane(&self, _: &App) -> PaneEntries {
        PaneEntries {
            find: true,
            ..Default::default()
        }
    }
    fn find(&self, event: FindEvent, window: &mut Window, cx: &mut App) -> Option<(usize, usize)> {
        self.view.update(cx, |v, cx| v.find(event, window, cx))
    }
    #[cfg(test)]
    fn code_editor(&self) -> Option<Entity<CodeView>> {
        Some(self.view.clone())
    }
}
