//! GPUI projection of the font catalog (`typography::fonts`).
//!
//! A CSS `font-family` stack becomes the first family that loads as itself
//! plus a cascade list of the installed rest — the walk Chromium does — so
//! the terminal lands on SF Mono where it is installed and Menlo where it is
//! not, and Han text in a Japanese interface takes Hiragino rather than the
//! system language's face. Resolution probes the text system once per
//! (locale, selection) and is kept as the thread's active stacks; text
//! styles without an `App` read the cascade lists from there.
use crate::typography::fonts::{self, Category, Role, Selection};
use gpui::{App, Font, FontFallbacks, FontFeatures, FontStyle, FontWeight, SharedString};
use std::cell::RefCell;

/// The bundled faces' registered family names.
const BUNDLED_SANS: &str = "Geist";
/// GPUI's alias for the platform interface face (`system-ui`).
const SYSTEM_UI: &str = ".SystemUIFont";
/// The CSS `sans-serif` generic at the end of every sans stack (Chromium's
/// macOS default) for glyphs no listed face covers.
const GENERIC_SANS: &str = "Helvetica Neue";

/// A catalog family's GPUI name: bundled faces by their registered names,
/// the CSS system keywords as the platform interface face, and keywords GPUI
/// cannot address by name (`ui-monospace`, `ui-serif`) dropped.
fn gpui_family(css: &str) -> Option<&str> {
    match css {
        "Geist Sans" => Some(BUNDLED_SANS),
        "Geist Mono" => Some(crate::theme::MONO),
        "ui-sans-serif" | "system-ui" | "-apple-system" | "BlinkMacSystemFont" => Some(SYSTEM_UI),
        "ui-serif" | "ui-monospace" | "ui-rounded" => None,
        other => Some(other),
    }
}

/// Families that always load: registered at startup or aliased by GPUI.
fn always_available(family: &str) -> bool {
    family == BUNDLED_SANS || family == crate::theme::MONO || family == SYSTEM_UI
}

/// One resolved stack: the face that renders, and the cascade behind it.
#[derive(Clone, Debug, PartialEq)]
pub struct Stack {
    pub family: SharedString,
    pub fallbacks: Vec<String>,
}

/// Walk a CSS stack: the first family that loads becomes the face; every
/// later installed family joins the cascade list. `installed` answers for
/// families that are neither bundled nor aliased.
pub fn walk(css: &[&str], category: Category, installed: &mut dyn FnMut(&str) -> bool) -> Stack {
    let mut family: Option<SharedString> = None;
    let mut fallbacks = Vec::new();
    for name in css.iter().filter_map(|css| gpui_family(css)) {
        let present = always_available(name) || installed(name);
        if !present {
            continue;
        }
        match &family {
            None => family = Some(SharedString::from(name.to_owned())),
            // The interface alias is not a family name CoreText can match in
            // a cascade descriptor; a repeated family adds nothing.
            Some(face)
                if name != SYSTEM_UI
                    && face.as_ref() != name
                    && !fallbacks.iter().any(|f| f == name) =>
            {
                fallbacks.push(name.to_owned())
            }
            Some(_) => {}
        }
    }
    if category == Category::Sans && !fallbacks.iter().any(|f| f == GENERIC_SANS) {
        fallbacks.push(GENERIC_SANS.to_owned());
    }
    Stack {
        family: family.unwrap_or_else(|| match category {
            Category::Monospace => SharedString::from(crate::theme::MONO),
            _ => SharedString::from(SYSTEM_UI),
        }),
        fallbacks,
    }
}

#[derive(Clone)]
struct Active {
    locale: String,
    selection: Selection,
    ui: Stack,
    content: Stack,
    code: Stack,
    terminal: Stack,
    /// `--po-font-locale-*` cascades for text that names its own face.
    sans: Vec<String>,
    serif: Vec<String>,
    mono: Vec<String>,
}

thread_local! {
    static ACTIVE: RefCell<Option<Active>> = const { RefCell::new(None) };
}

fn selection(cx: &App) -> Selection {
    cx.try_global::<super::appearance::Appearance>()
        .map(|a| a.fonts.clone())
        .unwrap_or_default()
}

/// A family no system has: where GPUI's silent substitution lands.
const MISSING: &str = "PuppyOne Missing Family Probe";

/// Whether `family` loads as itself rather than through GPUI's fallback
/// stack, which substitutes silently.
fn loads(cx: &App, family: &str) -> bool {
    let text = cx.text_system();
    let substitute = text.resolve_font(&gpui::font(MISSING));
    text.resolve_font(&gpui::font(SharedString::from(family.to_owned()))) != substitute
}

fn resolve(locale: &str, selection: &Selection, cx: &App) -> Active {
    let mut probed: Vec<(String, bool)> = Vec::new();
    let mut installed = |family: &str| {
        if let Some((_, present)) = probed.iter().find(|(f, _)| f == family) {
            return *present;
        }
        let present = loads(cx, family);
        probed.push((family.to_owned(), present));
        present
    };
    let resolved = fonts::resolve(selection);
    let mut role =
        |entry: &fonts::Entry| walk(&fonts::stack(entry, locale), entry.category, &mut installed);
    let (ui, content, code, terminal) = (
        role(resolved.ui),
        role(resolved.content),
        role(resolved.code),
        role(resolved.terminal),
    );
    let mut cascade = |category: Category| {
        let css: Vec<&str> = fonts::locale_stack(locale, category)
            .iter()
            .chain(fonts::EMOJI.iter())
            .copied()
            .collect();
        let stack = walk(&css, category, &mut installed);
        // Every installed family of the stack, the face included.
        std::iter::once(stack.family.to_string())
            .filter(|f| f != SYSTEM_UI && !always_available(f))
            .chain(stack.fallbacks)
            .collect::<Vec<_>>()
    };
    let (sans, serif, mono) = (
        cascade(Category::Sans),
        cascade(Category::Serif),
        cascade(Category::Monospace),
    );
    Active {
        locale: locale.to_owned(),
        selection: selection.clone(),
        ui,
        content,
        code,
        terminal,
        sans,
        serif,
        mono,
    }
}

/// Resolve the active stacks for the current locale and font selection when
/// either changed. `Appearance::apply` and every `font` call land here.
pub fn install(cx: &App) {
    let locale = crate::localization::current_code();
    let selection = selection(cx);
    let current = ACTIVE.with_borrow(|a| {
        a.as_ref()
            .is_some_and(|a| a.locale == locale && a.selection == selection)
    });
    if !current {
        let active = resolve(&locale, &selection, cx);
        ACTIVE.with_borrow_mut(|a| *a = Some(active));
    }
}

/// The resolved stack of a role.
pub fn stack(role: Role, cx: &App) -> Stack {
    install(cx);
    ACTIVE.with_borrow(|a| {
        let a = a.as_ref().expect("installed above");
        match role {
            Role::Ui => a.ui.clone(),
            Role::Content => a.content.clone(),
            Role::Code => a.code.clone(),
            Role::Terminal => a.terminal.clone(),
        }
    })
}

/// The role's font at the regular weight.
pub fn font(role: Role, cx: &App) -> Font {
    let stack = stack(role, cx);
    Font {
        family: stack.family,
        features: FontFeatures::default(),
        fallbacks: Some(FontFallbacks::from_fonts(stack.fallbacks)),
        weight: FontWeight::NORMAL,
        style: FontStyle::Normal,
    }
}

/// The locale's script cascade for text that names its own face (the
/// editor's weight-specific Geist builds). Before the first install it is
/// the default locale's unprobed bundled order.
pub fn fallbacks(category: Category) -> FontFallbacks {
    let names = ACTIVE.with_borrow(|a| {
        a.as_ref().map(|a| match category {
            Category::Sans => a.sans.clone(),
            Category::Serif => a.serif.clone(),
            Category::Monospace => a.mono.clone(),
        })
    });
    FontFallbacks::from_fonts(names.unwrap_or_else(|| {
        fonts::EMOJI
            .iter()
            .map(|s| s.to_string())
            .chain((category == Category::Sans).then(|| GENERIC_SANS.to_owned()))
            .collect()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn with<'a>(installed: &'a [&'a str]) -> impl FnMut(&str) -> bool + 'a {
        move |family| installed.contains(&family)
    }

    #[test]
    fn the_terminal_takes_the_first_installed_system_mono() {
        let entry = fonts::resolve(&Selection::default()).terminal;
        let css = fonts::stack(entry, "en");
        // Without SF Mono (Electron lands on Menlo too).
        let stack = walk(
            &css,
            Category::Monospace,
            &mut with(&["Menlo", "Monaco", "Apple Color Emoji"]),
        );
        assert_eq!(stack.family.as_ref(), "Menlo");
        assert_eq!(stack.fallbacks, ["Monaco", "Apple Color Emoji"]);
        let stack = walk(&css, Category::Monospace, &mut with(&["SF Mono", "Menlo"]));
        assert_eq!(stack.family.as_ref(), "SF Mono");
        assert_eq!(stack.fallbacks, ["Menlo"]);
        // Nothing installed: the bundled mono still renders.
        let stack = walk(&css, Category::Monospace, &mut with(&[]));
        assert_eq!(stack.family.as_ref(), crate::theme::MONO);
    }

    #[test]
    fn code_is_bundled_geist_mono_over_the_locale_script_faces() {
        let entry = fonts::resolve(&Selection::default()).code;
        let installed = ["PingFang SC", "Hiragino Sans", "Apple Color Emoji", "Menlo"];
        let zh = walk(
            &fonts::stack(entry, "zh-Hans"),
            Category::Monospace,
            &mut with(&installed),
        );
        assert_eq!(zh.family.as_ref(), crate::theme::MONO);
        assert_eq!(zh.fallbacks, ["PingFang SC", "Apple Color Emoji"]);
        let ja = walk(
            &fonts::stack(entry, "ja"),
            Category::Monospace,
            &mut with(&installed),
        );
        assert_eq!(ja.fallbacks, ["Hiragino Sans", "Apple Color Emoji"]);
        let en = walk(
            &fonts::stack(entry, "en"),
            Category::Monospace,
            &mut with(&installed),
        );
        assert_eq!(en.fallbacks, ["Menlo", "Apple Color Emoji"]);
    }

    #[test]
    fn the_interface_is_geist_and_system_keywords_never_enter_the_cascade() {
        let entry = fonts::resolve(&Selection::default()).ui;
        let en = walk(
            &fonts::stack(entry, "en"),
            Category::Sans,
            &mut with(&["Apple Color Emoji"]),
        );
        assert_eq!(en.family.as_ref(), "Geist");
        assert_eq!(en.fallbacks, ["Apple Color Emoji", GENERIC_SANS]);
        let system = fonts::CATALOG
            .iter()
            .find(|e| e.id == fonts::ids::SYSTEM_SANS)
            .unwrap();
        let stack = walk(
            &fonts::stack(system, "ko"),
            Category::Sans,
            &mut with(&["Apple SD Gothic Neo"]),
        );
        assert_eq!(stack.family.as_ref(), SYSTEM_UI);
        assert_eq!(stack.fallbacks, ["Apple SD Gothic Neo", GENERIC_SANS]);
    }

    #[gpui::test]
    fn the_active_stacks_follow_the_locale_and_selection(cx: &mut gpui::TestAppContext) {
        // The test text system resolves every family to one face, so only
        // bundled faces count as installed here.
        let locale = || ACTIVE.with_borrow(|a| a.as_ref().map(|a| a.locale.clone()));
        cx.update(|cx| {
            crate::localization::set_current("ja");
            assert_eq!(font(Role::Code, cx).family.as_ref(), crate::theme::MONO);
            assert_eq!(locale().as_deref(), Some("ja"));
            crate::localization::set_current("zh-Hans");
            assert_eq!(font(Role::Ui, cx).family.as_ref(), BUNDLED_SANS);
            assert_eq!(locale().as_deref(), Some("zh-Hans"));
            // The terminal stack has no bundled face: the bundled mono
            // renders when nothing listed is installed.
            assert_eq!(font(Role::Terminal, cx).family.as_ref(), crate::theme::MONO);
            let system = crate::typography::fonts::Selection {
                content_font: crate::typography::fonts::ContentFont::Explicit {
                    font_id: crate::typography::fonts::ids::SYSTEM_SANS.into(),
                },
                ..Default::default()
            };
            super::super::appearance::Appearance::default()
                .with_fonts(system.clone())
                .apply(None, cx);
            assert_eq!(
                ACTIVE.with_borrow(|a| a.as_ref().map(|a| a.selection.clone())),
                Some(system)
            );
            crate::localization::set_current("en");
            super::super::appearance::Appearance::default().apply(None, cx);
        });
    }
}
