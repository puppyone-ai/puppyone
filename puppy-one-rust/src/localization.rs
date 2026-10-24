//! Session-only projection of production catalogs, not another translation
//! authority or a replacement for the product's persisted locale service.
//!
//! Messages use the ICU subset that the product catalogs actually contain:
//! `{arg}`, `{arg, number}` and `{arg, plural, =N {…} one {…} other {…}}` with `#`.
use serde_json::Value;
use std::sync::OnceLock;

fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../assets/locales.json")).expect("generated catalogs")
    })
}

/// Native-only messages for capabilities the product does not have; product
/// catalogs always take precedence.
fn native() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../assets/native-locales.json"))
            .expect("native catalogs")
    })
}

thread_local! {
    static CURRENT: std::cell::RefCell<String> = std::cell::RefCell::new(initial_code());
}
fn initial_code() -> String {
    std::env::var("PUPPYONE_LOCALE")
        .ok()
        .filter(|code| Locale::choices().any(|(id, _)| id == code))
        .unwrap_or_else(|| "en".into())
}
/// The shell publishes the persisted locale here; every view reads it through `t`/`tf`.
pub fn set_current(code: &str) {
    if Locale::choices().any(|(id, _)| id == code) {
        CURRENT.with(|c| *c.borrow_mut() = code.into());
    }
}
/// `resolveSystemLocale`: first OS language with a production catalog, by
/// exact tag, script (`zh-Hans`), region-less language, else English.
pub fn resolve_system(languages: &[String]) -> &'static str {
    let choices: Vec<&'static str> = Locale::choices().map(|(id, _)| id).collect();
    for tag in languages {
        let tag = tag.replace('_', "-");
        if let Some(found) = choices.iter().find(|c| c.eq_ignore_ascii_case(&tag)) {
            return found;
        }
        let lower = tag.to_lowercase();
        if lower.starts_with("zh") {
            let traditional = ["hant", "tw", "hk", "mo"].iter().any(|t| lower.contains(t));
            let target = if traditional { "zh-Hant" } else { "zh-Hans" };
            if let Some(found) = choices.iter().find(|c| **c == target) {
                return found;
            }
            continue;
        }
        if lower.starts_with("pt")
            && let Some(found) = choices.iter().find(|c| c.starts_with("pt"))
        {
            return found;
        }
        let language = lower.split('-').next().unwrap_or_default();
        if let Some(found) = choices.iter().find(|c| c.to_lowercase() == language) {
            return found;
        }
    }
    "en"
}
/// Catalog id the OS language resolves to.
pub fn system_locale() -> &'static str {
    resolve_system(crate::platform::environment::system_languages())
}
/// Resolve a stored preference (`system` or a locale id) to a catalog id.
pub fn resolve_preference(preference: &str, languages: &[String]) -> &'static str {
    Locale::choices()
        .map(|(id, _)| id)
        .find(|id| *id == preference)
        .unwrap_or_else(|| resolve_system(languages))
}
pub fn current() -> Locale {
    Locale {
        code: CURRENT.with(|c| c.borrow().clone()),
    }
}
/// `std::thread::spawn` for workers whose errors reach the UI: the worker
/// inherits the spawning thread's locale, since `CURRENT` is per thread.
pub fn spawn<F>(work: F) -> std::thread::JoinHandle<()>
where
    F: FnOnce() + Send + 'static,
{
    let code = CURRENT.with(|c| c.borrow().clone());
    std::thread::spawn(move || {
        set_current(&code);
        work()
    })
}
/// Parameter-free message in the current locale.
pub fn t(key: &str) -> &'static str {
    current().text(key)
}
/// Formatted message in the current locale.
pub fn tf(key: &str, args: &[(&str, Arg)]) -> String {
    current().format(key, args)
}

#[derive(Clone, Debug)]
pub enum Arg {
    Text(String),
    Number(i64),
}
impl From<&str> for Arg {
    fn from(value: &str) -> Self {
        Self::Text(value.into())
    }
}
impl From<String> for Arg {
    fn from(value: String) -> Self {
        Self::Text(value)
    }
}
impl From<usize> for Arg {
    fn from(value: usize) -> Self {
        Self::Number(value as i64)
    }
}
impl From<i64> for Arg {
    fn from(value: i64) -> Self {
        Self::Number(value)
    }
}
impl From<u32> for Arg {
    fn from(value: u32) -> Self {
        Self::Number(value as i64)
    }
}

#[derive(Clone)]
pub struct Locale {
    pub code: String,
}
impl Default for Locale {
    fn default() -> Self {
        current()
    }
}
impl Locale {
    pub fn choices() -> impl Iterator<Item = (&'static str, &'static str)> {
        data()["locales"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| (v["locale"].as_str().unwrap(), v["label"].as_str().unwrap()))
    }
    pub fn set(&mut self, code: &str) -> bool {
        if Self::choices().any(|(id, _)| id == code) && self.code != code {
            self.code = code.into();
            true
        } else {
            false
        }
    }
    pub fn text(&self, key: &str) -> &'static str {
        data()["catalogs"][&self.code][key]
            .as_str()
            .or_else(|| data()["catalogs"]["en"][key].as_str())
            .or_else(|| native()["catalogs"][&self.code][key].as_str())
            .or_else(|| native()["catalogs"]["en"][key].as_str())
            .unwrap_or_else(|| intern(key))
    }
    pub fn format(&self, key: &str, args: &[(&str, Arg)]) -> String {
        format_message(self.text(key), args, &self.code)
    }
}

/// Missing keys are a projection defect; show the key rather than invent copy.
/// Interned once so repeated renders do not allocate.
fn intern(key: &str) -> &'static str {
    static KEYS: OnceLock<std::sync::Mutex<std::collections::HashSet<&'static str>>> =
        OnceLock::new();
    let mut keys = KEYS.get_or_init(Default::default).lock().unwrap();
    if let Some(found) = keys.get(key) {
        return found;
    }
    let leaked: &'static str = Box::leak(key.to_owned().into_boxed_str());
    keys.insert(leaked);
    leaked
}

fn plural_category(code: &str, n: i64) -> &'static str {
    match code {
        "ja" | "ko" | "zh-Hans" | "zh-Hant" => "other",
        "fr" | "pt-BR" => {
            if n == 0 || n == 1 {
                "one"
            } else {
                "other"
            }
        }
        _ => {
            if n == 1 {
                "one"
            } else {
                "other"
            }
        }
    }
}

/// Render one ICU message. Unknown arguments render as their name so a
/// projection mismatch stays visible.
pub fn format_message(pattern: &str, args: &[(&str, Arg)], code: &str) -> String {
    render(pattern, args, code, None)
}
fn arg<'a>(args: &'a [(&str, Arg)], name: &str) -> Option<&'a Arg> {
    args.iter().find(|(k, _)| *k == name).map(|(_, v)| v)
}
fn render(pattern: &str, args: &[(&str, Arg)], code: &str, hash: Option<i64>) -> String {
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '{' => {
                let end = matching(&chars, i);
                let body: String = chars[i + 1..end].iter().collect();
                out.push_str(&placeholder(&body, args, code));
                i = end + 1;
            }
            '#' if hash.is_some() => {
                out.push_str(&hash.unwrap().to_string());
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}
fn matching(chars: &[char], open: usize) -> usize {
    let mut depth = 0;
    for (j, c) in chars.iter().enumerate().skip(open) {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return j;
                }
            }
            _ => {}
        }
    }
    chars.len() - 1
}
fn placeholder(body: &str, args: &[(&str, Arg)], code: &str) -> String {
    let mut parts = body.splitn(3, ',');
    let name = parts.next().unwrap_or_default().trim();
    let kind = parts.next().map(str::trim);
    let value = arg(args, name);
    match (kind, value) {
        (None, Some(Arg::Text(text))) => text.clone(),
        (None | Some("number"), Some(Arg::Number(n))) => n.to_string(),
        (Some("plural"), Some(Arg::Number(n))) => {
            let options = parts.next().unwrap_or_default();
            let branches = branches(options);
            let exact = format!("={n}");
            let category = plural_category(code, *n);
            branches
                .iter()
                .find(|(k, _)| *k == exact)
                .or_else(|| branches.iter().find(|(k, _)| *k == category))
                .or_else(|| branches.iter().find(|(k, _)| *k == "other"))
                .map(|(_, v)| render(v, args, code, Some(*n)))
                .unwrap_or_default()
        }
        (_, Some(Arg::Text(text))) => text.clone(),
        _ => format!("{{{name}}}"),
    }
}
fn branches(options: &str) -> Vec<(String, String)> {
    let chars: Vec<char> = options.chars().collect();
    let mut result = vec![];
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let start = i;
        while i < chars.len() && chars[i] != '{' && !chars[i].is_whitespace() {
            i += 1;
        }
        let key: String = chars[start..i].iter().collect();
        while i < chars.len() && chars[i] != '{' {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        let end = matching(&chars, i);
        result.push((key, chars[i + 1..end].iter().collect()));
        i = end + 1;
    }
    result
}

/// A unit of [`relative_past`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeUnit {
    Minute,
    Hour,
    Day,
}
/// `Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(-n, unit)`
/// in the current locale: "2 minutes ago", "2分钟前", "vor 2 Minuten".
pub fn relative_past(n: i64, unit: TimeUnit) -> String {
    let code = CURRENT.with(|c| c.borrow().clone());
    relative_past_in(&code, n, unit)
}
fn relative_past_in(code: &str, n: i64, unit: TimeUnit) -> String {
    use TimeUnit::*;
    let one = plural_category(code, n) == "one";
    let pick = |singular: &'static str, plural: &'static str| if one { singular } else { plural };
    match code {
        "zh-Hans" => format!(
            "{n}{}前",
            match unit {
                Minute => "分钟",
                Hour => "小时",
                Day => "天",
            }
        ),
        "ja" => format!(
            "{n} {}前",
            match unit {
                Minute => "分",
                Hour => "時間",
                Day => "日",
            }
        ),
        "ko" => format!(
            "{n}{} 전",
            match unit {
                Minute => "분",
                Hour => "시간",
                Day => "일",
            }
        ),
        "de" => format!(
            "vor {n} {}",
            match unit {
                Minute => pick("Minute", "Minuten"),
                Hour => pick("Stunde", "Stunden"),
                Day => pick("Tag", "Tagen"),
            }
        ),
        "fr" => format!(
            "il y a {n} {}",
            match unit {
                Minute => pick("minute", "minutes"),
                Hour => pick("heure", "heures"),
                Day => pick("jour", "jours"),
            }
        ),
        "es" => format!(
            "hace {n} {}",
            match unit {
                Minute => pick("minuto", "minutos"),
                Hour => pick("hora", "horas"),
                Day => pick("día", "días"),
            }
        ),
        "pt-BR" => format!(
            "há {n} {}",
            match unit {
                Minute => pick("minuto", "minutos"),
                Hour => pick("hora", "horas"),
                Day => pick("dia", "dias"),
            }
        ),
        _ => format!(
            "{n} {} ago",
            match unit {
                Minute => pick("minute", "minutes"),
                Hour => pick("hour", "hours"),
                Day => pick("day", "days"),
            }
        ),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn relative_past_follows_intl_relative_time_format() {
        use super::{TimeUnit::*, relative_past_in};
        assert_eq!(relative_past_in("en", 1, Day), "1 day ago");
        assert_eq!(relative_past_in("en", 2, Minute), "2 minutes ago");
        assert_eq!(relative_past_in("zh-Hans", 3, Hour), "3小时前");
        assert_eq!(relative_past_in("de", 1, Day), "vor 1 Tag");
        assert_eq!(relative_past_in("fr", 1, Minute), "il y a 1 minute");
        assert_eq!(relative_past_in("ja", 5, Day), "5 日前");
    }
    use super::*;
    #[test]
    fn languages_come_from_product_and_invalid_updates_keep_previous_state() {
        let mut locale = Locale { code: "en".into() };
        assert_eq!(Locale::choices().count(), 8);
        assert!(locale.set("zh-Hans"));
        assert_eq!(locale.text("settings.general.title"), "通用");
        assert!(!locale.set("unknown"));
        assert_eq!(locale.code, "zh-Hans");
        assert!(!locale.set("zh-Hans"));
    }
    #[test]
    fn icu_subset_matches_product_catalog_usage() {
        let en = Locale { code: "en".into() };
        assert_eq!(
            en.format("agent.header.newSession", &[("agent", "Codex".into())]),
            "New Codex session"
        );
        assert_eq!(
            en.format("workspace.node.deleteItems", &[("count", 1usize.into())]),
            "Delete item"
        );
        assert_eq!(
            en.format("workspace.node.deleteItems", &[("count", 3usize.into())]),
            "Delete 3 items"
        );
        assert_eq!(
            en.format("agent.reference.batchResult", &[("count", 0usize.into())]),
            "Added no references."
        );
        let zh = Locale {
            code: "zh-Hans".into(),
        };
        assert!(
            zh.format("workspace.node.deleteItems", &[("count", 1usize.into())])
                .contains('1')
        );
        assert_eq!(format_message("{x}", &[], "en"), "{x}");
        let langs = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(resolve_system(&langs(&["zh-Hans-CN", "en"])), "zh-Hans");
        assert_eq!(resolve_system(&langs(&["pt-PT"])), "pt-BR");
        assert_eq!(resolve_system(&langs(&["de-AT"])), "de");
        assert_eq!(resolve_system(&langs(&["xx"])), "en");
        assert_eq!(resolve_preference("ja", &[]), "ja");
        // Every native-only message exists in every production locale.
        let en = native()["catalogs"]["en"].as_object().unwrap();
        for (code, _) in Locale::choices() {
            let catalog = native()["catalogs"][code].as_object().unwrap();
            for key in en.keys() {
                assert!(catalog.contains_key(key), "{code} lacks {key}");
            }
        }
    }
    #[test]
    fn workers_inherit_the_spawning_locale() {
        // Runs on its own thread so the per-thread locale does not leak.
        std::thread::spawn(|| {
            set_current("zh-Hans");
            let (tx, rx) = std::sync::mpsc::channel();
            spawn(move || {
                let _ = tx.send(t("native.workspace.nameExists"));
            })
            .join()
            .unwrap();
            assert_eq!(rx.recv().unwrap(), "已存在同名项目。");
            let plain = std::thread::spawn(|| t("native.workspace.nameExists"));
            assert_ne!(plain.join().unwrap(), "已存在同名项目。");
        })
        .join()
        .unwrap();
    }
}
