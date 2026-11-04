//! TeX as Unicode text: the native stand-in for KaTeX. Greek letters,
//! operators, relations and arrows become their characters, `^` and `_`
//! become superscript and subscript characters where Unicode has them,
//! `\frac{a}{b}` reads `a⁄b`, `\sqrt{x}` reads `√x`, and `\mathbb{R}` reads
//! `ℝ`. What has no plain-text form (matrices, stacked limits) keeps its
//! source words, so nothing a formula says is lost.

fn symbol(name: &str) -> Option<&'static str> {
    Some(match name {
        "alpha" => "α",
        "beta" => "β",
        "gamma" => "γ",
        "delta" => "δ",
        "epsilon" => "ϵ",
        "varepsilon" => "ε",
        "zeta" => "ζ",
        "eta" => "η",
        "theta" => "θ",
        "vartheta" => "ϑ",
        "iota" => "ι",
        "kappa" => "κ",
        "lambda" => "λ",
        "mu" => "μ",
        "nu" => "ν",
        "xi" => "ξ",
        "pi" => "π",
        "varpi" => "ϖ",
        "rho" => "ρ",
        "sigma" => "σ",
        "varsigma" => "ς",
        "tau" => "τ",
        "upsilon" => "υ",
        "phi" => "ϕ",
        "varphi" => "φ",
        "chi" => "χ",
        "psi" => "ψ",
        "omega" => "ω",
        "Gamma" => "Γ",
        "Delta" => "Δ",
        "Theta" => "Θ",
        "Lambda" => "Λ",
        "Xi" => "Ξ",
        "Pi" => "Π",
        "Sigma" => "Σ",
        "Upsilon" => "Υ",
        "Phi" => "Φ",
        "Psi" => "Ψ",
        "Omega" => "Ω",
        "sum" => "∑",
        "prod" => "∏",
        "coprod" => "∐",
        "int" => "∫",
        "iint" => "∬",
        "iiint" => "∭",
        "oint" => "∮",
        "infty" => "∞",
        "partial" => "∂",
        "nabla" => "∇",
        "forall" => "∀",
        "exists" => "∃",
        "nexists" => "∄",
        "emptyset" | "varnothing" => "∅",
        "in" => "∈",
        "notin" => "∉",
        "ni" => "∋",
        "subset" => "⊂",
        "supset" => "⊃",
        "subseteq" => "⊆",
        "supseteq" => "⊇",
        "cup" => "∪",
        "cap" => "∩",
        "bigcup" => "⋃",
        "bigcap" => "⋂",
        "setminus" => "∖",
        "land" | "wedge" => "∧",
        "lor" | "vee" => "∨",
        "lnot" | "neg" => "¬",
        "times" => "×",
        "div" => "÷",
        "cdot" => "·",
        "cdots" => "⋯",
        "ldots" | "dots" => "…",
        "vdots" => "⋮",
        "ddots" => "⋱",
        "pm" => "±",
        "mp" => "∓",
        "ast" => "∗",
        "star" => "⋆",
        "circ" => "∘",
        "bullet" => "∙",
        "oplus" => "⊕",
        "otimes" => "⊗",
        "leq" | "le" => "≤",
        "geq" | "ge" => "≥",
        "neq" | "ne" => "≠",
        "approx" => "≈",
        "equiv" => "≡",
        "sim" => "∼",
        "simeq" => "≃",
        "cong" => "≅",
        "propto" => "∝",
        "ll" => "≪",
        "gg" => "≫",
        "perp" => "⊥",
        "parallel" => "∥",
        "mid" => "∣",
        "to" | "rightarrow" => "→",
        "leftarrow" | "gets" => "←",
        "leftrightarrow" => "↔",
        "Rightarrow" | "implies" => "⇒",
        "Leftarrow" => "⇐",
        "Leftrightarrow" | "iff" => "⇔",
        "mapsto" => "↦",
        "uparrow" => "↑",
        "downarrow" => "↓",
        "langle" => "⟨",
        "rangle" => "⟩",
        "lceil" => "⌈",
        "rceil" => "⌉",
        "lfloor" => "⌊",
        "rfloor" => "⌋",
        "angle" => "∠",
        "triangle" => "△",
        "degree" => "°",
        "prime" => "′",
        "hbar" => "ℏ",
        "ell" => "ℓ",
        "Re" => "ℜ",
        "Im" => "ℑ",
        "aleph" => "ℵ",
        "therefore" => "∴",
        "because" => "∵",
        "quad" => "\u{2003}",
        "qquad" => "\u{2003}\u{2003}",
        "," | ":" | ";" | " " => "\u{2009}",
        "!" => "",
        "{" | "lbrace" => "{",
        "}" | "rbrace" => "}",
        "%" => "%",
        "$" => "$",
        "#" => "#",
        "&" => "&",
        "_" => "_",
        "|" | "Vert" => "‖",
        "vert" => "|",
        "backslash" => "\\",
        _ => return None,
    })
}
/// Operator names that print as words.
fn operator(name: &str) -> bool {
    matches!(
        name,
        "sin"
            | "cos"
            | "tan"
            | "log"
            | "ln"
            | "exp"
            | "lim"
            | "max"
            | "min"
            | "sup"
            | "inf"
            | "det"
            | "dim"
            | "arg"
            | "deg"
            | "gcd"
            | "sec"
            | "csc"
            | "cot"
            | "sinh"
            | "cosh"
            | "tanh"
            | "mod"
            | "Pr"
            | "ker"
            | "hom"
    )
}
fn superscript(c: char) -> Option<char> {
    Some(match c {
        '0' => '⁰',
        '1' => '¹',
        '2' => '²',
        '3' => '³',
        '4' => '⁴',
        '5' => '⁵',
        '6' => '⁶',
        '7' => '⁷',
        '8' => '⁸',
        '9' => '⁹',
        '+' => '⁺',
        '-' | '−' => '⁻',
        '=' => '⁼',
        '(' => '⁽',
        ')' => '⁾',
        'n' => 'ⁿ',
        'i' => 'ⁱ',
        'a' => 'ᵃ',
        'b' => 'ᵇ',
        'c' => 'ᶜ',
        'd' => 'ᵈ',
        'e' => 'ᵉ',
        'f' => 'ᶠ',
        'g' => 'ᵍ',
        'h' => 'ʰ',
        'j' => 'ʲ',
        'k' => 'ᵏ',
        'l' => 'ˡ',
        'm' => 'ᵐ',
        'o' => 'ᵒ',
        'p' => 'ᵖ',
        'r' => 'ʳ',
        's' => 'ˢ',
        't' => 'ᵗ',
        'u' => 'ᵘ',
        'v' => 'ᵛ',
        'w' => 'ʷ',
        'x' => 'ˣ',
        'y' => 'ʸ',
        'z' => 'ᶻ',
        'T' => 'ᵀ',
        '′' => '′',
        ' ' => ' ',
        _ => return None,
    })
}
fn subscript(c: char) -> Option<char> {
    Some(match c {
        '0' => '₀',
        '1' => '₁',
        '2' => '₂',
        '3' => '₃',
        '4' => '₄',
        '5' => '₅',
        '6' => '₆',
        '7' => '₇',
        '8' => '₈',
        '9' => '₉',
        '+' => '₊',
        '-' | '−' => '₋',
        '=' => '₌',
        '(' => '₍',
        ')' => '₎',
        'a' => 'ₐ',
        'e' => 'ₑ',
        'h' => 'ₕ',
        'i' => 'ᵢ',
        'j' => 'ⱼ',
        'k' => 'ₖ',
        'l' => 'ₗ',
        'm' => 'ₘ',
        'n' => 'ₙ',
        'o' => 'ₒ',
        'p' => 'ₚ',
        'r' => 'ᵣ',
        's' => 'ₛ',
        't' => 'ₜ',
        'u' => 'ᵤ',
        'v' => 'ᵥ',
        'x' => 'ₓ',
        ' ' => ' ',
        _ => return None,
    })
}
fn blackboard(c: char) -> char {
    match c {
        'C' => 'ℂ',
        'H' => 'ℍ',
        'N' => 'ℕ',
        'P' => 'ℙ',
        'Q' => 'ℚ',
        'R' => 'ℝ',
        'Z' => 'ℤ',
        'A'..='Z' => char::from_u32(0x1D538 + (c as u32 - 'A' as u32)).unwrap_or(c),
        _ => c,
    }
}

struct Reader {
    chars: Vec<char>,
    at: usize,
}
impl Reader {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.at).copied()
    }
    fn next(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.at += 1;
        Some(c)
    }
    /// `{…}` or one token, converted.
    fn group(&mut self) -> String {
        while self.peek() == Some(' ') {
            self.at += 1;
        }
        match self.peek() {
            Some('{') => {
                self.at += 1;
                let mut depth = 1;
                let start = self.at;
                while let Some(c) = self.next() {
                    match c {
                        '{' => depth += 1,
                        '}' => {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            }
                        }
                        '\\' => {
                            self.at += 1;
                        }
                        _ => {}
                    }
                }
                let end = if depth == 0 { self.at - 1 } else { self.at };
                let inner: String = self.chars[start..end.max(start)].iter().collect();
                convert(&inner)
            }
            Some('\\') => {
                self.at += 1;
                let name = self.command();
                command_text(&name, self)
            }
            Some(c) => {
                self.at += 1;
                c.to_string()
            }
            None => String::new(),
        }
    }
    fn command(&mut self) -> String {
        let mut name = String::new();
        while let Some(c) = self.peek() {
            if c.is_ascii_alphabetic() {
                name.push(c);
                self.at += 1;
            } else {
                break;
            }
        }
        if name.is_empty()
            && let Some(c) = self.next()
        {
            name.push(c);
        }
        name
    }
}
fn script(text: &str, map: fn(char) -> Option<char>, marker: char) -> String {
    let text = text.replace(' ', "");
    match text.chars().map(map).collect::<Option<String>>() {
        Some(mapped) => mapped,
        None if text.chars().count() == 1 => format!("{marker}{text}"),
        None => format!("{marker}({text})"),
    }
}
fn command_text(name: &str, reader: &mut Reader) -> String {
    match name {
        "frac" | "dfrac" | "tfrac" => {
            let (a, b) = (reader.group(), reader.group());
            let wrap = |s: String| {
                if s.chars().count() > 1 && s.chars().any(|c| "+-−×·= ".contains(c)) {
                    format!("({s})")
                } else {
                    s
                }
            };
            format!("{}⁄{}", wrap(a), wrap(b))
        }
        "sqrt" => {
            let index = if reader.peek() == Some('[') {
                reader.at += 1;
                let start = reader.at;
                while reader.peek().is_some_and(|c| c != ']') {
                    reader.at += 1;
                }
                let index: String = reader.chars[start..reader.at].iter().collect();
                reader.at += 1;
                script(&convert(&index), superscript, '^')
            } else {
                String::new()
            };
            let inner = reader.group();
            if inner.chars().count() > 1 {
                format!("{index}√({inner})")
            } else {
                format!("{index}√{inner}")
            }
        }
        "mathbb" => reader.group().chars().map(blackboard).collect(),
        "mathrm" | "text" | "textrm" | "mathit" | "mathbf" | "boldsymbol" | "mathsf" | "mathtt"
        | "operatorname" | "textbf" | "textit" | "mathcal" | "mathscr" => reader.group(),
        "overline" | "bar" => reader
            .group()
            .chars()
            .flat_map(|c| [c, '\u{0305}'])
            .collect(),
        "hat" | "widehat" => format!("{}\u{0302}", reader.group()),
        "tilde" | "widetilde" => format!("{}\u{0303}", reader.group()),
        "vec" => format!("{}\u{20D7}", reader.group()),
        "dot" => format!("{}\u{0307}", reader.group()),
        "left" | "right" | "big" | "Big" | "bigg" | "Bigg" | "displaystyle" | "textstyle"
        | "limits" | "nolimits" => String::new(),
        "begin" | "end" => {
            reader.group();
            String::new()
        }
        "\\" => "; ".into(),
        name if operator(name) => name.into(),
        name => symbol(name)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("\\{name}")),
    }
}

/// `source` as text.
pub fn convert(source: &str) -> String {
    let mut reader = Reader {
        chars: source.chars().collect(),
        at: 0,
    };
    let mut out = String::new();
    while let Some(c) = reader.next() {
        match c {
            '\\' => {
                let name = reader.command();
                out.push_str(&command_text(&name, &mut reader));
            }
            '^' => {
                let text = reader.group();
                out.push_str(&script(&text, superscript, '^'));
            }
            '_' => {
                let text = reader.group();
                out.push_str(&script(&text, subscript, '_'));
            }
            '{' | '}' => {}
            '&' => out.push(' '),
            '~' => out.push('\u{00A0}'),
            '-' => out.push('−'),
            '*' => out.push('∗'),
            '\'' => out.push('′'),
            c if c.is_whitespace() => {
                if !out.ends_with(' ') && !out.is_empty() {
                    out.push(' ');
                }
            }
            c => out.push(c),
        }
    }
    // Binary operators breathe.
    let mut spaced = String::new();
    for c in out.trim().chars() {
        if "=+−±×≤≥≠≈→⇒".contains(c) && !spaced.ends_with(' ') && !spaced.is_empty()
        {
            spaced.push(' ');
        }
        spaced.push(c);
        if "=+±×≤≥≠≈→⇒".contains(c) {
            spaced.push(' ');
        }
    }
    spaced
        .split(' ')
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::convert;
    use core::prelude::v1::test;

    #[test]
    fn formulas_read_as_text() {
        assert_eq!(convert(r"E = mc^2"), "E = mc²");
        assert_eq!(convert(r"\alpha_i + \beta^{n+1}"), "αᵢ + βⁿ⁺¹");
        assert_eq!(convert(r"\frac{a+b}{2}"), "(a + b)⁄2");
        assert_eq!(convert(r"\sqrt{x}"), "√x");
        assert_eq!(convert(r"x \in \mathbb{R}"), "x ∈ ℝ");
        assert_eq!(convert(r"\sum_{i=1}^{n} i"), "∑ᵢ₌₁ⁿ i");
        assert_eq!(convert(r"\sin \theta \leq 1"), "sin θ ≤ 1");
        assert_eq!(convert(r"\unknown"), r"\unknown");
    }
}
