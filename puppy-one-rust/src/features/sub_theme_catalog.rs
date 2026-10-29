//! The Sub Theme catalog (`useSubThemeCatalog`, `createSubThemeCatalogSnapshot`
//! and `resolveSubTheme`): the built-in themes plus the Themes Folder,
//! refreshed at start-up, whenever a window becomes active and after the add
//! action creates a theme. Installed Application palettes are registered with `theme` so a
//! selection paints at once; an id that is missing, incompatible or lacks the
//! effective mode resolves to the Default interface's Neutral theme.
use crate::platform::themes::{
    contract::{Mode, Target},
    palette,
    service::{self, Diagnostic, Service, Theme},
};
use gpui::{Action, App, AppContext as _, Context, Entity, Global, Menu, MenuItem, actions};

actions!(themes, [OpenThemesFolder]);
/// Theme → Visual Variant → a theme (`theme.pack.<id>`).
#[derive(Clone, PartialEq, serde::Deserialize, Action)]
#[action(no_json)]
pub struct SelectSubTheme {
    pub id: String,
}

/// `getInterfaceStyleSubThemePolicy("default").allowedTargets`.
const REQUIRED_TARGETS: [Target; 3] = [Target::Application, Target::Markdown, Target::Csv];

#[derive(Default)]
pub struct Catalog {
    installed: Vec<Theme>,
    diagnostics: Vec<Diagnostic>,
    pub error: Option<String>,
    generation: u64,
}

struct Handle(Entity<Catalog>);
impl Global for Handle {}

fn service() -> Service {
    // Tests never touch the real Themes Folder.
    if cfg!(test) {
        Service::new(
            std::env::temp_dir().join(format!("puppyone-test-themes-{}", std::process::id())),
        )
    } else {
        Service::new(crate::platform::data_dir())
    }
}

pub fn init(cx: &mut App) {
    let catalog = cx.new(|_| Catalog::default());
    cx.set_global(Handle(catalog.clone()));
    catalog.update(cx, |c, cx| c.refresh(cx));
}

pub fn global(cx: &App) -> Option<Entity<Catalog>> {
    cx.try_global::<Handle>().map(|h| h.0.clone())
}

/// Theme → Open Themes Folder.
pub fn open_directory(cx: &mut App) {
    if let Some(catalog) = global(cx) {
        catalog.update(cx, |c, cx| c.open_directory(cx));
    }
}

thread_local! {
    /// What the menu bar's Theme menu shows: selectable themes, checked id.
    static MENU: std::cell::RefCell<(Vec<(String, String)>, String)> =
        std::cell::RefCell::new((Vec::new(), crate::theme::DEFAULT_PACK.to_owned()));
}
/// `useSubThemeNativeMenu`: record the effective mode's themes and checked
/// selection; returns whether the menu bar must be rebuilt.
pub fn sync_menu(requested: &str, dark: bool, cx: &App) -> bool {
    let state = match global(cx) {
        Some(catalog) => {
            let c = catalog.read(cx);
            (c.selectable(dark), c.effective(requested, dark))
        }
        None => {
            let c = Catalog::default();
            (c.selectable(dark), c.effective(requested, dark))
        }
    };
    MENU.with(|menu| {
        let changed = *menu.borrow() != state;
        *menu.borrow_mut() = state;
        changed
    })
}
/// `createThemeMenu`: Visual Variant (radio items), then Open Themes Folder.
pub fn theme_menu(label: impl Fn(&str) -> gpui::SharedString) -> Menu {
    let items = MENU.with(|menu| {
        let (themes, pack) = &*menu.borrow();
        themes
            .iter()
            .map(|(id, name)| {
                MenuItem::action(name.clone(), SelectSubTheme { id: id.clone() })
                    .checked(id == pack)
            })
            .collect()
    });
    Menu {
        name: label("native.menu.theme"),
        disabled: false,
        items: vec![
            MenuItem::submenu(Menu {
                name: label("native.menu.theme.pack"),
                disabled: false,
                items,
            }),
            MenuItem::separator(),
            MenuItem::action(label("native.menu.theme.openFolder"), OpenThemesFolder),
        ],
    }
}

/// Refresh the catalog if it is installed (window activation, Settings).
pub fn refresh(cx: &mut App) {
    if let Some(catalog) = global(cx) {
        catalog.update(cx, |c, cx| c.refresh(cx));
    }
}

/// The theme that paints for `requested` in this mode.
pub fn effective(requested: &str, dark: bool, cx: &App) -> String {
    match global(cx) {
        Some(catalog) => catalog.read(cx).effective(requested, dark),
        None => Catalog::default().effective(requested, dark),
    }
}

impl Catalog {
    /// `listThemes` off the main thread; a later refresh wins.
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        let generation = self.generation;
        let task = cx.background_spawn(async move {
            service().list().map(|snapshot| {
                let palettes = palettes(&snapshot.themes);
                (snapshot, palettes)
            })
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |c, cx| {
                if generation != c.generation {
                    return;
                }
                match result {
                    Ok((snapshot, palettes)) => c.install(snapshot, palettes),
                    Err(error) => c.error = Some(error),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    fn install(&mut self, snapshot: service::Snapshot, palettes: Vec<crate::theme::InstalledPack>) {
        crate::theme::set_installed(palettes);
        let mut diagnostics = snapshot.diagnostics;
        let mut installed = Vec::new();
        for theme in snapshot.themes {
            // `createSubThemeCatalogSnapshot`: built-in ids win.
            if crate::theme::pack_choices().any(|(id, _)| id == theme.id) {
                diagnostics.push(Diagnostic {
                    source: theme.name.clone(),
                    message: format!(
                        "Sub Theme id conflicts with a built-in variant: {}.",
                        theme.id
                    ),
                });
                continue;
            }
            installed.push(theme);
        }
        self.installed = installed;
        self.diagnostics = diagnostics;
        self.error = None;
    }
    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.diagnostics
    }
    /// `openDirectory`.
    pub fn open_directory(&mut self, cx: &mut Context<Self>) {
        let task = cx.background_spawn(async move {
            let root = service().ensure_root()?;
            crate::platform::desktop::open_directory(&root)
                .map_err(|e| format!("Unable to open the themes directory: {e}"))
        });
        cx.spawn(async move |this, cx| {
            if let Err(error) = task.await {
                this.update(cx, |c, cx| {
                    c.error = Some(error);
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }
    /// `createTheme`: write and reveal a starter theme, refresh, then hand
    /// its id to `select`.
    pub fn create(
        &mut self,
        select: impl FnOnce(String, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) {
        let task = cx.background_spawn(async move {
            let created = service().create()?;
            crate::platform::desktop::reveal(&created.path)
                .map_err(|e| format!("Unable to reveal the new theme: {e}"))?;
            let snapshot = service().list()?;
            let palettes = palettes(&snapshot.themes);
            Ok::<_, String>((created.theme_id, snapshot, palettes))
        });
        self.generation += 1;
        let generation = self.generation;
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |c, cx| match result {
                Ok((id, snapshot, palettes)) => {
                    if generation == c.generation {
                        c.install(snapshot, palettes);
                    }
                    cx.notify();
                    cx.defer(move |cx| select(id, cx));
                }
                Err(error) => {
                    c.error = Some(error);
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }
    /// `listSelectableSubThemes`: built-ins, then installed themes that
    /// support the mode and every Default-interface target.
    pub fn selectable(&self, dark: bool) -> Vec<(String, String)> {
        crate::theme::pack_choices()
            .map(|(id, name)| (id.to_owned(), name.to_owned()))
            .chain(
                self.installed
                    .iter()
                    .filter(|t| compatible(t, dark))
                    .map(|t| (t.id.clone(), t.name.clone())),
            )
            .collect()
    }
    /// Whether the catalog knows the id at all (a known but unselectable id
    /// is not offered as "missing").
    pub fn contains(&self, id: &str) -> bool {
        crate::theme::pack_choices().any(|(known, _)| known == id)
            || self.installed.iter().any(|t| t.id == id)
    }
    pub fn effective(&self, requested: &str, dark: bool) -> String {
        let known = crate::theme::pack_choices().any(|(id, _)| id == requested)
            || self
                .installed
                .iter()
                .any(|t| t.id == requested && compatible(t, dark));
        if known {
            requested.to_owned()
        } else {
            crate::theme::DEFAULT_PACK.to_owned()
        }
    }
    #[cfg(test)]
    fn with(themes: Vec<Theme>) -> Self {
        let palettes = palettes(&themes);
        let mut catalog = Self::default();
        catalog.install(
            service::Snapshot {
                themes,
                diagnostics: vec![],
            },
            palettes,
        );
        catalog
    }
}

/// `getSubThemeCompatibility(...) === "compatible"` for the Default root.
fn compatible(theme: &Theme, dark: bool) -> bool {
    theme
        .compatible_root_theme_ids
        .iter()
        .any(|id| id == "default")
        && theme
            .modes
            .contains(if dark { &Mode::Dark } else { &Mode::Light })
        && REQUIRED_TARGETS.iter().all(|t| theme.targets.contains(t))
}

fn palettes(themes: &[Theme]) -> Vec<crate::theme::InstalledPack> {
    themes
        .iter()
        .filter_map(|theme| {
            let [light, dark] = theme.application.as_ref()?;
            Some(crate::theme::InstalledPack {
                id: theme.id.clone(),
                name: theme.name.clone(),
                light: theme
                    .modes
                    .contains(&Mode::Light)
                    .then(|| palette::project(light, false)),
                dark: theme
                    .modes
                    .contains(&Mode::Dark)
                    .then(|| palette::project(dark, true)),
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "sub_theme_catalog_tests.rs"]
mod tests;
