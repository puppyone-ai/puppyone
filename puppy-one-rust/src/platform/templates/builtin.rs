//! `project-catalog.mjs`: the templates that ship with the app. "Getting
//! started" gives a new project its guide and three samples (a table, a
//! page and a whiteboard), all in the app's language (`assets/templates`,
//! imported by `tools/import-templates.py`); file names stay the same in
//! every language. Its manifest decides which files a language uses, and
//! the content must match the manifest's digest for that language.
use super::Plan;

/// `GETTING_STARTED_TEMPLATE_ID`.
pub const GETTING_STARTED: &str = "puppyone.project.getting-started";
/// The Getting started version this app creates (`OnboardingProjectEntryDialog`).
pub const GETTING_STARTED_VERSION: u64 = 2;
const MANIFEST: &str = include_str!("../../../assets/templates/getting-started.manifest.json");

/// Every embedded content file, by its manifest source path.
macro_rules! sources {
    ($($locale:literal),*) => {
        &[$(
            (concat!($locale, "/getting-started.md"),
                include_bytes!(concat!("../../../assets/templates/", $locale, "/getting-started.md")).as_slice()),
            (concat!($locale, "/formats.csv"),
                include_bytes!(concat!("../../../assets/templates/", $locale, "/formats.csv")).as_slice()),
            (concat!($locale, "/how-it-works.html"),
                include_bytes!(concat!("../../../assets/templates/", $locale, "/how-it-works.html")).as_slice()),
            (concat!($locale, "/workspace-map.excalidraw"),
                include_bytes!(concat!("../../../assets/templates/", $locale, "/workspace-map.excalidraw")).as_slice()),
        )*]
    };
}
const SOURCES: &[(&str, &[u8])] = sources!("de", "en", "es", "fr", "ja", "ko", "pt-BR", "zh-Hans");

/// `resolveProjectTemplate` for Getting started at `version`: the whole
/// template in one language, `locale` when it has one, else the default.
/// Another version, or content that is not the manifest's, is refused.
pub fn getting_started(locale: &str, version: u64) -> Result<Plan, String> {
    let manifest: serde_json::Value = serde_json::from_str(MANIFEST).map_err(|e| e.to_string())?;
    if manifest["schemaVersion"] != 1
        || manifest["scope"] != "project"
        || manifest["id"] != GETTING_STARTED
        || manifest["version"] != version
    {
        return Err("Unsupported project template version.".into());
    }
    let locales = manifest["locales"].as_array().cloned().unwrap_or_default();
    let resolved = if locales.iter().any(|l| l == locale) {
        locale
    } else {
        manifest["defaultLocale"].as_str().unwrap_or("en")
    };
    let mut files = Vec::new();
    for file in manifest["files"].as_array().into_iter().flatten() {
        let (Some(path), Some(source)) =
            (file["path"].as_str(), file["sources"][resolved].as_str())
        else {
            return Err("Unsupported project template.".into());
        };
        let content = SOURCES
            .iter()
            .find(|(name, _)| *name == source)
            .map(|(_, bytes)| bytes.to_vec())
            .ok_or("Unsupported project template.")?;
        files.push((path.to_owned(), content));
    }
    let plan = Plan {
        files,
        initial_open: manifest["initialOpenPath"].as_str().map(str::to_owned),
    };
    let (_, digest) = super::validate(&plan)?;
    if manifest["digests"][resolved] != digest.as_str() {
        return Err("The built-in template content does not match its manifest.".into());
    }
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// Every language resolves to the manifest's four files, whose
    /// content is the manifest's; another version is refused.
    #[test]
    fn getting_started_is_its_manifest_in_every_language() {
        let manifest: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
        assert_eq!(manifest["version"], GETTING_STARTED_VERSION);
        for locale in manifest["locales"].as_array().unwrap() {
            let plan = getting_started(locale.as_str().unwrap(), GETTING_STARTED_VERSION).unwrap();
            let paths: Vec<&str> = plan.files.iter().map(|(p, _)| p.as_str()).collect();
            assert_eq!(
                paths,
                [
                    "Getting Started.md",
                    "Formats.csv",
                    "How It Works.html",
                    "Workspace Map.excalidraw"
                ]
            );
            assert_eq!(plan.initial_open.as_deref(), Some("Getting Started.md"));
        }
        assert_eq!(
            getting_started("xx", GETTING_STARTED_VERSION),
            getting_started("en", GETTING_STARTED_VERSION)
        );
        assert!(getting_started("en", 1).is_err());
        // The sample board is one the whiteboard opens.
        let plan = getting_started("en", GETTING_STARTED_VERSION).unwrap();
        let board: serde_json::Value = serde_json::from_slice(&plan.files[3].1).unwrap();
        assert_eq!(
            (board["type"].as_str(), board["version"].as_u64()),
            (Some("excalidraw"), Some(2))
        );
    }
}
