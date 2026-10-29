//! CSS component values for theme colours: a small tokenizer, `var()`
//! substitution with fallbacks, and sRGB colour evaluation (`#hex`, named
//! colours, `rgb()`/`hsl()`, `color(srgb …)`, `color-mix(in srgb, …)` and
//! `light-dark()`), the way Chromium computes the product's tokens.
use super::named_colors::NAMED;

#[derive(Clone, Debug, PartialEq)]
pub enum Tok {
    Ident(String),
    Hash(String),
    /// A number with its unit (`""`, `"%"`, `"px"`, `"deg"`, …).
    Num(f64, String),
    Str(String),
    Url(String),
    Func(String, Vec<Tok>),
    Comma,
    Slash,
    Delim(char),
}

pub fn tokenize(s: &str) -> Option<Vec<Tok>> {
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    let (tokens, end) = run(&chars, &mut i, false)?;
    (!end).then_some(tokens)
}

fn is_name(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_' || !c.is_ascii()
}

/// Read until the end or, inside a function, its `)` (returns whether a
/// closing parenthesis ended the run).
fn run(chars: &[char], i: &mut usize, nested: bool) -> Option<(Vec<Tok>, bool)> {
    let mut out = Vec::new();
    while *i < chars.len() {
        let c = chars[*i];
        let next = chars.get(*i + 1).copied();
        if c.is_whitespace() {
            *i += 1;
        } else if c == ')' {
            *i += 1;
            return nested.then_some((out, true));
        } else if c == ',' {
            out.push(Tok::Comma);
            *i += 1;
        } else if c == '/' {
            if next == Some('*') {
                let rest: String = chars[*i + 2..].iter().collect();
                let end = rest.find("*/")?;
                *i += 2 + rest[..end].chars().count() + 2;
            } else {
                out.push(Tok::Slash);
                *i += 1;
            }
        } else if c == '"' || c == '\'' {
            *i += 1;
            let mut text = String::new();
            loop {
                let ch = *chars.get(*i)?;
                *i += 1;
                if ch == '\\' {
                    text.push(*chars.get(*i)?);
                    *i += 1;
                } else if ch == c {
                    break;
                } else {
                    text.push(ch);
                }
            }
            out.push(Tok::Str(text));
        } else if c == '#' {
            *i += 1;
            let start = *i;
            while *i < chars.len() && is_name(chars[*i]) {
                *i += 1;
            }
            out.push(Tok::Hash(chars[start..*i].iter().collect()));
        } else if c.is_ascii_digit()
            || (c == '.' && next.is_some_and(|n| n.is_ascii_digit()))
            || ((c == '-' || c == '+')
                && next.is_some_and(|n| {
                    n.is_ascii_digit()
                        || (n == '.' && chars.get(*i + 2).is_some_and(|d| d.is_ascii_digit()))
                }))
        {
            let start = *i;
            *i += 1;
            while *i < chars.len()
                && (chars[*i].is_ascii_digit()
                    || (chars[*i] == '.' && chars.get(*i + 1).is_some_and(|d| d.is_ascii_digit())))
            {
                *i += 1;
            }
            if *i < chars.len()
                && (chars[*i] == 'e' || chars[*i] == 'E')
                && chars.get(*i + 1).is_some_and(|d| {
                    d.is_ascii_digit()
                        || ((*d == '-' || *d == '+')
                            && chars.get(*i + 2).is_some_and(|e| e.is_ascii_digit()))
                })
            {
                *i += 2;
                while *i < chars.len() && chars[*i].is_ascii_digit() {
                    *i += 1;
                }
            }
            let number: f64 = chars[start..*i].iter().collect::<String>().parse().ok()?;
            let unit = if chars.get(*i) == Some(&'%') {
                *i += 1;
                "%".to_owned()
            } else {
                let unit_start = *i;
                while *i < chars.len() && is_name(chars[*i]) {
                    *i += 1;
                }
                chars[unit_start..*i].iter().collect()
            };
            out.push(Tok::Num(number, unit));
        } else if is_name(c) || c == '\\' {
            let start = *i;
            while *i < chars.len() && (is_name(chars[*i]) || chars[*i] == '\\') {
                *i += if chars[*i] == '\\' { 2 } else { 1 };
            }
            let name: String = chars[start..(*i).min(chars.len())].iter().collect();
            if chars.get(*i) == Some(&'(') {
                *i += 1;
                if name.eq_ignore_ascii_case("url") {
                    let mut j = *i;
                    while j < chars.len() && chars[j].is_whitespace() {
                        j += 1;
                    }
                    if !matches!(chars.get(j), Some('"' | '\'')) {
                        let end = chars[j..].iter().position(|&ch| ch == ')')? + j;
                        out.push(Tok::Url(
                            chars[j..end].iter().collect::<String>().trim().into(),
                        ));
                        *i = end + 1;
                        continue;
                    }
                }
                let (args, closed) = run(chars, i, true)?;
                if !closed {
                    return None;
                }
                out.push(Tok::Func(name, args));
            } else {
                out.push(Tok::Ident(name));
            }
        } else {
            out.push(Tok::Delim(c));
            *i += 1;
        }
    }
    if nested { None } else { Some((out, false)) }
}

/// Serialize tokens back to CSS text.
pub fn to_css(tokens: &[Tok]) -> String {
    let mut out = String::new();
    for (index, token) in tokens.iter().enumerate() {
        if index > 0 && !matches!(token, Tok::Comma) {
            out.push(' ');
        }
        match token {
            Tok::Ident(name) => out.push_str(name),
            Tok::Hash(hex) => {
                out.push('#');
                out.push_str(hex);
            }
            Tok::Num(n, unit) => {
                out.push_str(&format!("{n}{unit}"));
            }
            Tok::Str(text) => out.push_str(&format!("{text:?}")),
            Tok::Url(raw) => out.push_str(&format!("url({raw})")),
            Tok::Func(name, args) => {
                out.push_str(name);
                out.push('(');
                out.push_str(&to_css(args));
                out.push(')');
            }
            Tok::Comma => out.push(','),
            Tok::Slash => out.push('/'),
            Tok::Delim(c) => out.push(*c),
        }
    }
    out
}

/// Split function arguments at commas.
pub fn groups(args: &[Tok]) -> Vec<&[Tok]> {
    args.split(|t| matches!(t, Tok::Comma)).collect()
}

/// An sRGB colour, channels 0–255 and alpha 0–1.
pub type Rgba = [f64; 4];

pub fn named(name: &str) -> Option<[u8; 3]> {
    let lower = name.to_ascii_lowercase();
    NAMED
        .binary_search_by(|(n, _)| n.cmp(&lower.as_str()))
        .ok()
        .map(|i| NAMED[i].1)
}

fn hex(digits: &str) -> Option<Rgba> {
    if !digits.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let v = |s: &str| u8::from_str_radix(s, 16).ok().map(f64::from);
    let d: Vec<String> = match digits.len() {
        3 | 4 => digits.chars().map(|c| format!("{c}{c}")).collect(),
        6 | 8 => digits
            .as_bytes()
            .chunks(2)
            .map(|p| String::from_utf8_lossy(p).into_owned())
            .collect(),
        _ => return None,
    };
    Some([
        v(&d[0])?,
        v(&d[1])?,
        v(&d[2])?,
        d.get(3).map_or(Some(1.), |a| v(a).map(|a| a / 255.))?,
    ])
}

fn alpha(token: &Tok) -> Option<f64> {
    match token {
        Tok::Num(n, unit) if unit.is_empty() => Some(n.clamp(0., 1.)),
        Tok::Num(n, unit) if unit == "%" => Some((n / 100.).clamp(0., 1.)),
        Tok::Ident(none) if none.eq_ignore_ascii_case("none") => Some(0.),
        _ => None,
    }
}

/// `rgb()`/`hsl()` arguments in either the legacy comma or the modern
/// space syntax: three channels and an optional alpha.
fn channels(args: &[Tok]) -> Option<([&Tok; 3], f64)> {
    let parts: Vec<&Tok> = args
        .iter()
        .filter(|t| !matches!(t, Tok::Comma | Tok::Slash))
        .collect();
    if !(parts.len() == 3 || parts.len() == 4) {
        return None;
    }
    let a = match parts.get(3) {
        Some(token) => alpha(token)?,
        None => 1.,
    };
    Some(([parts[0], parts[1], parts[2]], a))
}

/// Evaluate a single colour value (after `var()` substitution).
pub fn color(tokens: &[Tok], dark: bool) -> Option<Rgba> {
    let [token] = tokens else { return None };
    match token {
        Tok::Hash(digits) => hex(digits),
        Tok::Ident(name) if name.eq_ignore_ascii_case("transparent") => Some([0., 0., 0., 0.]),
        Tok::Ident(name) => named(name).map(|[r, g, b]| [r.into(), g.into(), b.into(), 1.]),
        Tok::Func(name, args) => match name.to_ascii_lowercase().as_str() {
            "rgb" | "rgba" => {
                let (c, a) = channels(args)?;
                let channel = |t: &Tok| match t {
                    Tok::Num(n, unit) if unit.is_empty() => Some(n.clamp(0., 255.)),
                    Tok::Num(n, unit) if unit == "%" => Some((n * 2.55).clamp(0., 255.)),
                    _ => None,
                };
                Some([channel(c[0])?, channel(c[1])?, channel(c[2])?, a])
            }
            "hsl" | "hsla" => {
                let (c, a) = channels(args)?;
                let hue = match c[0] {
                    Tok::Num(n, unit) if unit.is_empty() || unit == "deg" => *n,
                    Tok::Num(n, unit) if unit == "turn" => n * 360.,
                    Tok::Num(n, unit) if unit == "rad" => n.to_degrees(),
                    _ => return None,
                };
                let pct = |t: &Tok| match t {
                    Tok::Num(n, unit) if unit == "%" || unit.is_empty() => {
                        Some((n / 100.).clamp(0., 1.))
                    }
                    _ => None,
                };
                let (s, l) = (pct(c[1])?, pct(c[2])?);
                let f = |n: f64| {
                    let k = (n + hue.rem_euclid(360.) / 30.) % 12.;
                    let m = s * l.min(1. - l);
                    (l - m * (k - 3.).min(9. - k).clamp(-1., 1.)) * 255.
                };
                Some([f(0.), f(8.), f(4.), a])
            }
            "color" => {
                let (space, rest) = args.split_first()?;
                if !matches!(space, Tok::Ident(s) if s.eq_ignore_ascii_case("srgb")) {
                    return None;
                }
                let (c, a) = channels(rest)?;
                let channel = |t: &Tok| match t {
                    Tok::Num(n, unit) if unit.is_empty() => Some(n.clamp(0., 1.) * 255.),
                    Tok::Num(n, unit) if unit == "%" => Some((n / 100.).clamp(0., 1.) * 255.),
                    _ => None,
                };
                Some([channel(c[0])?, channel(c[1])?, channel(c[2])?, a])
            }
            "light-dark" => {
                let parts = groups(args);
                let [light, dark_value] = parts.as_slice() else {
                    return None;
                };
                color(if dark { dark_value } else { light }, dark)
            }
            "color-mix" => mix(args, dark),
            _ => None,
        },
        _ => None,
    }
}

/// `color-mix(in srgb, a [p%], b [p%])` with premultiplied alpha. Weights
/// summing past 100% are scaled down; a smaller sum scales the alpha.
fn mix(args: &[Tok], dark: bool) -> Option<Rgba> {
    let parts = groups(args);
    let [space, a, b] = parts.as_slice() else {
        return None;
    };
    let in_srgb = matches!(space, [Tok::Ident(i), Tok::Ident(s)]
        if i.eq_ignore_ascii_case("in") && s.eq_ignore_ascii_case("srgb"));
    if !in_srgb {
        return None;
    }
    let side = |part: &[Tok]| -> Option<(Rgba, Option<f64>)> {
        let mut weight = None;
        let mut rest = Vec::new();
        for token in part {
            match token {
                Tok::Num(n, unit) if unit == "%" && weight.is_none() => weight = Some(n / 100.),
                other => rest.push(other.clone()),
            }
        }
        Some((color(&rest, dark)?, weight))
    };
    let (ca, pa) = side(a)?;
    let (cb, pb) = side(b)?;
    let (mut wa, mut wb) = match (pa, pb) {
        (None, None) => (0.5, 0.5),
        (Some(p), None) => (p, 1. - p),
        (None, Some(p)) => (1. - p, p),
        (Some(p), Some(q)) => (p, q),
    };
    let sum = wa + wb;
    if sum <= 0. {
        return None;
    }
    let multiplier = sum.min(1.);
    wa /= sum;
    wb /= sum;
    let alpha = ca[3] * wa + cb[3] * wb;
    let rgb = if alpha == 0. {
        [0., 0., 0.]
    } else {
        [0, 1, 2].map(|i| (ca[i] * ca[3] * wa + cb[i] * cb[3] * wb) / alpha)
    };
    Some([rgb[0], rgb[1], rgb[2], alpha * multiplier])
}

/// `formatColor` (tools/css-tokens.mjs): `#rrggbb` when opaque, otherwise
/// `rgba(r,g,b,a)` with whole channels and four alpha decimals.
pub fn format(c: Rgba) -> String {
    let channel = |v: f64| v.round().clamp(0., 255.) as u8;
    if c[3] >= 0.999 {
        format!(
            "#{:02x}{:02x}{:02x}",
            channel(c[0]),
            channel(c[1]),
            channel(c[2])
        )
    } else {
        let a: f64 = format!("{:.4}", c[3]).parse().unwrap_or(0.);
        format!(
            "rgba({},{},{},{a})",
            channel(c[0]),
            channel(c[1]),
            channel(c[2])
        )
    }
}

/// Substitute `var()` references: the declared value, else the product's
/// semantic alias, else the fallback. `None` is a guaranteed-invalid value.
pub fn substitute(
    tokens: &[Tok],
    lookup: &dyn Fn(&str) -> Option<String>,
    depth: usize,
) -> Option<Vec<Tok>> {
    if depth > 24 {
        return None;
    }
    let mut out = Vec::new();
    for token in tokens {
        match token {
            Tok::Func(name, args) if name.eq_ignore_ascii_case("var") => {
                let (head, fallback) = match args.iter().position(|t| matches!(t, Tok::Comma)) {
                    Some(i) => (&args[..i], Some(&args[i + 1..])),
                    None => (&args[..], None),
                };
                let [Tok::Ident(var)] = head else { return None };
                let declared = lookup(var).and_then(|raw| tokenize(&raw));
                let value = match (declared, fallback) {
                    (Some(value), _) => substitute(&value, lookup, depth + 1)?,
                    (None, Some(fallback)) => substitute(fallback, lookup, depth + 1)?,
                    (None, None) => return None,
                };
                out.extend(value);
            }
            Tok::Func(name, args) => {
                out.push(Tok::Func(name.clone(), substitute(args, lookup, depth)?));
            }
            other => out.push(other.clone()),
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn eval(css: &str, dark: bool) -> Option<String> {
        color(&tokenize(css)?, dark).map(format)
    }

    #[test]
    fn colours_evaluate_like_the_browser() {
        assert_eq!(eval("#fff", false).unwrap(), "#ffffff");
        assert_eq!(eval("#11223380", false).unwrap(), "rgba(17,34,51,0.502)");
        assert_eq!(eval("rgb(20 40 60)", false).unwrap(), "#14283c");
        assert_eq!(
            eval("rgba(45, 43, 38, 0.14)", false).unwrap(),
            "rgba(45,43,38,0.14)"
        );
        assert_eq!(eval("rgb(0 0 0 / 50%)", false).unwrap(), "rgba(0,0,0,0.5)");
        assert_eq!(eval("hsl(210 50% 40%)", false).unwrap(), "#336699");
        assert_eq!(eval("RebeccaPurple", false).unwrap(), "#663399");
        assert_eq!(eval("transparent", false).unwrap(), "rgba(0,0,0,0)");
        assert_eq!(eval("light-dark(#000, #fff)", true).unwrap(), "#ffffff");
        assert_eq!(
            eval("color-mix(in srgb, #4599df 22%, transparent)", false).unwrap(),
            "rgba(69,153,223,0.22)"
        );
        assert_eq!(
            eval("color-mix(in srgb, #000000 40%, #ffffff)", false).unwrap(),
            "#999999"
        );
        assert_eq!(
            eval("color(srgb 1 0 0 / 0.5)", false).unwrap(),
            "rgba(255,0,0,0.5)"
        );
        assert_eq!(eval("color-mix(in oklch, red, blue)", false), None);
        assert_eq!(eval("calc(1px)", false), None);
    }

    #[test]
    fn variables_substitute_with_fallbacks() {
        let vars = |name: &str| match name {
            "--a" => Some("#102030".to_owned()),
            "--b" => Some("color-mix(in srgb, var(--a) 50%, var(--missing, #ffffff))".to_owned()),
            "--loop" => Some("var(--loop)".to_owned()),
            _ => None,
        };
        let resolved = substitute(&tokenize("var(--b)").unwrap(), &vars, 0).unwrap();
        assert_eq!(color(&resolved, false).map(format).unwrap(), "#889098");
        assert!(substitute(&tokenize("var(--loop)").unwrap(), &vars, 0).is_none());
        assert!(substitute(&tokenize("var(--none)").unwrap(), &vars, 0).is_none());
        assert_eq!(
            to_css(&tokenize("color-mix(in srgb, var(--a) 18%, transparent)").unwrap()),
            "color-mix(in srgb, var(--a) 18%, transparent)"
        );
    }
}
