//! `electron.theme-service.test.mjs`, case for case, against the Themes
//! Folder service.
use super::*;
use core::prelude::v1::test;

fn fresh() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().canonicalize().unwrap();
    (dir, path)
}
fn themes(data: &Path) -> PathBuf {
    let root = data.join("themes");
    std::fs::create_dir_all(&root).unwrap();
    root
}
fn write(path: &Path, content: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}
/// `createPackage`: a light Markdown package.
fn package(root: &Path, directory: &str, id: &str, name: &str) {
    write(
        &root.join(directory).join("theme.json"),
        &serde_json::json!({"schemaVersion": 1, "id": id, "name": name, "version": "1.0.0",
            "modes": ["light"], "targets": ["markdown"], "entrypoints": {"markdown": "markdown.css"}})
        .to_string(),
    );
    write(
        &root.join(directory).join("markdown.css"),
        ":root { --po-md-content-color: #222 }",
    );
}
/// `createSingleFilePack`: a dual-mode Application, Markdown and CSV theme.
fn single_file(id: &str, name: &str) -> String {
    format!(
        "@puppyone-theme {{ id: {id}; name: {name}; version: 1.0.0; modes: light dark; }}
@puppyone application {{
  .theme-root {{ --po-accent: #2563eb }}
  .dark .theme-root {{ --po-accent: #60a5fa }}
}}
@puppyone markdown {{
  :root {{ --po-md-content-color: #222 }}
  .dark .theme-root {{ --po-md-content-color: #eee }}
}}
@puppyone csv {{
  .theme-root {{ --po-csv-surface-color: #222 }}
  .dark .theme-root {{ --po-csv-surface-color: #eee }}
}}"
    )
}
fn ids(snapshot: &Snapshot) -> Vec<&str> {
    snapshot.themes.iter().map(|t| t.id.as_str()).collect()
}
fn sources(snapshot: &Snapshot) -> Vec<&str> {
    snapshot
        .diagnostics
        .iter()
        .map(|d| d.source.as_str())
        .collect()
}
/// The values `name` takes in either mode (the dark rules repeat the
/// shared ones).
fn declared(rules: &Option<[Vec<(String, String)>; 2]>, name: &str) -> Vec<String> {
    let mut values: Vec<String> = rules
        .iter()
        .flatten()
        .flatten()
        .filter(|(n, _)| n == name)
        .map(|(_, v)| v.clone())
        .collect();
    values.sort();
    values.dedup();
    values
}

#[test]
fn the_guide_is_installed_once_and_user_themes_are_left_alone() {
    let (_dir, data) = fresh();
    let root = themes(&data);
    let personal = single_file("com.example.personal", "Personal");
    write(&root.join("personal.css"), &personal);
    let service = Service::new(data.clone());
    let snapshot = service.list().unwrap();
    assert_eq!(ids(&snapshot), ["com.example.personal"]);
    let theme = &snapshot.themes[0];
    assert_eq!(
        (theme.name.as_str(), theme.source),
        ("Personal", Source::LocalCss)
    );
    assert_eq!(
        theme.targets,
        [Target::Application, Target::Markdown, Target::Csv]
    );
    let readme = root.join("README.md");
    assert_eq!(std::fs::read_to_string(&readme).unwrap(), GUIDE);
    assert_eq!(
        std::fs::read_to_string(root.join("personal.css")).unwrap(),
        personal
    );
    let css: Vec<_> = std::fs::read_dir(&root)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".css"))
        .collect();
    assert_eq!(css, ["personal.css"]);
    // An edited guide is the person's.
    write(&readme, "# My theme notes\n");
    service.list().unwrap();
    assert_eq!(
        std::fs::read_to_string(&readme).unwrap(),
        "# My theme notes\n"
    );
}

#[test]
fn a_previous_starter_catalog_gets_the_guide_and_keeps_its_themes() {
    let (_dir, data) = fresh();
    let root = themes(&data);
    write(&root.join(".puppyone-starter-themes-v4"), "4\n");
    let mine = "/* keep my theme */\nbody { color: rebeccapurple }\n";
    write(&root.join("forest.css"), mine);
    Service::new(data).list().unwrap();
    assert!(
        std::fs::read_to_string(root.join("README.md"))
            .unwrap()
            .contains("Where this folder belongs")
    );
    assert_eq!(
        std::fs::read_to_string(root.join("forest.css")).unwrap(),
        mine
    );
    assert_eq!(
        std::fs::read_to_string(root.join(".puppyone-theme-guide-v1")).unwrap(),
        "1\n"
    );
}

#[test]
fn the_app_installs_only_the_guide() {
    let (_dir, data) = fresh();
    let snapshot = Service::new(data.clone()).list().unwrap();
    assert_eq!(snapshot, Snapshot::default());
    assert!(
        std::fs::read_to_string(data.join("themes/README.md"))
            .unwrap()
            .contains("Where this folder belongs")
    );
    let shipped = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/themes"));
    let loose_css: Vec<_> = std::fs::read_dir(shipped)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".css") && n != "markdown-defaults.css")
        .collect();
    assert!(loose_css.is_empty(), "{loose_css:?}");
}

#[test]
fn manifest_packages_and_metadata_free_token_themes_are_discovered() {
    let (_dir, data) = fresh();
    let root = themes(&data);
    write(
        &root.join("paper/theme.json"),
        &serde_json::json!({"schemaVersion": 1, "id": "com.example.paper", "name": "Paper",
            "version": "1.0.0", "modes": ["light"], "targets": ["markdown", "csv"],
            "entrypoints": {"markdown": "markdown.css", "csv": "csv.css"}})
        .to_string(),
    );
    write(
        &root.join("paper/markdown.css"),
        ":root { --po-md-content-color: #392f28 }",
    );
    write(
        &root.join("paper/csv.css"),
        ":root { --po-csv-surface-background: #ede4d6 }",
    );
    write(
        &root.join("newsprint.css"),
        ":root { --po-md-content-color: #222 }",
    );
    let snapshot = Service::new(data.clone()).list().unwrap();
    assert!(
        snapshot.diagnostics.is_empty(),
        "{:?}",
        snapshot.diagnostics
    );
    let found: Vec<_> = snapshot
        .themes
        .iter()
        .map(|t| (t.id.as_str(), t.source, t.targets.clone()))
        .collect();
    assert_eq!(
        found,
        [
            (
                "local.css.newsprint",
                Source::LocalCss,
                vec![Target::Markdown]
            ),
            (
                "com.example.paper",
                Source::LocalPackage,
                vec![Target::Markdown, Target::Csv]
            )
        ]
    );
    assert_eq!(
        declared(&snapshot.themes[0].markdown, "--po-md-content-color"),
        ["#222"]
    );
    assert_eq!(
        declared(&snapshot.themes[1].csv, "--po-csv-surface-background"),
        ["#ede4d6"]
    );
    assert!(!format!("{snapshot:?}").contains(&data.display().to_string()));
}

#[test]
fn a_coordinated_single_css_theme_loads_across_its_surfaces() {
    let (_dir, data) = fresh();
    let root = themes(&data);
    write(
        &root.join("forest.css"),
        "@puppyone-theme { id: com.example.forest; name: Forest; version: 1.0.0;
  author: Example Studio; modes: light dark; }
@puppyone application {
  .theme-root { --po-canvas: #f4f8f5; --po-accent: #2f6f52; }
  .dark .theme-root { --po-canvas: #102019; --po-accent: #70b899; }
}
@puppyone markdown {
  :root { --po-md-content-color: #27352f; }
  .dark .theme-root { --po-md-content-color: #d4e2dc; }
}
@puppyone csv {
  .theme-root { --po-csv-surface-color: #27352f; }
  .dark .theme-root { --po-csv-surface-color: #d4e2dc; }
}",
    );
    let snapshot = Service::new(data).list().unwrap();
    assert!(
        snapshot.diagnostics.is_empty(),
        "{:?}",
        snapshot.diagnostics
    );
    let theme = &snapshot.themes[0];
    assert_eq!(
        (
            theme.id.as_str(),
            theme.name.as_str(),
            theme.author.as_deref(),
            theme.version.as_str(),
            theme.source
        ),
        (
            "com.example.forest",
            "Forest",
            Some("Example Studio"),
            "1.0.0",
            Source::LocalCss
        )
    );
    assert_eq!(theme.modes, [Mode::Light, Mode::Dark]);
    assert_eq!(
        theme.targets,
        [Target::Application, Target::Markdown, Target::Csv]
    );
    // `firstPaint`: each mode's canvas.
    let [light, dark] = theme.application.clone().unwrap();
    assert_eq!(
        super::super::palette::project(&light, false)["canvas"],
        "#f4f8f5"
    );
    assert_eq!(
        super::super::palette::project(&dark, true)["canvas"],
        "#102019"
    );
    assert!(declared(&theme.markdown, "--po-md-content-color").contains(&"#d4e2dc".to_owned()));
    assert!(declared(&theme.csv, "--po-csv-surface-color").contains(&"#27352f".to_owned()));
}

/// The one diagnostic a broken theme leaves, without the data path.
fn refused(data: &Path) -> Diagnostic {
    let snapshot = Service::new(data.to_path_buf()).list().unwrap();
    assert!(snapshot.themes.is_empty(), "{:?}", ids(&snapshot));
    let diagnostic = snapshot.diagnostics[0].clone();
    assert!(!diagnostic.message.contains(&data.display().to_string()));
    diagnostic
}

#[test]
fn fonts_cannot_be_injected_directly_or_through_an_import() {
    let (_dir, data) = fresh();
    let root = themes(&data);
    write(&root.join("reader/fonts/reader.woff2"), "font-data");
    write(
        &root.join("reader/theme.css"),
        "@puppyone-theme { id: com.example.reader; name: Reader; version: 1.0.0;
  author: Example Studio; modes: light dark; }
@puppyone application {
  .theme-root { --po-accent: #2f6f52; }
  .dark .theme-root { --po-accent: #70b899; }
}
@puppyone markdown {
  @font-face { font-family: Reader; src: url(\"./fonts/reader.woff2\") format(\"woff2\"); }
  :root { --po-md-content-font: Reader; }
}
@puppyone csv {
  .theme-root { --po-csv-surface-color: #27352f; }
  .dark .theme-root { --po-csv-surface-color: #d4e2dc; }
}",
    );
    let diagnostic = refused(&data);
    assert_eq!(diagnostic.source, "reader");
    assert!(
        diagnostic
            .message
            .contains("Unsupported theme CSS at-rule: @font-face"),
        "{diagnostic:?}"
    );
    // Through an imported stylesheet of a manifest package.
    std::fs::remove_dir_all(root.join("reader")).unwrap();
    write(
        &root.join("reader/theme.json"),
        &serde_json::json!({"schemaVersion": 1, "id": "com.example.reader", "name": "Reader",
            "version": "1.0.0", "modes": ["light"], "targets": ["markdown"],
            "entrypoints": {"markdown": "markdown.css"}})
        .to_string(),
    );
    write(
        &root.join("reader/markdown.css"),
        "@import \"./styles/content.css\";",
    );
    write(
        &root.join("reader/styles/content.css"),
        "@font-face { font-family: Reader; src: url(\"../fonts/reader.woff2\") format(\"woff2\") } :root { --po-md-content-font: Reader }",
    );
    write(&root.join("reader/fonts/reader.woff2"), "font-data");
    let diagnostic = refused(&data);
    assert_eq!(diagnostic.source, "reader");
    assert!(
        diagnostic
            .message
            .contains("Unsupported theme CSS at-rule: @font-face"),
        "{diagnostic:?}"
    );
}

#[test]
fn a_directory_theme_css_needs_metadata_and_theme_json_wins() {
    let (_dir, data) = fresh();
    let root = themes(&data);
    write(&root.join("reader/theme.css"), "body { color: #27352f }");
    assert_eq!(
        refused(&data),
        Diagnostic {
            source: "reader".into(),
            message: "A directory theme.css must contain @puppyone-theme metadata.".into()
        }
    );
    std::fs::remove_dir_all(root.join("reader")).unwrap();
    package(
        &root,
        "reader",
        "com.example.manifest-reader",
        "Manifest Reader",
    );
    write(
        &root.join("reader/theme.css"),
        &single_file("com.example.css-reader", "CSS Reader"),
    );
    let snapshot = Service::new(data).list().unwrap();
    assert!(
        snapshot.diagnostics.is_empty(),
        "{:?}",
        snapshot.diagnostics
    );
    assert_eq!(ids(&snapshot), ["com.example.manifest-reader"]);
    assert_eq!(
        (snapshot.themes[0].name.as_str(), snapshot.themes[0].source),
        ("Manifest Reader", Source::LocalPackage)
    );
}

#[test]
fn links_out_of_a_package_or_the_data_directory_are_refused() {
    use std::os::unix::fs::symlink;
    // A directory's theme.css, a manifest entrypoint and the manifest itself.
    let (_dir, data) = fresh();
    let root = themes(&data);
    write(
        &data.join("outside-theme.css"),
        &single_file("com.example.reader", "Reader"),
    );
    std::fs::create_dir_all(root.join("reader")).unwrap();
    symlink(
        data.join("outside-theme.css"),
        root.join("reader/theme.css"),
    )
    .unwrap();
    let diagnostic = refused(&data);
    assert_eq!(diagnostic.source, "reader");
    assert!(
        diagnostic.message.contains("escapes its package"),
        "{diagnostic:?}"
    );
    std::fs::remove_dir_all(root.join("reader")).unwrap();

    write(
        &root.join("escaped/theme.json"),
        &serde_json::json!({"schemaVersion": 1, "id": "com.example.escaped", "name": "Escaped",
            "version": "1.0.0", "modes": ["light"], "targets": ["markdown"],
            "entrypoints": {"markdown": "markdown.css"}})
        .to_string(),
    );
    write(&data.join("outside.css"), "body { color: red }");
    symlink(data.join("outside.css"), root.join("escaped/markdown.css")).unwrap();
    let diagnostic = refused(&data);
    assert_eq!(diagnostic.source, "escaped");
    assert!(
        diagnostic.message.contains("escapes its package"),
        "{diagnostic:?}"
    );
    std::fs::remove_dir_all(root.join("escaped")).unwrap();

    write(
        &data.join("outside-theme.json"),
        &serde_json::json!({"schemaVersion": 1, "id": "com.example.manifest-link",
            "name": "Manifest Link", "version": "1.0.0", "modes": ["light"],
            "targets": ["markdown"], "entrypoints": {"markdown": "markdown.css"}})
        .to_string(),
    );
    std::fs::create_dir_all(root.join("manifest-link")).unwrap();
    symlink(
        data.join("outside-theme.json"),
        root.join("manifest-link/theme.json"),
    )
    .unwrap();
    let diagnostic = refused(&data);
    assert!(
        diagnostic.message.contains("escapes its package"),
        "{diagnostic:?}"
    );

    // The themes folder itself redirected out of the data directory.
    let (_dir, data) = fresh();
    let outside = tempfile::tempdir().unwrap();
    symlink(outside.path(), data.join("themes")).unwrap();
    let error = Service::new(data).list().unwrap_err();
    assert!(error.contains("theme root"), "{error}");
    assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[test]
fn invalid_themes_are_isolated_and_duplicates_reported_in_order() {
    let (_dir, data) = fresh();
    let root = themes(&data);
    package(&root, "a-first", "com.example.duplicate", "First");
    package(&root, "b-second", "com.example.duplicate", "Second");
    write(&root.join("broken/theme.json"), "{");
    write(
        &root.join("remote.css"),
        "body { background: url(\"https://example.com/pixel.png\") }",
    );
    let snapshot = Service::new(data.clone()).list().unwrap();
    assert_eq!(ids(&snapshot), ["com.example.duplicate"]);
    assert_eq!(snapshot.themes[0].name, "First");
    assert_eq!(sources(&snapshot), ["b-second", "broken", "remote.css"]);
    assert!(
        snapshot
            .diagnostics
            .iter()
            .all(|d| !d.message.contains(&data.display().to_string()))
    );
}

#[test]
fn new_themes_are_revealed_and_the_folder_is_exactly_the_data_directorys() {
    let (_dir, data) = fresh();
    let service = Service::new(data.clone());
    // "Open themes folder" opens this folder and no other.
    assert_eq!(service.ensure_root().unwrap(), data.join("themes"));
    assert_eq!(service.directory(), data.join("themes"));
    let first = service.create().unwrap();
    let second = service.create().unwrap();
    assert_eq!(
        (first.theme_id.as_str(), second.theme_id.as_str()),
        ("local.user.custom-theme", "local.user.custom-theme-2")
    );
    // What is revealed is each new theme.css itself.
    assert_eq!(first.path, data.join("themes/custom-theme/theme.css"));
    assert_eq!(second.path, data.join("themes/custom-theme-2/theme.css"));
    let first_css = std::fs::read_to_string(&first.path).unwrap();
    assert!(first_css.contains("id: local.user.custom-theme;"));
    assert!(first_css.contains(".dark .theme-root"));
    assert!(
        std::fs::read_to_string(&second.path)
            .unwrap()
            .contains("name: Custom Theme 2;")
    );
}

#[test]
fn the_starter_markdown_profile_is_complete_and_edits_load_without_a_rewrite() {
    let (_dir, data) = fresh();
    let service = Service::new(data);
    let created = service.create().unwrap();
    let source = std::fs::read_to_string(&created.path).unwrap();
    let markdown = source
        .split("@puppyone markdown {")
        .nth(1)
        .and_then(|rest| rest.split("\n}\n").next())
        .unwrap();
    assert_eq!(markdown.trim(), compiler::DEFAULT_MARKDOWN_CSS.trim());
    let edited = source
        .replace(
            "--po-md-inline-code-background: transparent;",
            "--po-md-inline-code-background: #e1d2c3;",
        )
        .replace(
            "--po-md-code-font: \"Geist Mono\"",
            "--po-md-code-font: \"Example Mono\"",
        );
    assert_ne!(edited, source);
    std::fs::write(&created.path, &edited).unwrap();
    let snapshot = service.list().unwrap();
    assert!(
        snapshot.diagnostics.is_empty(),
        "{:?}",
        snapshot.diagnostics
    );
    let theme = &snapshot.themes[0];
    assert_eq!(
        declared(&theme.markdown, "--po-md-inline-code-background"),
        ["#e1d2c3"]
    );
    assert!(
        declared(&theme.markdown, "--po-md-code-font")
            .iter()
            .all(|v| v.starts_with("\"Example Mono\""))
    );
    assert_eq!(std::fs::read_to_string(&created.path).unwrap(), edited);
}

#[test]
fn the_legacy_custom_css_folder_stays_and_its_id_is_reserved() {
    let (_dir, data) = fresh();
    let root = themes(&data);
    write(
        &root.join("puppyone-custom-css/markdown.css"),
        "body { color: teal }",
    );
    package(
        &root,
        "aaa-custom-css-impostor",
        LEGACY_CUSTOM_THEME_ID,
        "Impostor",
    );
    let snapshot = Service::new(data).list().unwrap();
    assert!(!ids(&snapshot).contains(&LEGACY_CUSTOM_THEME_ID));
    assert_eq!(
        std::fs::read_to_string(root.join("puppyone-custom-css/markdown.css")).unwrap(),
        "body { color: teal }"
    );
    assert!(snapshot.diagnostics.iter().any(|d| {
        d.source == "aaa-custom-css-impostor"
            && d.message.contains("reserved for legacy compatibility")
    }));
}

#[test]
fn imports_and_embedded_assets_are_bounded() {
    let (_dir, data) = fresh();
    let root = themes(&data);
    package(&root, "oversized", "com.example.oversized", "Oversized");
    write(
        &root.join("oversized/markdown.css"),
        "@import \"a.css\"; @import \"b.css\"; @import \"c.css\";",
    );
    let comment = format!("/*{}*/", "x".repeat(1_500_000));
    for name in ["a.css", "b.css", "c.css"] {
        write(&root.join("oversized").join(name), &comment);
    }
    let diagnostic = refused(&data);
    assert!(
        diagnostic.message.contains("aggregate CSS size limit"),
        "{diagnostic:?}"
    );
    std::fs::remove_dir_all(root.join("oversized")).unwrap();

    package(
        &root,
        "expanded-asset",
        "com.example.expanded-asset",
        "Expanded Asset",
    );
    std::fs::write(
        root.join("expanded-asset/background.png"),
        vec![0u8; 5 * 1024 * 1024],
    )
    .unwrap();
    write(
        &root.join("expanded-asset/markdown.css"),
        ":root { --po-md-content-font: url(\"./background.png\") }
:root { --po-md-heading-color: url(\"./background.png\") }
:root { --po-md-link-color: url(\"./background.png\") }",
    );
    let diagnostic = refused(&data);
    assert!(
        diagnostic
            .message
            .contains("embedded asset expansion limit"),
        "{diagnostic:?}"
    );
}
