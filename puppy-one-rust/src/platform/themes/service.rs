//! The Themes Folder (`theme-service.mjs`): `<data dir>/themes` holds
//! installed Sub Themes as single `.css` files, directories with a
//! self-describing `theme.css`, or `theme.json` packages. Listing validates
//! every entry and reports the rejected ones; the product's `+` action writes
//! a starter `custom-theme/theme.css`.
use super::{
    compiler::{self, Loader},
    contract::{self, Mode, Target},
    css,
};
use std::{
    io,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

const MAX_THEME_ENTRIES: usize = 200;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_CSS_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ASSET_BYTES: u64 = 8 * 1024 * 1024;
const MAX_THEME_CSS_BYTES: usize = 4 * 1024 * 1024;
const MAX_THEME_ASSET_BYTES: u64 = 8 * 1024 * 1024;
const MAX_THEME_COMPILED_BYTES: usize = 16 * 1024 * 1024;
const MAX_THEME_IMPORTS: usize = 64;
const LEGACY_CUSTOM_THEME_DIRECTORY: &str = "puppyone-custom-css";
pub const LEGACY_CUSTOM_THEME_ID: &str = "local.puppyone.custom-css";
const THEME_GUIDE_MARKER: &str = ".puppyone-theme-guide-v1";
const THEME_GUIDE_README: &str = "README.md";
const CUSTOM_THEME_DIRECTORY: &str = "custom-theme";
/// `electron/themes/README.md`, copied into the folder once.
pub const GUIDE: &str = include_str!("../../../assets/themes/README.md");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    LocalCss,
    LocalPackage,
}
impl Source {
    #[cfg(test)]
    pub fn id(self) -> &'static str {
        match self {
            Self::LocalCss => "local-css",
            Self::LocalPackage => "local-package",
        }
    }
}

/// An accepted installed theme.
#[derive(Clone, Debug, PartialEq)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub modes: Vec<Mode>,
    pub targets: Vec<Target>,
    pub compatible_root_theme_ids: Vec<String>,
    pub source: Source,
    /// The Application target's root declarations in cascade order:
    /// `[light, dark]` (dark also carries the shared rules). Conditional
    /// (`@media`, `@supports`) rules are not evaluated natively.
    pub application: Option<[Vec<(String, String)>; 2]>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagnostic {
    pub source: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Snapshot {
    pub themes: Vec<Theme>,
    pub diagnostics: Vec<Diagnostic>,
}

pub struct Created {
    pub theme_id: String,
    /// The new `theme.css`, revealed in Finder.
    pub path: PathBuf,
}

/// One queue per process, like the product's `createThemeQueue` /
/// `guideInstallQueue`.
static QUEUE: Mutex<()> = Mutex::new(());

pub struct Service {
    data_dir: PathBuf,
}

impl Service {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }
    pub fn directory(&self) -> PathBuf {
        self.data_dir.join("themes")
    }
    /// Create the folder (inside the data directory, never a link out of it)
    /// and install the guide once.
    pub fn ensure_root(&self) -> Result<PathBuf, String> {
        let message = |e: io::Error| e.to_string();
        std::fs::create_dir_all(&self.data_dir).map_err(message)?;
        let data = std::fs::canonicalize(&self.data_dir).map_err(message)?;
        let themes = self.directory();
        std::fs::create_dir_all(&themes).map_err(message)?;
        let root = std::fs::canonicalize(&themes).map_err(message)?;
        if root != data.join("themes") {
            return Err("The theme root must remain inside the user-data directory.".into());
        }
        let _queue = QUEUE.lock().unwrap_or_else(|p| p.into_inner());
        if std::fs::symlink_metadata(root.join(THEME_GUIDE_MARKER)).is_err() {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(root.join(THEME_GUIDE_README))
            {
                Ok(mut file) => {
                    io::Write::write_all(&mut file, GUIDE.as_bytes()).map_err(message)?
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.to_string()),
            }
            write_atomic(&root, THEME_GUIDE_MARKER, "1\n").map_err(message)?;
        }
        Ok(root)
    }
    /// `listThemes`.
    pub fn list(&self) -> Result<Snapshot, String> {
        let root = self.ensure_root()?;
        let mut entries: Vec<(String, std::fs::FileType)> = std::fs::read_dir(&root)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .filter_map(|e| {
                Some((
                    e.file_name().to_string_lossy().into_owned(),
                    e.file_type().ok()?,
                ))
            })
            .filter(|(_, kind)| !kind.is_symlink())
            .collect();
        entries.sort_by(|a, b| locale_compare(&a.0, &b.0));
        entries.truncate(MAX_THEME_ENTRIES);
        let mut snapshot = Snapshot::default();
        for (name, kind) in entries {
            if kind.is_dir() && name == LEGACY_CUSTOM_THEME_DIRECTORY {
                continue;
            }
            let loaded = if kind.is_file() && name.to_lowercase().ends_with(".css") {
                load_standalone(&root, &name, false, Source::LocalCss).map(Some)
            } else if kind.is_dir() {
                load_directory(&root.join(&name)).map(Some)
            } else {
                Ok(None)
            };
            let result = loaded.and_then(|theme| match theme {
                Some(theme) if snapshot.themes.iter().any(|t| t.id == theme.id) => {
                    Err(format!("Duplicate theme id: {}.", theme.id))
                }
                other => Ok(other),
            });
            match result {
                Ok(Some(theme)) => snapshot.themes.push(theme),
                Ok(None) => {}
                Err(message) => snapshot.diagnostics.push(Diagnostic {
                    source: name,
                    message: sanitize(&message, &root),
                }),
            }
        }
        Ok(snapshot)
    }
    /// `createTheme`: the first free `custom-theme[-n]/theme.css`.
    pub fn create(&self) -> Result<Created, String> {
        let root = self.ensure_root()?;
        let _queue = QUEUE.lock().unwrap_or_else(|p| p.into_inner());
        for index in 1..=MAX_THEME_ENTRIES {
            let directory = if index == 1 {
                CUSTOM_THEME_DIRECTORY.to_owned()
            } else {
                format!("{CUSTOM_THEME_DIRECTORY}-{index}")
            };
            let package = root.join(&directory);
            match std::fs::create_dir(&package) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(node_error(&e, "mkdir", &package)),
            }
            let theme_id = format!("local.user.{directory}");
            let name = if index == 1 {
                "Custom Theme".to_owned()
            } else {
                format!("Custom Theme {index}")
            };
            let path = package.join("theme.css");
            let written = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .and_then(|mut file| {
                    io::Write::write_all(&mut file, starter_css(&theme_id, &name).as_bytes())
                });
            if let Err(e) = written {
                let _ = std::fs::remove_dir_all(&package);
                return Err(node_error(&e, "open", &path));
            }
            return Ok(Created { theme_id, path });
        }
        Err("The themes directory has reached its package limit.".into())
    }
}

fn write_atomic(directory: &Path, name: &str, content: &str) -> io::Result<()> {
    let temp = directory.join(format!(
        ".{name}.{}-{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos())
    ));
    let result = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .and_then(|mut file| io::Write::write_all(&mut file, content.as_bytes()))
        .and_then(|()| std::fs::rename(&temp, directory.join(name)));
    let _ = std::fs::remove_file(&temp);
    result
}

/// `createStarterThemeCss`.
pub fn starter_css(theme_id: &str, name: &str) -> String {
    format!(
        "/* Edit public PuppyOne tokens, save, then return to Appearance. */
@puppyone-theme {{
  id: {theme_id};
  name: {name};
  version: 1.0.0;
  compatible-root-themes: default;
  modes: light dark;
}}

@puppyone application {{
  :root {{
    --po-canvas: #fafafa;
    --po-accent: #2563eb;
  }}

  .dark .theme-root {{
    --po-canvas: #161616;
    --po-accent: #60a5fa;
  }}
}}

@puppyone typography {{
  :root {{
    --po-text-size-content: 16px;
    --po-text-size-conversation: 14px;
    --po-code-font-size: 13px;
    --po-terminal-font-size: 13px;
  }}
}}

@puppyone markdown {{
{}
}}

@puppyone csv {{}}
",
        compiler::DEFAULT_MARKDOWN_CSS
    )
}

/// Node's `fs` error text (`ENOENT: no such file or directory, realpath '…'`),
/// which the product shows in diagnostics.
fn node_error(error: &io::Error, syscall: &str, path: &Path) -> String {
    let description = match error.kind() {
        io::ErrorKind::NotFound => "ENOENT: no such file or directory",
        io::ErrorKind::PermissionDenied => "EACCES: permission denied",
        io::ErrorKind::AlreadyExists => "EEXIST: file already exists",
        io::ErrorKind::NotADirectory => "ENOTDIR: not a directory",
        io::ErrorKind::IsADirectory => "EISDIR: illegal operation on a directory",
        _ => return error.to_string(),
    };
    format!("{description}, {syscall} '{}'", path.display())
}

fn sanitize(message: &str, root: &Path) -> String {
    let replaced = message.replace(&root.display().to_string(), "<themes>");
    let units: Vec<u16> = replaced.encode_utf16().take(500).collect();
    String::from_utf16_lossy(&units)
}

/// `path.resolve(root, dirname(importer), specifier)`, lexically.
fn resolve_lexically(root: &Path, importer: &str, specifier: &str) -> PathBuf {
    let mut out = root.to_path_buf();
    let directory = Path::new(importer).parent().unwrap_or(Path::new(""));
    for component in directory
        .components()
        .chain(Path::new(specifier).components())
    {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(part) => out.push(part),
            Component::RootDir => out = PathBuf::from("/"),
            Component::CurDir | Component::Prefix(_) => {}
        }
    }
    out
}

fn contained(root: &Path, candidate: &Path) -> Result<String, String> {
    let escapes = || "Theme resource path escapes its package.".to_owned();
    let relative = candidate.strip_prefix(root).map_err(|_| escapes())?;
    let relative = relative
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    if relative.starts_with("..") {
        return Err(escapes());
    }
    Ok(relative)
}

/// `resolvePackageFile`: canonical, and inside the package both before and
/// after links are followed.
fn resolve_package_file(
    package: &Path,
    importer: &str,
    specifier: &str,
) -> Result<(PathBuf, String), String> {
    let root = std::fs::canonicalize(package).map_err(|e| node_error(&e, "realpath", package))?;
    let candidate = resolve_lexically(&root, importer, specifier);
    contained(&root, &candidate)?;
    let canonical =
        std::fs::canonicalize(&candidate).map_err(|e| node_error(&e, "realpath", &candidate))?;
    let relative = contained(&root, &canonical)?;
    Ok((canonical, relative))
}

fn read_bounded(path: &Path, max: u64, label: &str) -> Result<String, String> {
    let info = std::fs::metadata(path).map_err(|e| node_error(&e, "stat", path))?;
    if !info.is_file() || info.len() > max {
        return Err(format!("{label} exceeds the supported size limit."));
    }
    let bytes = std::fs::read(path).map_err(|e| node_error(&e, "open", path))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[derive(Default)]
struct Budget {
    asset_bytes: u64,
    asset_urls: std::collections::HashMap<PathBuf, (&'static str, usize)>,
    css_bytes: usize,
    embedded_bytes: usize,
    /// Compiled CSS across the theme's targets (source plus embedded assets).
    compiled_bytes: usize,
    imports: usize,
}
impl Budget {
    fn reserve_css(&mut self, text: &str) -> Result<(), String> {
        self.css_bytes += text.len();
        if self.css_bytes > MAX_THEME_CSS_BYTES {
            return Err("Theme exceeds the aggregate CSS size limit.".into());
        }
        Ok(())
    }
    fn reserve_embedded(&mut self, bytes: usize) -> Result<(), String> {
        self.embedded_bytes += bytes;
        if self.embedded_bytes > MAX_THEME_COMPILED_BYTES {
            return Err("Theme exceeds the embedded asset expansion limit.".into());
        }
        Ok(())
    }
}

struct Package<'a> {
    root: &'a Path,
    budget: &'a mut Budget,
}

fn mime(extension: &str) -> Option<&'static str> {
    Some(match extension {
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".ttf" => "font/ttf",
        ".otf" => "font/otf",
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".svg" => "image/svg+xml",
        _ => return None,
    })
}

impl Loader for Package<'_> {
    fn import(&mut self, specifier: &str, importer: &str) -> Result<(String, String), String> {
        self.budget.imports += 1;
        if self.budget.imports > MAX_THEME_IMPORTS {
            return Err("Theme exceeds the aggregate import count limit.".into());
        }
        let (path, relative) = resolve_package_file(self.root, importer, specifier)?;
        let text = read_bounded(&path, MAX_CSS_BYTES, "Theme CSS import")?;
        self.budget.reserve_css(&text)?;
        Ok((text, relative))
    }
    fn asset(&mut self, specifier: &str, importer: &str) -> Result<&'static str, String> {
        let (path, _) = resolve_package_file(self.root, importer, specifier)?;
        if let Some((mime, length)) = self.budget.asset_urls.get(&path).copied() {
            self.budget.reserve_embedded(length)?;
            return Ok(mime);
        }
        let extension = path
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        let Some(mime) = mime(&extension) else {
            return Err(format!(
                "Unsupported theme asset type: {}.",
                if extension.is_empty() {
                    "unknown"
                } else {
                    &extension
                }
            ));
        };
        let info = std::fs::metadata(&path).map_err(|e| node_error(&e, "stat", &path))?;
        if !info.is_file() || info.len() > MAX_ASSET_BYTES {
            return Err("Theme asset exceeds the supported size limit.".into());
        }
        self.budget.asset_bytes += info.len();
        if self.budget.asset_bytes > MAX_THEME_ASSET_BYTES {
            return Err("Theme exceeds the aggregate asset size limit.".into());
        }
        // `data:<mime>;base64,<payload>`.
        let length = "data:;base64,".len() + mime.len() + (info.len() as usize).div_ceil(3) * 4;
        self.budget.asset_urls.insert(path, (mime, length));
        self.budget.reserve_embedded(length)?;
        Ok(mime)
    }
}

/// Compile one target; returns its root blocks.
fn compile_target(
    nodes: Vec<css::Node>,
    source: &str,
    root: &Path,
    target: Target,
    modes: Option<&[Mode]>,
    budget: &mut Budget,
    text_bytes: usize,
) -> Result<Vec<compiler::Block>, String> {
    let embedded_before = budget.embedded_bytes;
    let css_before = budget.css_bytes;
    let compiled = compiler::compile(nodes, source, target, modes, &mut Package { root, budget })?;
    budget.compiled_bytes +=
        text_bytes + (budget.css_bytes - css_before) + (budget.embedded_bytes - embedded_before);
    if budget.compiled_bytes > MAX_THEME_COMPILED_BYTES {
        return Err("Theme exceeds the aggregate compiled CSS size limit.".into());
    }
    Ok(compiled.blocks)
}

/// The Application declarations per mode, in cascade order.
fn application(blocks: &[compiler::Block]) -> [Vec<(String, String)>; 2] {
    let mut light = Vec::new();
    let mut dark = Vec::new();
    for block in blocks.iter().filter(|b| !b.conditional) {
        dark.extend(block.declarations.iter().cloned());
        if !block.dark_only {
            light.extend(block.declarations.iter().cloned());
        }
    }
    [light, dark]
}

fn load_directory(package: &Path) -> Result<Theme, String> {
    if std::fs::symlink_metadata(package.join("theme.json")).is_ok() {
        return load_package(package);
    }
    if std::fs::symlink_metadata(package.join("theme.css")).is_ok() {
        let (_, relative) = resolve_package_file(package, ".", "theme.css")?;
        return load_standalone(package, &relative, true, Source::LocalPackage);
    }
    load_package(package)
}

fn reserved(id: &str) -> Result<(), String> {
    if id == LEGACY_CUSTOM_THEME_ID {
        return Err(format!(
            "Theme id is reserved for legacy compatibility: {LEGACY_CUSTOM_THEME_ID}."
        ));
    }
    Ok(())
}

fn load_standalone(
    root: &Path,
    filename: &str,
    require_metadata: bool,
    source: Source,
) -> Result<Theme, String> {
    let text = read_bounded(&root.join(filename), MAX_CSS_BYTES, "Theme CSS")?;
    let mut budget = Budget::default();
    if let Some(single) = contract::parse_single_file(&text, filename)? {
        let manifest = single.manifest;
        reserved(&manifest.id)?;
        budget.reserve_css(&text)?;
        let mut application_blocks = None;
        for (target, nodes) in single.stylesheets {
            let blocks = compile_target(
                nodes,
                filename,
                root,
                target,
                Some(&manifest.modes),
                &mut budget,
                0,
            )?;
            if target == Target::Application {
                application_blocks = Some(application(&blocks));
            }
        }
        return Ok(Theme {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            author: manifest.author,
            modes: manifest.modes,
            targets: manifest.targets,
            compatible_root_theme_ids: manifest.compatible_root_theme_ids,
            source,
            application: application_blocks,
        });
    }
    if require_metadata {
        return Err("A directory theme.css must contain @puppyone-theme metadata.".into());
    }
    let stem = Path::new(filename)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    budget.reserve_css(&text)?;
    let nodes =
        css::parse(&text, filename).map_err(|e| format!("Theme CSS could not be parsed: {e}"))?;
    compile_target(
        nodes,
        filename,
        root,
        Target::Markdown,
        None,
        &mut budget,
        text.len(),
    )?;
    Ok(Theme {
        id: format!("local.css.{}", slug(&stem)),
        name: humanize(&stem),
        version: "0.0.0".into(),
        author: None,
        modes: vec![Mode::Light, Mode::Dark],
        targets: vec![Target::Markdown],
        compatible_root_theme_ids: vec!["default".into()],
        source: Source::LocalCss,
        application: None,
    })
}

fn load_package(package: &Path) -> Result<Theme, String> {
    let (manifest_path, _) = resolve_package_file(package, ".", "theme.json")?;
    let text = read_bounded(&manifest_path, MAX_MANIFEST_BYTES, "Theme manifest")?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Theme manifest is not valid JSON: {e}"))?;
    let manifest = contract::parse_manifest(&value)?;
    reserved(&manifest.id)?;
    let mut budget = Budget::default();
    let mut application_blocks = None;
    for (target, entrypoint) in &manifest.entrypoints {
        let (path, relative) = resolve_package_file(package, ".", entrypoint)?;
        let text = read_bounded(&path, MAX_CSS_BYTES, "Theme CSS")?;
        budget.reserve_css(&text)?;
        let nodes = css::parse(&text, &relative)
            .map_err(|e| format!("Theme CSS could not be parsed: {e}"))?;
        let blocks = compile_target(
            nodes,
            &relative,
            package,
            *target,
            Some(&manifest.modes),
            &mut budget,
            text.len(),
        )?;
        if *target == Target::Application {
            application_blocks = Some(application(&blocks));
        }
    }
    Ok(Theme {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        modes: manifest.modes,
        targets: manifest.targets,
        compatible_root_theme_ids: manifest.compatible_root_theme_ids,
        source: Source::LocalPackage,
        application: application_blocks,
    })
}

/// `createSlug`: NFKD, lowercase, runs of anything else become `-`.
fn slug(value: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let lower = value.nfkd().collect::<String>().to_lowercase();
    let mut out = String::new();
    let mut dash = false;
    for c in lower.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    let trimmed: String = out.trim_matches('-').chars().take(80).collect();
    if trimmed.is_empty() {
        "theme".into()
    } else if trimmed.starts_with(|c: char| c.is_ascii_lowercase()) {
        trimmed
    } else {
        format!("theme-{trimmed}")
    }
}

/// `humanizeFilename`.
fn humanize(stem: &str) -> String {
    let words: Vec<String> = stem
        .split(['-', '_'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            chars
                .next()
                .map(|c| c.to_uppercase().chain(chars).collect())
                .unwrap_or_default()
        })
        .collect();
    if words.is_empty() {
        "Theme".into()
    } else {
        words.join(" ")
    }
}

/// `String.prototype.localeCompare` (ICU root collation) for file names:
/// spaces, then punctuation in ICU order, digits, then letters ignoring
/// case and accents; accents, then case (lower first) break ties.
fn locale_compare(a: &str, b: &str) -> std::cmp::Ordering {
    use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};
    const PUNCTUATION: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
    let key = |s: &str| {
        let mut primary = Vec::new();
        let mut secondary = Vec::new();
        let mut tertiary = Vec::new();
        for c in s.nfd() {
            if is_combining_mark(c) {
                if let Some(last) = secondary.last_mut() {
                    *last = c as u32;
                }
                continue;
            }
            let weight = if c.is_whitespace() {
                (0, 0)
            } else if let Some(i) = PUNCTUATION.find(c) {
                (1, i as u32)
            } else if c.is_ascii_digit() {
                (2, c as u32)
            } else if c.is_alphabetic() {
                (3, c.to_lowercase().next().unwrap_or(c) as u32)
            } else {
                (4, c as u32)
            };
            primary.push(weight);
            secondary.push(0);
            tertiary.push(u8::from(c.is_uppercase()));
        }
        (primary, secondary, tertiary)
    };
    key(a).cmp(&key(b)).then_with(|| a.cmp(b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "puppyone-themes-{name}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn copy(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).unwrap();
        for entry in std::fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let target = to.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy(&entry.path(), &target);
            } else {
                std::fs::copy(entry.path(), target).unwrap();
            }
        }
    }

    #[test]
    fn the_folder_lists_what_the_product_lists() {
        let data = temp("oracle");
        copy(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/themes/folder"),
            &data.join("themes"),
        );
        let snapshot = Service::new(data.clone()).list().unwrap();
        let oracle: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/themes/oracle.json")).unwrap();
        let ids: Vec<&str> = snapshot.themes.iter().map(|t| t.id.as_str()).collect();
        let expected: Vec<&str> = oracle["themes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, expected);
        for (theme, expected) in snapshot
            .themes
            .iter()
            .zip(oracle["themes"].as_array().unwrap())
        {
            assert_eq!(theme.name, expected["name"].as_str().unwrap());
            assert_eq!(theme.version, expected["version"].as_str().unwrap());
            assert_eq!(theme.author.as_deref(), expected["author"].as_str());
            assert_eq!(theme.source.id(), expected["source"].as_str().unwrap());
            let modes: Vec<&str> = theme.modes.iter().map(|m| m.id()).collect();
            assert_eq!(serde_json::json!(modes), expected["modes"]);
            let targets: Vec<&str> = theme.targets.iter().map(|t| t.id()).collect();
            assert_eq!(serde_json::json!(targets), expected["targets"]);
            assert_eq!(
                serde_json::json!(theme.compatible_root_theme_ids),
                expected["compatibleRootThemeIds"]
            );
            assert_eq!(
                theme.application.is_some(),
                expected.get("palette").is_some()
            );
            if let Some([light, dark]) = &theme.application {
                for (mode, declared, is_dark) in [("light", light, false), ("dark", dark, true)] {
                    let Some(palette) = expected["palette"].get(mode) else {
                        continue;
                    };
                    let projected = super::super::palette::project(declared, is_dark);
                    for (name, value) in palette.as_object().unwrap() {
                        let normal = super::super::value::tokenize(value.as_str().unwrap())
                            .and_then(|t| super::super::value::color(&t, is_dark))
                            .map(super::super::value::format)
                            .unwrap();
                        assert_eq!(projected[name], normal, "{} {mode} {name}", theme.id);
                    }
                }
            }
        }
        let diagnostics: Vec<(String, String)> = snapshot
            .diagnostics
            .iter()
            .map(|d| (d.source.clone(), d.message.clone()))
            .collect();
        let expected: Vec<(String, String)> = oracle["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| {
                (
                    d["source"].as_str().unwrap().to_owned(),
                    d["message"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        assert_eq!(diagnostics.len(), expected.len(), "{diagnostics:#?}");
        for (actual, expected) in diagnostics.iter().zip(&expected) {
            assert_eq!(actual.0, expected.0);
            // V8's JSON error text is not reproduced, only its prefix.
            if expected.1.starts_with("Theme manifest is not valid JSON: ") {
                assert!(actual.1.starts_with("Theme manifest is not valid JSON: "));
            } else {
                assert_eq!(actual.1, expected.1, "{}", actual.0);
            }
        }
        assert_eq!(
            std::fs::read_to_string(data.join("themes/README.md")).unwrap(),
            "ignored\n"
        );
        assert!(data.join("themes/.puppyone-theme-guide-v1").exists());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn new_themes_are_numbered_selectable_and_complete() {
        let data = temp("create");
        let service = Service::new(data.clone());
        let first = service.create().unwrap();
        let second = service.create().unwrap();
        assert_eq!(first.theme_id, "local.user.custom-theme");
        assert_eq!(second.theme_id, "local.user.custom-theme-2");
        assert!(second.path.ends_with("custom-theme-2/theme.css"));
        assert_eq!(
            std::fs::read_to_string(data.join("themes/README.md")).unwrap(),
            GUIDE
        );
        let snapshot = service.list().unwrap();
        assert!(
            snapshot.diagnostics.is_empty(),
            "{:?}",
            snapshot.diagnostics
        );
        let theme = &snapshot.themes[1];
        assert_eq!(theme.name, "Custom Theme 2");
        assert_eq!(
            theme.targets,
            [
                Target::Application,
                Target::Typography,
                Target::Markdown,
                Target::Csv
            ]
        );
        let [light, dark] = theme.application.clone().unwrap();
        assert_eq!(
            super::super::palette::project(&light, false)["accent"],
            "#2563eb"
        );
        assert_eq!(
            super::super::palette::project(&dark, true)["canvas"],
            "#161616"
        );
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn names_slug_humanize_and_sort_like_the_product() {
        assert_eq!(slug("Résumé Notes"), "re-sume-notes");
        assert_eq!(slug("2024 notes"), "theme-2024-notes");
        assert_eq!(slug("+++"), "theme");
        assert_eq!(humanize("my-notes_v2"), "My Notes V2");
        let mut names = vec![
            "_a", "-a", "!a", ".a", "(a", "~a", "1a", "a", "A", "e", "E", "é", "f",
        ];
        names.sort_by(|a, b| locale_compare(a, b));
        assert_eq!(
            names,
            [
                "_a", "-a", "!a", ".a", "(a", "~a", "1a", "a", "A", "e", "E", "é", "f"
            ]
        );
        let mut names = vec!["a.b", "ab", "a b", "a-b", "a_b", "AB", "Ab", "aB"];
        names.sort_by(|a, b| locale_compare(a, b));
        assert_eq!(names, ["a b", "a_b", "a-b", "a.b", "ab", "aB", "Ab", "AB"]);
    }
}
