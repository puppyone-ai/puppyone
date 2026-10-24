//! Port of `settings/main/*` and the `SettingsView.tsx` page switch.
mod account_settings_view;
mod appearance_settings_view;
mod create_new_settings_view;
mod experimental_settings_view;
mod file_settings_views;
mod general_settings_view;
mod local_project_settings_view;
mod other_app_imports_settings_view;
mod privacy_settings_view;
mod repository_settings_views;
mod typography_settings_view;
use super::{
    components::*, settings_workspace_surface::SettingsWorkspaceSurface,
    sidebar::settings_sidebar_model::Page,
};
use crate::{localization::t as tr, theme::Theme};
use gpui::{prelude::*, *};
impl SettingsWorkspaceSurface {
    pub(in crate::features::settings) fn page_content(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let t = Theme::new(self.dark());
        match self.page {
            Page::General => self.general(t, cx),
            Page::Appearance => self.appearance(t, cx),
            Page::Typography => self.typography(t, cx),
            Page::CreateNew => self.create_new(t, cx),
            Page::OtherAppImports => self.other_app_imports(t),
            Page::Privacy => self.privacy(t),
            Page::Experimental => self.experimental(t, cx),
            Page::LocalAgents => {
                let dark = self.dark();
                self.agents.update(cx, |s, _| s.dark = dark);
                section(tr(Page::LocalAgents.title()), t).child(self.agents.clone())
            }
            Page::ModelConnections => {
                let dark = self.dark();
                self.models.update(cx, |s, _| s.dark = dark);
                // The connection flow owns its own title (list/detail/edit).
                div().w_full().child(self.models.clone())
            }
            Page::Project => self.local_project(t, window, cx),
            Page::Host => self.host_server(t, cx),
            Page::Git => self.git(t, cx),
            Page::Files => self.files(t, cx),
            Page::Account => self.account(t),
            Page::Plan => self.plan(t),
        }
    }
}
