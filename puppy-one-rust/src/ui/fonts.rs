//! GPUI projection of the font catalog (`typography::fonts`).
//!
//! A CSS `font-family` stack becomes the first family that loads as itself
//! plus a cascade list of the installed rest — the walk Chromium does — so
//! the terminal lands on SF Mono where it is installed and Menlo where it is
//! not, and Han text in a Japanese interface takes Hiragino rather than the
//! system language's face. Resolution probes the text system once per
//! (locale, selection) and is kept as the thread's active stacks; text
//! styles without an `App` read the cascade lists from there.
//!
//! Text inside a content boundary with its own language (a Markdown
//! document's `lang`) takes that language's script cascade instead
//! (`:lang(...)` in typography/locales.css): see
//! [`with_content_language`].
use crate::typography::fonts::{self, Category, Role, Selection};
use gpui::{App, Font, FontFallbacks, FontFeatures, FontStyle, FontWeight, SharedString};
use std::{
    cell::RefCell,
    sync::atomic::{AtomicU64, Ordering},
};

/// GPUI's alias for the platform interface face (`system-ui`).
const SYSTEM_UI: &str = ".SystemUIFont";
/// The CSS `sans-serif` generic at the end of every sans stack (Chromium's
/// macOS default) for glyphs no listed face covers.
const GENERIC_SANS: &str = "Helvetica Neue";

/// The system families `ui-monospace` and `ui-serif` name where GPUI can
/// load them (macOS's SF Mono and New York).
const UI_MONOSPACE: Option<&str> =
    crate::platform::conventions::Conventions::current().ui_monospace_font;
const UI_SERIF: Option<&str> = crate::platform::conventions::Conventions::current().ui_serif_font;

/// A catalog family's GPUI name: the CSS system keywords as the platform's
/// own faces, and keywords a platform has no face for dropped.
fn gpui_family(css: &str) -> Option<&str> {
    match css {
        "ui-sans-serif" | "system-ui" | "-apple-system" | "BlinkMacSystemFont" => Some(SYSTEM_UI),
        "ui-monospace" => UI_MONOSPACE,
        "ui-serif" => UI_SERIF,
        "ui-rounded" => None,
        other => Some(other),
    }
}

/// Families that always load: GPUI's interface alias and the system
/// keyword faces.
fn always_available(family: &str) -> bool {
    family == SYSTEM_UI || Some(family) == UI_MONOSPACE || Some(family) == UI_SERIF
}

/// The advance of "0" per em of the face drawing `category` text at
/// `weight` (CSS `ch`): measured from the running font on the first
/// [`install`], else `fonts.json`'s fallback.
pub fn zero_advance(category: Category, weight: f32) -> f32 {
    let faces = crate::platform::fonts::faces();
    let (index, face) = match category {
        Category::Sans => (0, &faces.sans),
        Category::Serif => (1, &faces.serif),
        Category::Monospace => (2, &faces.mono),
    };
    MEASURED
        .get()
        .and_then(|measured| measured[index].get(&(weight.round() as u16)).copied())
        .unwrap_or_else(|| face.zero_advance(weight))
}

/// [`zero_advance`] per face (sans, serif, mono) and weight, measured once.
static MEASURED: std::sync::OnceLock<[std::collections::BTreeMap<u16, f32>; 3]> =
    std::sync::OnceLock::new();

/// The weights the editor's static faces draw with (`face_weight`).
const MEASURED_WEIGHTS: [u16; 4] = [400, 500, 600, 700];

/// Measure "0" in the configured faces, to the thousandth of an em; a
/// synthetic test text system (which resolves every family to one dummy face)
/// or any result outside a real text face's range is dropped.
fn measure(cx: &App) {
    let faces = crate::platform::fonts::faces();
    let text = cx.text_system();
    let missing = text.resolve_font(&gpui::font(MISSING));
    if text.resolve_font(&gpui::font(faces.sans.family)) == missing
        && text.resolve_font(&gpui::font(faces.mono.family)) == missing
    {
        return;
    }
    MEASURED.get_or_init(|| {
        [faces.sans.family, faces.serif.family, faces.mono.family].map(|family| {
            MEASURED_WEIGHTS
                .iter()
                .filter_map(|&weight| {
                    let mut font = gpui::font(family);
                    font.weight = FontWeight(weight as f32);
                    let id = text.resolve_font(&font);
                    let width = f32::from(text.advance(id, gpui::px(1000.), '0').ok()?.width);
                    let em = width.round() / 1000.;
                    (0.3..=1.0).contains(&em).then_some((weight, em))
                })
                .collect()
        })
    });
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
    if category == Category::Sans {
        let conventions = crate::platform::conventions::Conventions::current();
        if conventions.append_ui_font_fallbacks {
            for os_fallback in conventions.ui_font_fallbacks {
                if !fallbacks.iter().any(|f| f == os_fallback) && installed(os_fallback) {
                    fallbacks.push((*os_fallback).to_owned());
                }
            }
        }
        if !fallbacks.iter().any(|f| f == GENERIC_SANS) {
            fallbacks.push(GENERIC_SANS.to_owned());
        }
    }
    Stack {
        family: family.unwrap_or_else(|| match category {
            Category::Monospace => SharedString::from(crate::theme::mono()),
            _ => SharedString::from(SYSTEM_UI),
        }),
        fallbacks,
    }
}

/// `--po-font-locale-*` cascades for text that names its own face.
#[derive(Clone, Debug, Default, PartialEq)]
struct Cascades {
    sans: Vec<String>,
    serif: Vec<String>,
    mono: Vec<String>,
}

impl Cascades {
    fn of(&self, category: Category) -> &[String] {
        match category {
            Category::Sans => &self.sans,
            Category::Serif => &self.serif,
            Category::Monospace => &self.mono,
        }
    }
}

/// The languages with a script cascade of their own (`:lang(zh-Hans)`,
/// `:lang(zh-Hant)`, `:lang(ja)`, `:lang(ko)`); every other content language
/// takes the generic one, keyed `und`.
const CONTENT_LANGUAGES: [&str; 4] = ["zh-Hans", "zh-Hant", "ja", "ko"];
const GENERIC: &str = "und";

/// The cascade key of content language `language`.
fn content_key(language: &str) -> &'static str {
    CONTENT_LANGUAGES
        .into_iter()
        .find(|key| {
            fonts::locale_stack(language, Category::Sans)
                == fonts::locale_stack(key, Category::Sans)
        })
        .unwrap_or(GENERIC)
}

/// The normalized script cascade bucket for an explicit content language
/// (`None` means the interface's own cascade).
pub fn content_language_key(language: Option<&str>) -> Option<&'static str> {
    language.map(content_key)
}

/// Monotonic generation bumped whenever the active font stacks change (locale
/// or font preference change), so shaping/measurement caches invalidate cleanly.
static ACTIVE_GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn generation() -> u64 {
    ACTIVE_GENERATION.load(Ordering::Acquire)
}

#[derive(Clone)]
struct Active {
    locale: String,
    selection: Selection,
    ui: Stack,
    content: Stack,
    code: Stack,
    terminal: Stack,
    /// The interface language's cascades.
    cascades: Cascades,
    /// Each content language's, by [`content_key`].
    languages: Vec<(&'static str, Cascades)>,
}

thread_local! {
    static ACTIVE: RefCell<Option<Active>> = const { RefCell::new(None) };
    /// The language of the content being built or painted, if it names one.
    static CONTENT: RefCell<Option<SharedString>> = const { RefCell::new(None) };
}

/// Build or paint text inside a content boundary of `language` (`None`:
/// the interface's): [`fallbacks`] answer with that language's cascade.
pub fn with_content_language<R>(language: Option<&SharedString>, f: impl FnOnce() -> R) -> R {
    let previous = CONTENT.with_borrow_mut(|c| std::mem::replace(c, language.cloned()));
    let result = f();
    CONTENT.with_borrow_mut(|c| *c = previous);
    result
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
    resolve_with(locale, selection, &mut installed)
}

/// [`resolve`] with `installed` answering for families that are neither
/// bundled nor aliased.
fn resolve_with(
    locale: &str,
    selection: &Selection,
    mut installed: &mut dyn FnMut(&str) -> bool,
) -> Active {
    let resolved = fonts::resolve(selection);
    let mut role =
        |entry: &fonts::Entry| walk(&fonts::stack(entry, locale), entry.category, &mut installed);
    let (ui, content, code, terminal) = (
        role(resolved.ui),
        role(resolved.content),
        role(resolved.code),
        role(resolved.terminal),
    );
    let mut cascades = |locale: &str| {
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
        Cascades {
            sans: cascade(Category::Sans),
            serif: cascade(Category::Serif),
            mono: cascade(Category::Monospace),
        }
    };
    let interface = cascades(locale);
    let mut languages: Vec<_> = CONTENT_LANGUAGES
        .into_iter()
        .map(|key| (key, cascades(key)))
        .collect();
    languages.push((GENERIC, cascades("en")));
    Active {
        locale: locale.to_owned(),
        selection: selection.clone(),
        ui,
        content,
        code,
        terminal,
        cascades: interface,
        languages,
    }
}

/// Resolve the active stacks for the current locale and font selection when
/// either changed. `Appearance::apply` and every `font` call land here.
pub fn install(cx: &App) {
    measure(cx);
    let locale = crate::localization::current_code();
    let selection = selection(cx);
    let current = ACTIVE.with_borrow(|a| {
        a.as_ref()
            .is_some_and(|a| a.locale == locale && a.selection == selection)
    });
    if !current {
        let active = resolve(&locale, &selection, cx);
        ACTIVE.with_borrow_mut(|a| *a = Some(active));
        ACTIVE_GENERATION.fetch_add(1, Ordering::AcqRel);
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

/// The script cascade for text that names its own face under an explicit
/// content `language` (`None`: the interface's own cascade). Prefer this over
/// [`fallbacks`] so callers carry language explicitly instead of relying on
/// ambient thread-local state.
pub fn fallbacks_for(category: Category, language: Option<&str>) -> FontFallbacks {
    #[cfg(any(test, feature = "test-support"))]
    test_support::record_language(language);
    let content = language.map(content_key);
    let names = ACTIVE.with_borrow(|a| {
        a.as_ref().map(|a| {
            content
                .and_then(|key| a.languages.iter().find(|(k, _)| *k == key))
                .map_or(&a.cascades, |(_, c)| c)
                .of(category)
                .to_vec()
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

/// The locale's script cascade for text that names its own face (the
/// editor's text styles): the content language's inside
/// [`with_content_language`], else the interface's. Before the first
/// install it is the default locale's unprobed order.
pub fn fallbacks(category: Category) -> FontFallbacks {
    CONTENT.with_borrow(|c| fallbacks_for(category, c.as_deref()))
}

/// Tests: under which content languages text asked for its cascade.
#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    use super::*;

    thread_local! {
        static ASKED: RefCell<Vec<Option<SharedString>>> = const { RefCell::new(Vec::new()) };
    }

    pub(super) fn record_language(language: Option<&str>) {
        let language = language.map(|l| SharedString::from(l.to_owned()));
        ASKED.with_borrow_mut(|asked| {
            if !asked.contains(&language) {
                asked.push(language);
            }
        });
    }

    /// The distinct content languages asked under since the last call
    /// (`None`: the interface's).
    pub fn take_asked() -> Vec<Option<SharedString>> {
        ASKED.with_borrow_mut(std::mem::take)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn with<'a>(installed: &'a [&'a str]) -> impl FnMut(&str) -> bool + 'a {
        move |family| installed.contains(&family)
    }

    /// `markdownContentLanguage.test.ts` #0 and #2 through
    /// `typography/locales.css`: text inside a content boundary takes its
    /// language's script cascade (`:lang(...)`), whatever the interface's;
    /// a language without one takes the generic cascade, and outside the
    /// boundary the interface's applies again.
    #[test]
    fn content_text_takes_its_languages_script_cascade() {
        let installed = [
            "PingFang SC",
            "PingFang TC",
            "Hiragino Sans",
            "Apple SD Gothic Neo",
            "Apple Color Emoji",
        ];
        let active = resolve_with("en", &Selection::default(), &mut with(&installed));
        ACTIVE.with_borrow_mut(|a| *a = Some(active));
        let first = |category| fallbacks(category).fallback_list().first().cloned();
        let within = |language: &str| {
            with_content_language(Some(&SharedString::from(language.to_owned())), || {
                first(Category::Sans)
            })
        };
        let interface = first(Category::Sans);
        assert_ne!(interface.as_deref(), Some("PingFang TC"));
        assert_eq!(within("zh-Hant").as_deref(), Some("PingFang TC"));
        assert_eq!(within("zh-Hans").as_deref(), Some("PingFang SC"));
        assert_eq!(within("ja").as_deref(), Some("Hiragino Sans"));
        assert_eq!(within("ko").as_deref(), Some("Apple SD Gothic Neo"));
        assert_eq!(within("en-US"), interface, "the generic cascade");
        // The code font's cascade follows the language too.
        assert_eq!(
            with_content_language(Some(&"zh-Hant".into()), || first(Category::Monospace))
                .as_deref(),
            Some("PingFang TC")
        );
        // Boundaries nest and restore.
        with_content_language(Some(&"ja".into()), || {
            assert_eq!(within("zh-Hant").as_deref(), Some("PingFang TC"));
            assert_eq!(first(Category::Sans).as_deref(), Some("Hiragino Sans"));
        });
        assert_eq!(first(Category::Sans), interface);
        // A Chinese interface's own cascade outside any boundary.
        let active = resolve_with("zh-Hant", &Selection::default(), &mut with(&installed));
        ACTIVE.with_borrow_mut(|a| *a = Some(active));
        assert_eq!(first(Category::Sans).as_deref(), Some("PingFang TC"));
        assert_eq!(within("zh-Hans").as_deref(), Some("PingFang SC"));
        ACTIVE.with_borrow_mut(|a| *a = None);
    }

    #[test]
    fn fallbacks_for_uses_explicit_language_and_ignores_ambient_scope() {
        let installed = [
            "PingFang SC",
            "PingFang TC",
            "Hiragino Sans",
            "Apple SD Gothic Neo",
            "Apple Color Emoji",
        ];
        let active = resolve_with("en", &Selection::default(), &mut with(&installed));
        ACTIVE.with_borrow_mut(|a| *a = Some(active));

        assert_eq!(content_language_key(None), None);
        assert_eq!(content_language_key(Some("en-US")), Some("und"));
        assert_eq!(content_language_key(Some("zh-Hans")), Some("zh-Hans"));
        assert_eq!(content_language_key(Some("zh-Hant")), Some("zh-Hant"));
        assert_eq!(content_language_key(Some("ja")), Some("ja"));
        assert_eq!(content_language_key(Some("ko-KR")), Some("ko"));

        let first_for = |category, lang| {
            fallbacks_for(category, lang)
                .fallback_list()
                .first()
                .cloned()
        };
        let interface = first_for(Category::Sans, None);
        assert_ne!(interface.as_deref(), Some("PingFang SC"));

        // Explicit language overrides any ambient thread-local content language.
        with_content_language(Some(&"ja".into()), || {
            assert_eq!(
                first_for(Category::Sans, Some("zh-Hans")).as_deref(),
                Some("PingFang SC")
            );
            assert_eq!(
                first_for(Category::Monospace, Some("zh-Hant")).as_deref(),
                Some("PingFang TC")
            );
            assert_eq!(first_for(Category::Sans, None), interface);
        });

        ACTIVE.with_borrow_mut(|a| *a = None);
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
        // The locale stack's `ui-monospace` (SF Mono on macOS) cascades.
        let system: &[&str] = if UI_MONOSPACE.is_some() {
            &[crate::theme::mono()]
        } else {
            &[]
        };
        assert_eq!(
            stack.fallbacks,
            [&["Monaco"], system, &["Apple Color Emoji"]].concat()
        );
        let stack = walk(&css, Category::Monospace, &mut with(&["SF Mono", "Menlo"]));
        assert_eq!(stack.family.as_ref(), "SF Mono");
        assert_eq!(stack.fallbacks, [&["Menlo"], system].concat());
        // Nothing installed: the platform mono renders.
        let stack = walk(&css, Category::Monospace, &mut with(&[]));
        assert_eq!(stack.family.as_ref(), crate::theme::mono());
    }

    #[test]
    fn code_is_the_platform_mono_over_the_locale_script_faces() {
        let entry = fonts::resolve(&Selection::default()).code;
        let installed = ["PingFang SC", "Hiragino Sans", "Apple Color Emoji", "Menlo"];
        let walk_in = |locale: &str| {
            walk(
                &fonts::stack(entry, locale),
                Category::Monospace,
                &mut with(&installed),
            )
        };
        // `ui-monospace` is SF Mono on macOS; elsewhere the first installed
        // family of the stack renders.
        let (face, mut cascade): (&str, Vec<&str>) = if UI_MONOSPACE.is_some() {
            (crate::theme::mono(), vec!["Menlo"])
        } else {
            ("Menlo", vec![])
        };
        let zh = walk_in("zh-Hans");
        assert_eq!(zh.family.as_ref(), face);
        cascade.extend(["PingFang SC", "Apple Color Emoji"]);
        assert_eq!(zh.fallbacks, cascade);
        assert_eq!(
            walk_in("ja")
                .fallbacks
                .iter()
                .rev()
                .nth(1)
                .map(String::as_str),
            Some("Hiragino Sans")
        );
    }

    #[test]
    fn the_interface_is_the_system_face_and_keywords_never_enter_the_cascade() {
        let entry = fonts::resolve(&Selection::default()).ui;
        let en = walk(
            &fonts::stack(entry, "en"),
            Category::Sans,
            &mut with(&["Apple Color Emoji"]),
        );
        assert_eq!(en.family.as_ref(), SYSTEM_UI);
        assert_eq!(en.fallbacks, ["Apple Color Emoji", GENERIC_SANS]);
        let stack = walk(
            &fonts::stack(entry, "ko"),
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
            let gen0 = generation();
            crate::localization::set_current("ja");
            assert_eq!(font(Role::Code, cx).family.as_ref(), crate::theme::mono());
            assert_eq!(locale().as_deref(), Some("ja"));
            let gen1 = generation();
            assert!(gen1 > gen0, "reinstalling fonts must bump generation");
            crate::localization::set_current("zh-Hans");
            assert_eq!(font(Role::Ui, cx).family.as_ref(), SYSTEM_UI);
            assert_eq!(locale().as_deref(), Some("zh-Hans"));
            let gen2 = generation();
            assert!(gen2 > gen1, "locale switch must bump generation");
            // The platform mono renders when nothing the terminal stack
            // lists is installed.
            assert_eq!(
                font(Role::Terminal, cx).family.as_ref(),
                crate::theme::mono()
            );
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
