//! `project-catalog.mjs`: the templates that ship with the app. "Getting
//! started" gives a new project its one guide, in the app's language
//! (`assets/templates`, imported by `tools/import-templates.py`); file
//! names stay the same in every language.
use super::Plan;

/// `GETTING_STARTED_TEMPLATE_ID`.
#[cfg(test)]
pub const GETTING_STARTED: &str = "puppyone.project.getting-started";
const PATH: &str = "Getting Started.md";
const LOCALES: [(&str, &str); 8] = [
    (
        "de",
        include_str!("../../../assets/templates/de/getting-started.md"),
    ),
    (
        "en",
        include_str!("../../../assets/templates/en/getting-started.md"),
    ),
    (
        "es",
        include_str!("../../../assets/templates/es/getting-started.md"),
    ),
    (
        "fr",
        include_str!("../../../assets/templates/fr/getting-started.md"),
    ),
    (
        "ja",
        include_str!("../../../assets/templates/ja/getting-started.md"),
    ),
    (
        "ko",
        include_str!("../../../assets/templates/ko/getting-started.md"),
    ),
    (
        "pt-BR",
        include_str!("../../../assets/templates/pt-BR/getting-started.md"),
    ),
    (
        "zh-Hans",
        include_str!("../../../assets/templates/zh-Hans/getting-started.md"),
    ),
];

/// `resolveProjectTemplate` for Getting started: the whole template in one
/// language — `locale` when it has one, else English.
pub fn getting_started(locale: &str) -> Plan {
    let content = LOCALES
        .iter()
        .find(|(code, _)| *code == locale)
        .or_else(|| LOCALES.iter().find(|(code, _)| *code == "en"))
        .map(|(_, content)| *content)
        .unwrap_or_default();
    Plan {
        files: vec![(PATH.into(), content.as_bytes().to_vec())],
        initial_open: Some(PATH.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// The embedded files are the manifest's, language by language.
    #[test]
    fn getting_started_matches_its_manifest() {
        let manifest: serde_json::Value = serde_json::from_str(include_str!(
            "../../../assets/templates/getting-started.manifest.json"
        ))
        .unwrap();
        assert_eq!(manifest["id"], GETTING_STARTED);
        assert_eq!(manifest["initialOpenPath"], PATH);
        assert_eq!(manifest["files"][0]["path"], PATH);
        let locales: Vec<&str> = manifest["locales"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l.as_str().unwrap())
            .collect();
        assert_eq!(locales, LOCALES.map(|(code, _)| code));
        for code in locales {
            let (_, digest) = super::super::validate(&getting_started(code)).unwrap();
            assert_eq!(manifest["digests"][code], digest, "{code}");
        }
        assert_eq!(getting_started("xx"), getting_started("en"));
    }
}
