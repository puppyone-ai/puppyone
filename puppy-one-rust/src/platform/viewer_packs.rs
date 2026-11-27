//! On-demand Viewer Packs (`viewer-packs/<id>/<version>/` in the native data
//! directory): large viewer bundles and font sets downloaded only when the
//! person chooses to install them, verified file-by-file against compiled-in
//! SHA-256 receipts before atomic installation or loading.
use super::build_identity::{self, Channel};
use flate2::read::GzDecoder;
use sha2::{Digest as _, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    io::{Read as _, Write as _},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

pub const EXCALIDRAW_PACK_ID: &str = "puppyone.excalidraw";
const DEFAULT_PACKS_BASE_URL: &str = "https://downloads.puppyone.ai/desktop/viewer-packs";
const MAX_ARCHIVE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 48 * 1024 * 1024;

/// Pinned SHA-256 manifest for the Excalidraw Viewer Pack.
pub struct ExcalidrawSpec {
    pub version: String,
    pub script_sha256: String,
    pub style_sha256: String,
    pub fonts: BTreeMap<String, String>,
}

/// Verified Excalidraw Viewer Pack ready to mount in `WebFrame`.
#[derive(Clone, Debug)]
pub struct ExcalidrawPack {
    pub version: String,
    pub script: Arc<[u8]>,
    pub style: Arc<[u8]>,
    pub dir: PathBuf,
}

/// Derive an immutable SemVer pack version from the pinned Excalidraw SDK
/// version and compiled bundle digests so CSS/JS bridge changes never collide
/// with already-published immutable CDN objects for the same upstream SDK.
pub(crate) fn excalidraw_pack_version(
    sdk_version: &str,
    script_sha256: &str,
    style_sha256: &str,
) -> String {
    let digest = sha256_hex(format!("{script_sha256}:{style_sha256}").as_bytes());
    format!("{sdk_version}-b{}", &digest[..12])
}

pub fn excalidraw_spec() -> &'static ExcalidrawSpec {
    static SPEC: OnceLock<ExcalidrawSpec> = OnceLock::new();
    SPEC.get_or_init(|| {
        let receipt: serde_json::Value =
            serde_json::from_str(include_str!("../../assets/web/excalidraw.json"))
                .expect("valid excalidraw receipt");
        let font_manifest: serde_json::Value =
            serde_json::from_str(include_str!("../../assets/web/excalidraw-fonts.json"))
                .expect("valid excalidraw font manifest");
        let sdk_version = font_manifest["version"]
            .as_str()
            .expect("excalidraw version");
        let script_sha256 = receipt["outputs"]["excalidraw.js"]
            .as_str()
            .expect("excalidraw.js sha256")
            .to_owned();
        let style_sha256 = receipt["outputs"]["excalidraw.css"]
            .as_str()
            .expect("excalidraw.css sha256")
            .to_owned();
        let version = excalidraw_pack_version(sdk_version, &script_sha256, &style_sha256);
        let fonts = font_manifest["fonts"]
            .as_object()
            .expect("excalidraw fonts map")
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_owned()))
            .collect();
        ExcalidrawSpec {
            version,
            script_sha256,
            style_sha256,
            fonts,
        }
    })
}

/// Root folder for installed Viewer Packs (`PUPPYONE_VIEWER_PACKS_DIR` isolates tests).
pub fn packs_root() -> PathBuf {
    std::env::var_os("PUPPYONE_VIEWER_PACKS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| super::data_dir().join("viewer-packs"))
}

fn cache() -> &'static Mutex<Option<(PathBuf, ExcalidrawPack)>> {
    static CACHE: OnceLock<Mutex<Option<(PathBuf, ExcalidrawPack)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Loads the installed Excalidraw pack from [`packs_root`], caching the
/// verified bundle bytes in memory once checked.
pub fn load_excalidraw() -> Option<ExcalidrawPack> {
    load_cached(&packs_root(), excalidraw_spec(), cache())
}

fn load_cached(
    root: &Path,
    spec: &ExcalidrawSpec,
    cache: &Mutex<Option<(PathBuf, ExcalidrawPack)>>,
) -> Option<ExcalidrawPack> {
    // Never hold the cache lock while checking files on disk.
    let cached = cache.lock().ok().and_then(|guard| guard.clone());
    if let Some((cached_root, pack)) = cached
        && cached_root == root
        && verified_fonts(
            root,
            &PathBuf::from(EXCALIDRAW_PACK_ID).join(&pack.version),
            spec,
        )
        .is_ok()
    {
        return Some(pack);
    }
    let pack = load_with_spec(root, spec)?;
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((root.to_path_buf(), pack.clone()));
    }
    Some(pack)
}

/// Loads and verifies an installed Excalidraw pack under `root`.
pub fn load_excalidraw_from(root: &Path) -> Option<ExcalidrawPack> {
    load_with_spec(root, excalidraw_spec())
}

fn load_with_spec(root: &Path, spec: &ExcalidrawSpec) -> Option<ExcalidrawPack> {
    let dir = root.join(EXCALIDRAW_PACK_ID).join(&spec.version);
    let relative = PathBuf::from(EXCALIDRAW_PACK_ID).join(&spec.version);
    let grant = super::webview::files::LocalRoot::open(root).ok()?;
    let script = checked_file(&grant, &relative.join("excalidraw.js"), &spec.script_sha256).ok()?;
    let style = checked_file(&grant, &relative.join("excalidraw.css"), &spec.style_sha256).ok()?;
    verified_fonts(root, &relative, spec).ok()?;
    Some(ExcalidrawPack {
        version: spec.version.clone(),
        script: Arc::from(script),
        style: Arc::from(style),
        dir,
    })
}

fn checked_file(
    grant: &super::webview::files::LocalRoot,
    path: &Path,
    expected: &str,
) -> Result<Vec<u8>, String> {
    let bytes = grant
        .file(path)
        .and_then(|f| f.read_bounded(MAX_EXTRACTED_BYTES))
        .map_err(|e| format!("Invalid viewer pack file {}: {e}", path.display()))?;
    if sha256_hex(&bytes) != expected {
        return Err(format!("Viewer pack {} digest mismatch.", path.display()));
    }
    Ok(bytes)
}
fn verified_fonts(root: &Path, relative: &Path, spec: &ExcalidrawSpec) -> Result<(), String> {
    let grant = super::webview::files::LocalRoot::open(root).map_err(|e| e.to_string())?;
    for (font, digest) in &spec.fonts {
        checked_file(&grant, &relative.join("fonts").join(font), digest)?;
    }
    Ok(())
}

/// Downloads, cryptographically verifies, and atomically installs the
/// Excalidraw Viewer Pack into [`packs_root`]. Run off the main thread.
pub fn install_excalidraw() -> Result<ExcalidrawPack, String> {
    let root = packs_root();
    let spec = excalidraw_spec();
    let archive = fetch_excalidraw_archive(&spec.version)?;
    let pack = install_excalidraw_bytes(&root, &archive)?;
    if let Ok(mut guard) = cache().lock() {
        *guard = Some((root, pack.clone()));
    }
    Ok(pack)
}

/// Verifies every file inside a `.tar.gz` Excalidraw pack archive against
/// [`excalidraw_spec`] and atomically swaps it into `root`.
pub fn install_excalidraw_bytes(root: &Path, archive_gz: &[u8]) -> Result<ExcalidrawPack, String> {
    install_with_spec(root, archive_gz, excalidraw_spec())
}

fn install_with_spec(
    root: &Path,
    archive_gz: &[u8],
    spec: &ExcalidrawSpec,
) -> Result<ExcalidrawPack, String> {
    if archive_gz.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Viewer pack archive exceeds the 32 MiB limit.".into());
    }
    let parent = root.join(EXCALIDRAW_PACK_ID);
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    // Cooperating application processes serialize publication of the same
    // pinned version. TempDir owns every failed/cancelled staging directory.
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(parent.join(".install.lock"))
        .map_err(|e| e.to_string())?;
    lock.lock().map_err(|e| e.to_string())?;
    let staging = tempfile::Builder::new()
        .prefix(".staging-")
        .tempdir_in(&parent)
        .map_err(|e| e.to_string())?;
    let (script, style) = unpack_and_verify(staging.path(), archive_gz, spec)?;
    // Do not replace a valid version: existing readers retain its directory.
    // Validate the new archive first so bad input never masquerades as success.
    if let Some(pack) = load_with_spec(root, spec) {
        return Ok(pack);
    }
    let dest = parent.join(&spec.version);
    let publish = super::templates::publish;
    match std::fs::symlink_metadata(&dest) {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("Viewer pack destination is not a regular directory.".into());
            }
            let backup = parent.join(format!(".old-{}", uuid::Uuid::new_v4()));
            publish(&dest, &backup).map_err(|e| e.to_string())?;
            if let Err(error) = publish(staging.path(), &dest) {
                if let Err(rollback) = publish(&backup, &dest) {
                    return Err(format!(
                        "Viewer pack publication failed: {error}; previous files retained at {} because rollback failed: {rollback}",
                        backup.display()
                    ));
                }
                return Err(error.to_string());
            }
            let _ = std::fs::remove_dir_all(backup);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            publish(staging.path(), &dest).map_err(|e| e.to_string())?;
        }
        Err(error) => return Err(error.to_string()),
    }

    Ok(ExcalidrawPack {
        version: spec.version.clone(),
        script,
        style,
        dir: dest,
    })
}

type VerifiedBundles = (Arc<[u8]>, Arc<[u8]>);

fn unpack_and_verify(
    staging: &Path,
    archive_gz: &[u8],
    spec: &ExcalidrawSpec,
) -> Result<VerifiedBundles, String> {
    std::fs::create_dir_all(staging).map_err(|e| e.to_string())?;
    let decoder = GzDecoder::new(archive_gz);
    let mut archive = tar::Archive::new(decoder);
    let mut total_bytes = 0u64;
    let mut seen = HashSet::new();
    let entries = archive.entries().map_err(|e| e.to_string())?;
    for entry in entries {
        let mut entry = entry.map_err(|e| e.to_string())?;
        if !entry.header().entry_type().is_file() {
            return Err("Viewer pack archive may contain regular files only.".into());
        }
        let rel = entry.path().map_err(|e| e.to_string())?.into_owned();
        if rel.as_os_str().is_empty()
            || rel.components().any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err("Viewer pack archive contains an invalid relative path.".into());
        }
        let Some(name) = rel.to_str() else {
            return Err("Viewer pack archive contains a non-UTF-8 path.".into());
        };
        if name.contains('\\')
            || name
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
        {
            return Err("Viewer pack archive contains an invalid relative path.".into());
        }
        if !seen.insert(rel.clone()) {
            return Err(format!("Viewer pack archive repeats {name}."));
        }
        let digest = match name {
            "excalidraw.js" => Some(spec.script_sha256.as_str()),
            "excalidraw.css" => Some(spec.style_sha256.as_str()),
            "manifest.json" | "LICENSE" | "FONT-NOTICES.txt" => None,
            _ => Some(
                name.strip_prefix("fonts/")
                    .and_then(|p| spec.fonts.get(p))
                    .ok_or_else(|| {
                        format!("Viewer pack archive contains an unlisted file: {name}")
                    })?
                    .as_str(),
            ),
        };
        if entry.size() > MAX_EXTRACTED_BYTES - total_bytes {
            return Err("Viewer pack archive exceeds the extracted size budget.".into());
        }
        let mut buf = Vec::new();
        entry
            .by_ref()
            .take(MAX_EXTRACTED_BYTES - total_bytes + 1)
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        total_bytes += buf.len() as u64;
        if total_bytes > MAX_EXTRACTED_BYTES {
            return Err("Viewer pack archive exceeds the extracted size budget.".into());
        }
        if let Some(expected) = digest {
            if sha256_hex(&buf) != expected {
                return Err(format!("Viewer pack {name} digest mismatch."));
            }
        } else {
            let valid = match name {
                "LICENSE" => buf == include_bytes!("../../licenses/excalidraw/LICENSE"),
                "FONT-NOTICES.txt" => buf == include_bytes!("../../licenses/excalidraw/FONT-NOTICES.txt"),
                "manifest.json" => serde_json::from_slice::<serde_json::Value>(&buf).is_ok_and(|v| v == serde_json::json!({
                    "schemaVersion": 1, "id": EXCALIDRAW_PACK_ID, "version": spec.version,
                    "outputs": {"excalidraw.js": spec.script_sha256, "excalidraw.css": spec.style_sha256},
                    "fontCount": spec.fonts.len(),
                })),
                _ => false,
            };
            if !valid {
                return Err(format!(
                    "Viewer pack {name} does not match its compiled receipt."
                ));
            }
        }
        let out = staging.join(&rel);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&out)
            .map_err(|e| e.to_string())?;
        file.write_all(&buf)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
    }

    let grant = super::webview::files::LocalRoot::open(staging).map_err(|e| e.to_string())?;
    let script = checked_file(&grant, Path::new("excalidraw.js"), &spec.script_sha256)?;
    let style = checked_file(&grant, Path::new("excalidraw.css"), &spec.style_sha256)?;
    verified_fonts(staging, Path::new(""), spec)?;
    Ok((Arc::from(script), Arc::from(style)))
}

fn fetch_excalidraw_archive(version: &str) -> Result<Vec<u8>, String> {
    if let Some(local) = std::env::var_os("PUPPYONE_VIEWER_PACKS_ARCHIVE") {
        return read_archive_file(Path::new(&local));
    }
    let base = std::env::var("PUPPYONE_VIEWER_PACKS_BASE_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_PACKS_BASE_URL.to_owned());
    let base = base.trim().trim_end_matches('/');
    let url = url::Url::parse(&format!(
        "{base}/{EXCALIDRAW_PACK_ID}/{version}/{EXCALIDRAW_PACK_ID}-{version}.tar.gz"
    ))
    .map_err(|e| e.to_string())?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("Viewer pack download requires HTTPS.".into());
    }

    let remote_result = download_bytes(&url);
    if remote_result.is_ok() {
        return remote_result;
    }
    // Unpackaged local development fallback when a freshly built pack has not
    // yet been uploaded to CDN.
    if build_identity::current().channel == Channel::Dev
        && let Some(local) = dev_local_archive(version)
        && let Ok(bytes) = read_archive_file(&local)
    {
        return Ok(bytes);
    }
    remote_result
}

fn read_archive(reader: impl std::io::Read, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Viewer pack archive exceeds the 32 MiB limit.".into());
    }
    Ok(bytes)
}
fn read_archive_file(path: &Path) -> Result<Vec<u8>, String> {
    read_archive(
        std::fs::File::open(path).map_err(|e| e.to_string())?,
        MAX_ARCHIVE_BYTES,
    )
}

fn dev_local_archive(version: &str) -> Option<PathBuf> {
    let filename = format!("{EXCALIDRAW_PACK_ID}-{version}.tar.gz");
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("artifacts/viewer-packs")
        .join(&filename);
    if workspace.is_file() {
        return Some(workspace);
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("artifacts/viewer-packs")
        .join(&filename);
    root.is_file().then_some(root)
}

fn download_bytes(url: &url::Url) -> Result<Vec<u8>, String> {
    download_with_budget(url, MAX_ARCHIVE_BYTES, Duration::from_secs(180))
}

fn download_with_budget(url: &url::Url, limit: u64, timeout: Duration) -> Result<Vec<u8>, String> {
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = super::proxy::system(reqwest::Client::builder())
            .redirect_policy(reqwest::redirect::Policy::custom(|attempt| {
                let target = attempt.url();
                let local = matches!(target.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
                if attempt.previous().len() > 3 {
                    attempt.error("Too many viewer pack redirects")
                } else if target.scheme() == "https" || (target.scheme() == "http" && local) {
                    attempt.follow()
                } else {
                    attempt.error("Viewer pack redirects require HTTPS")
                }
            }))
            .https_only(!loopback)
            .timeout(timeout)
            .build()
            .map_err(|e| e.to_string())?;
        let mut response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("{url} answered {}", response.status()));
        }
        if response.content_length().is_some_and(|n| n > limit) {
            return Err("Viewer pack archive exceeds the 32 MiB limit.".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if chunk.len() as u64 > limit.saturating_sub(bytes.len() as u64) {
                return Err("Viewer pack archive exceeds the 32 MiB limit.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    })
}

#[cfg(test)]
mod tests;
