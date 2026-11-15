//! Grid cell rendering (`OnboardingProjectList` in `[data-project-layout="grid"]`).
use super::{
    super::{
        display::{item_caption, item_name, modification_time, parent_for_display},
        folder::ProjectFolderGlyph,
    },
    *,
};

/// How long ago a project changed, when it is known.
pub(super) fn modified_ago(item: &Item) -> Option<String> {
    item.modified.filter(|m| *m > 0).map(|ms| {
        modification_time(
            UNIX_EPOCH + Duration::from_millis(ms as u64),
            SystemTime::now(),
        )
    })
}

impl Homepage {
    /// One project on the Grid: a `104×78` folder (a printed sheet for each
    /// root file), its name (`body`) and one caption (`meta`). The group heading
    /// already says where the project lives, so the caption only says when it
    /// changed; another computer's folder says what it allows there, and an
    /// unavailable folder why. The full place is in the tooltip.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::app::home) fn project_tile(
        &self,
        index: usize,
        item: &Item,
        focus: FocusHandle,
        cell_w: f32,
        lit: bool,
        is_stop: bool,
        busy: bool,
        keys: impl Fn(&KeyDownEvent, &mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let name = item_name(item);
        let place = match &item.local_path {
            Some(path) => path_for_display(Path::new(path)),
            None => item_caption(item),
        };
        let modified = modified_ago(item);
        let caption = if item.remote.is_some() {
            Some(item_caption(item))
        } else {
            modified.clone().or_else(|| {
                item.local_path.as_deref().map(|path| {
                    super::super::compact_display_path(&parent_for_display(Path::new(path)), 1)
                })
            })
        };
        let linked = item.linked.is_some();
        let cut = name.chars().count() as f32 * ty.body * 0.56
            > (cell_w - 12. - if linked { 16. } else { 0. }).max(0.);
        let shared = self
            .item_shared(item)
            .then(|| tr("hosts.home.shared").to_owned());
        let agents = Some(
            self.item_cloud_agents(item)
                .iter()
                .map(|agent| agent.name.as_str())
                .collect::<Vec<_>>()
                .join(", "),
        );
        let tooltip = [
            cut.then(|| name.clone()),
            Some(place),
            shared,
            agents,
            modified,
        ]
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
            .pt(px(10.))
            .pb(px(8.))
            .px(px(6.))
            .rounded(px(metric::CARD_RADIUS))
            .text_color(t.text)
            .when(lit && !busy, |d| d.bg(t.hover))
            .when(busy, |d| d.opacity(0.58))
            .when(self.dragging_item(item, cx), |d| d.opacity(0.62))
            .tooltip(crate::ui::components::tooltip(tooltip))
            .child(
                div().mb(px(8.)).child(
                    ProjectFolderGlyph::grid(self.item_previews(item))
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
                            .text_size(px(ty.body))
                            .line_height(px(18.))
                            .child(name),
                    )
                    .when(linked, |d| d.child(super::row::linked_mark(t))),
            )
            .children(
                status
                    .map(|key| (tr(key).to_owned(), t.muted))
                    .or(caption.map(|caption| (caption, t.subtle)))
                    .map(|(text, color)| {
                        div()
                            .when_some(fade, |d, fade| d.opacity(fade))
                            .max_w_full()
                            .truncate()
                            .text_size(px(ty.meta))
                            .line_height(px(16.))
                            .text_color(color)
                            .child(text)
                    }),
            );
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
