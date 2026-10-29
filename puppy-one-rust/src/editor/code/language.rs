//! `editor/code/codeLanguageSupport.ts`: explicit language wins over the name,
//! except the product's TSX/JSX refinements. Unknown explicit IDs stay plain.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Language(pub &'static str);

impl Language {
    pub fn resolve(language: Option<&str>, name: &str) -> Self {
        let value = language.unwrap_or("").trim().to_ascii_lowercase();
        let explicit = match value.as_str() {
            "" => None,
            "js" => Some("javascript"),
            "ts" => Some("typescript"),
            "py" => Some("python"),
            "bash" | "zsh" | "sh" => Some("shell"),
            "yml" => Some("yaml"),
            "text" | "txt" => Some("plaintext"),
            value => Some(
                [
                    "css",
                    "html",
                    "javascript",
                    "json",
                    "jsx",
                    "less",
                    "plaintext",
                    "python",
                    "scss",
                    "shell",
                    "sql",
                    "toml",
                    "tsx",
                    "typescript",
                    "xml",
                    "yaml",
                ]
                .into_iter()
                .find(|known| *known == value)
                .unwrap_or("plaintext"),
            ),
        };
        let name = name.to_ascii_lowercase();
        if matches!(explicit, None | Some("typescript")) && name.ends_with(".tsx") {
            return Self("tsx");
        }
        if matches!(explicit, None | Some("javascript")) && name.ends_with(".jsx") {
            return Self("jsx");
        }
        if let Some(language) = explicit {
            return Self(language);
        }
        Self(
            match name.rsplit_once('.').map(|(_, extension)| extension) {
                Some("ts" | "cts" | "mts") => "typescript",
                Some("js" | "cjs" | "es6" | "mjs" | "pac") => "javascript",
                Some("py" | "pyi" | "pyw" | "pyx") => "python",
                Some("yaml" | "yml") => "yaml",
                Some("sh" | "bash" | "zsh") => "shell",
                Some("toml") => "toml",
                Some("sql") => "sql",
                Some("css") => "css",
                Some("scss" | "sass") => "scss",
                Some("less") => "less",
                Some("html" | "htm" | "xhtml") => "html",
                Some("xml" | "svg") => "xml",
                Some("json" | "jsonl") => "json",
                _ => "plaintext",
            },
        )
    }
    pub fn tab_size(self) -> usize {
        if self.0 == "python" { 4 } else { 2 }
    }
    pub fn grammar(self) -> Option<&'static str> {
        Some(match self.0 {
            "plaintext" => return None,
            "jsx" => "javascript",
            "shell" => "bash",
            "scss" | "less" => "css",
            "xml" => "html",
            language => language,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::Language;
    #[test]
    fn languages_and_indent_match_current_ts() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/editor/code.json")).unwrap();
        for case in fixture["languageCases"].as_array().unwrap() {
            let result =
                Language::resolve(case["language"].as_str(), case["name"].as_str().unwrap());
            assert_eq!(result.0, case["expected"].as_str().unwrap(), "{case}");
            assert_eq!(
                result.tab_size(),
                case["tabSize"].as_u64().unwrap() as usize,
                "{case}"
            );
            assert_eq!(
                " ".repeat(result.tab_size()),
                case["indent"].as_str().unwrap(),
                "{case}"
            );
        }
    }
}
