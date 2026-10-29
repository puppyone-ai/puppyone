use super::CodeView;
use crate::{
    editor::{text::search::find_all, workbench::find::FindEvent},
    theme,
};
use gpui::{App, Context, Entity, Focusable, Window};
use gpui_kit::base::input::{
    EditorState, RangeDecoration, RangeDecorationCollection, RangeDecorationStyle, RopeExt,
};
use std::ops::Range;

pub(super) struct CodeFind {
    query: String,
    matches: Vec<Range<usize>>,
    current: Option<usize>,
    decorations: RangeDecorationCollection,
}
impl CodeFind {
    pub fn active(&self) -> bool {
        !self.query.is_empty()
    }
    pub fn new(field: &Entity<EditorState>, cx: &mut App) -> Self {
        Self {
            query: String::new(),
            matches: Vec::new(),
            current: None,
            decorations: field.update(cx, |s, cx| {
                s.create_range_decorations_collection(Vec::new(), cx)
            }),
        }
    }
    fn result(&self) -> (usize, usize) {
        (self.current.map_or(0, |i| i + 1), self.matches.len())
    }
}
impl CodeView {
    pub(super) fn refresh_find(&mut self, nearest: bool, cx: &mut Context<Self>) {
        self.find.matches = find_all(&self.committed, &self.find.query);
        self.find.current = if self.find.matches.is_empty() {
            None
        } else if nearest
            || self
                .find
                .current
                .is_none_or(|i| i >= self.find.matches.len())
        {
            let from = self.field.read(cx).selected_range().start;
            Some(
                self.find
                    .matches
                    .iter()
                    .position(|m| m.start >= from)
                    .unwrap_or(0),
            )
        } else {
            self.find.current
        };
        self.reveal_find(cx);
    }
    fn reveal_find(&mut self, cx: &mut Context<Self>) {
        let p = theme::Theme::new(self.dark);
        let mut marks: Vec<_> = self
            .find
            .matches
            .iter()
            .enumerate()
            .map(|(i, r)| {
                RangeDecoration::new(r.clone())
                    .with_style(RangeDecorationStyle::Fill)
                    .with_color(
                        theme::alpha(
                            p.warning,
                            if self.find.current == Some(i) {
                                0.58
                            } else {
                                0.34
                            },
                        )
                        .into(),
                    )
            })
            .collect();
        if let Some(r) = self
            .find
            .current
            .and_then(|i| self.find.matches.get(i))
            .cloned()
        {
            marks.push(
                RangeDecoration::new(r.clone())
                    .with_color(theme::mix(p.warning, p.text, 0.82).into()),
            );
            self.field.update(cx, |s, cx| {
                s.unfold_at(s.text().offset_to_position(r.start), cx);
                if s.selected_range() != r {
                    s.set_selected_range(r, cx);
                }
            });
        }
        self.find.decorations.set(marks, cx);
        let (current, total) = self.find.result();
        cx.emit(super::SurfaceEvent::FindResult { current, total });
    }
    pub(super) fn find(
        &mut self,
        event: FindEvent,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<(usize, usize)> {
        match event {
            FindEvent::Close => {
                self.find.query.clear();
                self.find.matches.clear();
                self.find.current = None;
                self.find.decorations.clear(cx);
                self.field.focus_handle(cx).focus(w, cx);
                return None;
            }
            FindEvent::Query(query) => {
                self.find.query = query;
                self.refresh_find(true, cx);
            }
            FindEvent::Move { forward } => {
                let n = self.find.matches.len();
                if let Some(i) = self.find.current {
                    self.find.current = Some((i + if forward { 1 } else { n - 1 }) % n);
                }
                self.reveal_find(cx);
            }
        }
        Some(self.find.result())
    }
}
