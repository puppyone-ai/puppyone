//! Grid cell rendering (`OnboardingProjectList` in `[data-project-layout="grid"]`).
use super::{
    super::{
        display::{item_caption, item_name, modification_time, parent_for_display},
        folder::ProjectFolderGlyph,
    },
    row::place_mark,
    *,
};

impl Homepage {
    /// One project on the Grid: a `104×78` folder (with asset preview sheets
    /// and Cloud Agent badges), its `13px` name, and its `12px` caption meta
    /// (`compactDisplayPath(place, 1) · modified`) or unavailable status.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::app::home) fn project_tile(
        &self,
        index: usize,
        item: &Item,
        focus: FocusHandle,
        cell_w: f32,
        lit: bool,
        is_stop: bool,
        marks: bool,
        busy: bool,
        keys: impl Fn(&KeyDownEvent, &mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let name = item_name(item);
        let place = match &item.local_path {
            Some(path) => parent_for_display(Path::new(path)),
            None => item_caption(item),
        };
        let tile_place = if item.local_path.is_some() {
            super::super::compact_display_path(&place, 1)
        } else {
            place.clone()
        };
        let modified = item.modified.filter(|m| *m > 0).map(|ms| {
            modification_time(
                UNIX_EPOCH + Duration::from_millis(ms as u64),
                SystemTime::now(),
            )
        });
        let meta = [Some(tile_place), modified.clone()]
            .into_iter()
            .flatten()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
        let linked = item.linked.is_some();
        let cut = name.chars().count() as f32 * ty.meta * 0.56
            > (cell_w - 12. - if marks { 16. } else { 0. }).max(0.);
        let shared = self
            .item_shared(item)
            .then(|| tr("hosts.home.shared").to_owned());
        let tooltip = [cut.then(|| name.clone()), Some(place), shared, modified]
            .into_iter()
            .flatten()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
        let fade = item
            .remote
            .as_ref()
            .is_some_and(|r| !r.available())
            .then_some(0.5);
        let status = item
            .local_path
            .as_deref()
            .and_then(|path| self.folder_status(Path::new(path)))
            .map(super::super::folder_status::status_caption);
        let tile = self
            .open_control(("home-tile", index), item, focus, busy, keys, cx)
            .w_full()
            .min_w_0()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(2.))
            .py(px(10.))
            .px(px(6.))
            .rounded(px(metric::CARD_RADIUS))
            .text_color(t.text)
            .when(lit && !busy, |d| d.bg(t.hover))
            .when(busy, |d| d.opacity(0.58))
            .when(self.dragging_item(item, cx), |d| d.opacity(0.62))
            .tooltip(crate::ui::components::tooltip(tooltip))
            .child(
                div().mb(px(6.)).child(
                    ProjectFolderGlyph::grid(
                        self.item_previews(item),
                        self.item_cloud_agents(item),
                    )
                    .lit(lit)
                    .fade(fade.or(status.map(|_| 0.4))),
                ),
            )
            .child(
                h_flex()
                    .when_some(fade, |d, fade| d.opacity(fade))
                    .max_w_full()
                    .min_w_0()
                    .items_center()
                    .justify_center()
                    .gap(px(4.))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_size(px(ty.meta))
                            .font_weight(FontWeight::NORMAL)
                            .line_height(px(18.))
                            .text_color(if linked && !lit { t.subtle } else { t.text })
                            .child(name),
                    )
                    .when(marks, |d| d.child(place_mark(item, t))),
            )
            .children(status.map(|key| {
                div()
                    .max_w_full()
                    .truncate()
                    .text_size(px(ty.caption))
                    .line_height(px(16.))
                    .text_color(t.muted)
                    .child(tr(key))
            }))
            .when(status.is_none() && !meta.is_empty(), |d| {
                d.child(
                    div()
                        .when_some(fade, |d, fade| d.opacity(fade))
                        .max_w_full()
                        .truncate()
                        .text_size(px(ty.caption))
                        .line_height(px(16.))
                        .text_color(t.subtle)
                        .child(meta),
                )
            });
        let actions = self.project_actions_trigger(index, item, is_stop, busy, cx);
        let cloud_link = item
            .linked
            .clone()
            .map(|linked| self.linked_cloud_button(index, linked, true, is_stop, busy, cx));
        div()
            .relative()
            .min_w_0()
            .child(tile)
            .children(cloud_link.map(|link| {
                div()
                    .absolute()
                    .top(px(4.))
                    .left(px(4.))
                    .when(!lit, |d| d.invisible())
                    .child(link)
            }))
            .children(actions.map(|actions| {
                div()
                    .absolute()
                    .top(px(4.))
                    .right(px(4.))
                    .when(!lit, |d| d.invisible())
                    .child(actions)
            }))
            .into_any_element()
    }
}
