//! Session-only projection of production catalogs, not another translation
//! authority or a replacement for the product's persisted locale service.
//!
//! Messages use the ICU subset that the product catalogs actually contain:
//! `{arg}`, `{arg, number}`, `{arg, plural, =N {…} one {…} other {…}}` with `#`
//! and `{arg, select, key {…} other {…}}`.
use serde_json::Value;
use std::sync::OnceLock;

fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        let mut data: Value = serde_json::from_str(include_str!("../assets/locales.json"))
            .expect("generated catalogs");
        // Narrow, provenance-checked projection of the new loading-style keys.
        // The full reviewed catalog is projected by import-localization.py;
        // the asset receipt also protects the loading-style subset.
        for (locale, messages) in crate::asset_catalog::data()["locales"].as_object().unwrap() {
            data["catalogs"][locale]
                .as_object_mut()
                .unwrap()
                .extend(messages.as_object().unwrap().clone());
        }
        data
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
/// The calling thread's locale code (workers inherit it from their spawner).
pub fn current_code() -> String {
    CURRENT.with(|c| c.borrow().clone())
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
    // Workers inherit the locale; a panic is recorded and contained so one
    // failing reader cannot take every window down.
    crate::platform::watchdog::spawn_contained("worker", work, |_| {})
}
/// The current locale's messages whose keys start with one of `prefixes`
/// (English where a translation is missing), for bundled product web views.
pub fn messages(prefixes: &[&str]) -> serde_json::Map<String, Value> {
    let locale = current();
    data()["catalogs"]["en"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(key, _)| prefixes.iter().any(|p| key.starts_with(p)))
        .map(|(key, _)| (key.clone(), Value::String(locale.text(key).to_owned())))
        .collect()
}
/// `bidiIsolate(value)`: an interpolated value isolated from the message's
/// direction (U+2068 … U+2069).
pub fn bidi_isolate(value: &str) -> String {
    if value.starts_with('\u{2068}') && value.ends_with('\u{2069}') {
        return value.to_string();
    }
    format!("\u{2068}{value}\u{2069}")
}

/// How `Intl.NumberFormat` writes numbers in each product language: decimal
/// mark, group separator, the fewest integer digits that are grouped, and
/// where a currency symbol stands. `fixtures/ui/number-format-oracle.json`
/// (`tools/reference-number-format.mjs`, from Intl itself) pins them.
struct NumberStyle {
    decimal: char,
    group: char,
    min_grouped: usize,
    currency: CurrencyPosition,
}
enum CurrencyPosition {
    /// `$20`
    Before,
    /// `$ 20` (no-break space)
    BeforeSpaced,
    /// `20 $` (no-break space)
    After,
}
fn number_style(code: &str) -> NumberStyle {
    let (decimal, group, min_grouped, currency) = match code {
        // Spanish groups only five digits and more.
        "es" => (',', '.', 5, CurrencyPosition::After),
        "pt-BR" => (',', '.', 4, CurrencyPosition::BeforeSpaced),
        // A narrow no-break space.
        "fr" => (',', '\u{202f}', 4, CurrencyPosition::After),
        "de" => (',', '.', 4, CurrencyPosition::After),
        _ => ('.', ',', 4, CurrencyPosition::Before),
    };
    NumberStyle {
        decimal,
        group,
        min_grouped,
        currency,
    }
}
/// `value` at most `max` and at least `min` fraction digits, rounded half
/// away from zero on its shortest decimal form, as Intl's `halfExpand` does.
fn decimal_digits(value: f64, min: usize, max: usize) -> (bool, String, String) {
    let text = format!("{}", value.abs());
    let (int, frac) = text.split_once('.').unwrap_or((&text, ""));
    let mut digits: Vec<u8> = int.bytes().chain(frac.bytes().take(max)).collect();
    let mut int_len = int.len();
    if frac.as_bytes().get(max).is_some_and(|d| *d >= b'5') {
        let mut i = digits.len();
        loop {
            if i == 0 {
                digits.insert(0, b'1');
                int_len += 1;
                break;
            }
            i -= 1;
            if digits[i] == b'9' {
                digits[i] = b'0';
            } else {
                digits[i] += 1;
                break;
            }
        }
    }
    let int = String::from_utf8(digits[..int_len].to_vec()).unwrap_or_default();
    let mut frac = String::from_utf8(digits[int_len..].to_vec()).unwrap_or_default();
    while frac.len() > min && frac.ends_with('0') {
        frac.pop();
    }
    while frac.len() < min {
        frac.push('0');
    }
    (value.is_sign_negative(), int, frac)
}
fn grouped(int: &str, style: &NumberStyle) -> String {
    if int.len() < style.min_grouped {
        return int.to_owned();
    }
    let mut out = String::new();
    for (index, digit) in int.chars().enumerate() {
        if index > 0 && (int.len() - index).is_multiple_of(3) {
            out.push(style.group);
        }
        out.push(digit);
    }
    out
}
fn number_in(code: &str, value: f64, min: usize, max: usize) -> (bool, String) {
    let style = number_style(code);
    let (negative, int, frac) = decimal_digits(value, min, max);
    let mut text = grouped(&int, &style);
    if !frac.is_empty() {
        text.push(style.decimal);
        text.push_str(&frac);
    }
    (negative, text)
}
/// `formatNumber(value, {maximumFractionDigits})` in `code`.
pub fn format_decimal_in(code: &str, value: f64, max_fraction: usize) -> String {
    let (negative, text) = number_in(code, value, 0, max_fraction);
    if negative { format!("-{text}") } else { text }
}
/// `formatNumber(value)` (`Intl.NumberFormat`) for an integer in the current
/// locale.
pub fn format_number(value: i64) -> String {
    format_decimal_in(&current_code(), value as f64, 0)
}
/// `formatNumber(value, {maximumFractionDigits})` in the current locale.
pub fn format_decimal(value: f64, max_fraction: usize) -> String {
    format_decimal_in(&current_code(), value, max_fraction)
}
/// `formatNumber(amount, {style: "currency", currencyDisplay: "narrowSymbol",
/// maximumFractionDigits: fraction})` in `code`; the currency's minor digits
/// are shown when `fraction` is 2.
pub fn format_currency_in(code: &str, amount: f64, currency: &str, fraction: usize) -> String {
    let (negative, number) = number_in(code, amount, fraction, fraction);
    let symbol = match currency.to_ascii_uppercase().as_str() {
        "USD" => "$".to_owned(),
        "EUR" => "€".to_owned(),
        "GBP" => "£".to_owned(),
        other => other.to_owned(),
    };
    let sign = if negative { "-" } else { "" };
    match number_style(code).currency {
        CurrencyPosition::Before => format!("{sign}{symbol}{number}"),
        CurrencyPosition::BeforeSpaced => format!("{sign}{symbol}\u{a0}{number}"),
        CurrencyPosition::After => format!("{sign}{number}\u{a0}{symbol}"),
    }
}
/// `format_currency_in` in the current locale.
pub fn format_currency(amount: f64, currency: &str, fraction: usize) -> String {
    format_currency_in(&current_code(), amount, currency, fraction)
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
        // `{gender, select, female {…} other {…}}`: the exact key, else other.
        (Some("select"), Some(value)) => {
            let key = match value {
                Arg::Text(text) => text.clone(),
                Arg::Number(n) => n.to_string(),
            };
            let branches = branches(parts.next().unwrap_or_default());
            branches
                .iter()
                .find(|(k, _)| *k == key)
                .or_else(|| branches.iter().find(|(k, _)| *k == "other"))
                .map(|(_, v)| render(v, args, code, None))
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

/// `Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "second")`.
pub fn relative_now() -> &'static str {
    let code = CURRENT.with(|c| c.borrow().clone());
    match code.as_str() {
        "zh-Hans" => "现在",
        "ja" => "今",
        "ko" => "지금",
        "de" => "jetzt",
        "fr" => "maintenant",
        "es" => "ahora",
        "pt-BR" => "agora",
        _ => "now",
    }
}
/// `Intl.ListFormat(locale, { type: "conjunction" })` of one or two items
/// ("3 files and 2 searches", "3 个文件和 2 次搜索").
pub fn and_list(items: &[String]) -> String {
    let code = CURRENT.with(|c| c.borrow().clone());
    match items {
        [] => String::new(),
        [one] => one.clone(),
        [a, b] => {
            let and = match code.as_str() {
                "zh-Hans" => "和",
                "ja" => "、",
                "ko" => " 및 ",
                "de" => " und ",
                "fr" => " et ",
                "es" => " y ",
                "pt-BR" => " e ",
                _ => " and ",
            };
            format!("{a}{and}{b}")
        }
        [rest @ .., last] => format!(
            "{}, {}",
            rest.join(", "),
            and_list(&[String::new(), last.clone()]).trim_start()
        ),
    }
}
/// `Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(n, "day")`
/// for today (0) and yesterday (-1).
pub fn relative_day(offset: i64) -> String {
    let code = CURRENT.with(|c| c.borrow().clone());
    relative_day_in(&code, offset).to_owned()
}
fn relative_day_in(code: &str, offset: i64) -> &'static str {
    let (today, yesterday) = match code {
        "zh-Hans" => ("今天", "昨天"),
        "ja" => ("今日", "昨日"),
        "ko" => ("오늘", "어제"),
        "de" => ("heute", "gestern"),
        "fr" => ("aujourd’hui", "hier"),
        "es" => ("hoy", "ayer"),
        "pt-BR" => ("hoje", "ontem"),
        _ => ("today", "yesterday"),
    };
    if offset == 0 { today } else { yesterday }
}
/// `Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year })`:
/// "Oct 23", "10月23日", "23. Okt."; the year only when given.
pub fn month_day(year: Option<i32>, month: u32, day: u32) -> String {
    let code = CURRENT.with(|c| c.borrow().clone());
    month_day_in(&code, year, month, day)
}
fn month_day_in(code: &str, year: Option<i32>, month: u32, day: u32) -> String {
    let short = |names: [&'static str; 12]| names[(month.clamp(1, 12) - 1) as usize];
    match (code, year) {
        ("zh-Hans" | "ja", None) => format!("{month}月{day}日"),
        ("zh-Hans" | "ja", Some(y)) => format!("{y}年{month}月{day}日"),
        ("ko", None) => format!("{month}월 {day}일"),
        ("ko", Some(y)) => format!("{y}년 {month}월 {day}일"),
        ("de", _) => {
            let m = short([
                "Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.",
                "Nov.", "Dez.",
            ]);
            year.map_or(format!("{day}. {m}"), |y| format!("{day}. {m} {y}"))
        }
        ("fr", _) => {
            let m = short([
                "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.",
                "nov.", "déc.",
            ]);
            year.map_or(format!("{day} {m}"), |y| format!("{day} {m} {y}"))
        }
        ("es", _) => {
            let m = short([
                "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic",
            ]);
            year.map_or(format!("{day} {m}"), |y| format!("{day} {m} {y}"))
        }
        ("pt-BR", _) => {
            let m = short([
                "jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.",
                "nov.", "dez.",
            ]);
            year.map_or(format!("{day} de {m}"), |y| format!("{day} de {m} de {y}"))
        }
        _ => {
            let m = short([
                "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            ]);
            year.map_or(format!("{m} {day}"), |y| format!("{m} {day}, {y}"))
        }
    }
}

#[cfg(test)]
mod tests {
    /// `fixtures/ui/number-format-oracle.json`: Intl itself, in every
    /// product language.
    #[test]
    fn numbers_and_money_read_as_intl_writes_them() {
        let oracle: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/ui/number-format-oracle.json")).unwrap();
        let mut wrong = Vec::new();
        for case in oracle["cases"].as_array().unwrap() {
            let locale = case["locale"].as_str().unwrap();
            let value = case["value"].as_f64().unwrap();
            let actual = if case["kind"] == "currency" {
                super::format_currency_in(
                    locale,
                    value,
                    case["currency"].as_str().unwrap(),
                    case["fraction"].as_u64().unwrap() as usize,
                )
            } else {
                super::format_decimal_in(locale, value, case["max"].as_u64().unwrap() as usize)
            };
            if actual != case["expected"].as_str().unwrap() {
                wrong.push(format!("{case} -> {actual:?}"));
            }
        }
        assert!(wrong.is_empty(), "{}", wrong.join("\n"));
    }
    #[test]
    fn days_and_dates_follow_intl() {
        use super::{month_day_in, relative_day_in};
        assert_eq!(relative_day_in("en", -1), "yesterday");
        assert_eq!(relative_day_in("zh-Hans", 0), "今天");
        assert_eq!(month_day_in("en", None, 10, 23), "Oct 23");
        assert_eq!(month_day_in("en", Some(2025), 1, 5), "Jan 5, 2025");
        assert_eq!(month_day_in("zh-Hans", None, 10, 23), "10月23日");
        assert_eq!(month_day_in("de", None, 3, 2), "2. März");
        assert_eq!(
            month_day_in("pt-BR", Some(2024), 10, 23),
            "23 de out. de 2024"
        );
    }
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
        // `select`: the matching branch, else `other`; nested arguments render.
        let select = "{kind, select, folder {Folder {name}} file {File} other {Item}}";
        let kind =
            |k: &str| format_message(select, &[("kind", k.into()), ("name", "docs".into())], "en");
        assert_eq!(kind("folder"), "Folder docs");
        assert_eq!(kind("file"), "File");
        assert_eq!(kind("link"), "Item");
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
    /// Every message the native code names literally exists somewhere: in a
    /// product catalog, the asset projection, or the native catalog. A key
    /// the product dropped shows as itself, so it fails here instead.
    #[test]
    fn every_literal_message_key_resolves() {
        let pattern = regex::Regex::new(
            r#"\b(?:t|tr|tf)\(\s*"([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)""#,
        )
        .unwrap();
        let known = |key: &str| {
            data()["catalogs"]["en"][key].is_string() || native()["catalogs"]["en"][key].is_string()
        };
        let mut missing = Vec::new();
        let mut dirs = vec![std::path::PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src"
        ))];
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    dirs.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    let source = std::fs::read_to_string(&path).unwrap();
                    for found in pattern.captures_iter(&source) {
                        let key = &found[1];
                        if !known(key) {
                            missing.push(format!("{}: {key}", path.display()));
                        }
                    }
                }
            }
        }
        missing.sort();
        assert!(
            missing.is_empty(),
            "unknown message keys:\n{}",
            missing.join("\n")
        );
    }
}
