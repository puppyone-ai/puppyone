//! On-demand Viewer Packs (`viewer-packs/<id>/<version>/` in the native data
//! directory): large viewer bundles and font sets downloaded only when the
//! person chooses to install them, verified file-by-file against compiled-in
//! SHA-256 receipts before atomic installation or loading.
use super::build_identity::{self, Channel};
use flate2::read::GzDecoder;
use sha2::{Digest as _, Sha256};
use std::{
    collections::BTreeMap,
    io::Read as _,
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

pub fn excalidraw_spec() -> &'static ExcalidrawSpec {
    static SPEC: OnceLock<ExcalidrawSpec> = OnceLock::new();
    SPEC.get_or_init(|| {
        let receipt: serde_json::Value =
            serde_json::from_str(include_str!("../../assets/web/excalidraw.json"))
                .expect("valid excalidraw receipt");
        let font_manifest: serde_json::Value =
            serde_json::from_str(include_str!("../../assets/web/excalidraw-fonts.json"))
                .expect("valid excalidraw font manifest");
        let version = font_manifest["version"]
            .as_str()
            .expect("excalidraw version")
            .to_owned();
        let script_sha256 = receipt["outputs"]["excalidraw.js"]
            .as_str()
            .expect("excalidraw.js sha256")
            .to_owned();
        let style_sha256 = receipt["outputs"]["excalidraw.css"]
            .as_str()
            .expect("excalidraw.css sha256")
            .to_owned();
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
    let root = packs_root();
    if let Ok(guard) = cache().lock()
        && let Some((cached_root, pack)) = guard.as_ref()
        && *cached_root == root
        && pack.dir.join("fonts").is_dir()
    {
        return Some(pack.clone());
    }
    let pack = load_excalidraw_from(&root)?;
    if let Ok(mut guard) = cache().lock() {
        *guard = Some((root, pack.clone()));
    }
    Some(pack)
}

/// Loads and verifies an installed Excalidraw pack under `root`.
pub fn load_excalidraw_from(root: &Path) -> Option<ExcalidrawPack> {
    let spec = excalidraw_spec();
    let dir = root.join(EXCALIDRAW_PACK_ID).join(&spec.version);
    if !dir.join("fonts").is_dir() {
        return None;
    }
    let script = std::fs::read(dir.join("excalidraw.js")).ok()?;
    if sha256_hex(&script) != spec.script_sha256 {
        return None;
    }
    let style = std::fs::read(dir.join("excalidraw.css")).ok()?;
    if sha256_hex(&style) != spec.style_sha256 {
        return None;
    }
    Some(ExcalidrawPack {
        version: spec.version.clone(),
        script: Arc::from(script),
        style: Arc::from(style),
        dir,
    })
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
    if archive_gz.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Viewer pack archive exceeds the 32 MiB limit.".into());
    }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    let result = unpack_and_verify(&staging, archive_gz);
    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    let (script, style) = result?;
    let spec = excalidraw_spec();
    let parent = root.join(EXCALIDRAW_PACK_ID);
    std::fs::create_dir_all(&parent).map_err(|e| {
        let _ = std::fs::remove_dir_all(&staging);
        e.to_string()
    })?;
    let dest = parent.join(&spec.version);
    if dest.exists() {
        let backup = parent.join(format!(".old-{}", uuid::Uuid::new_v4()));
        std::fs::rename(&dest, &backup).map_err(|e| {
            let _ = std::fs::remove_dir_all(&staging);
            e.to_string()
        })?;
        if let Err(e) = std::fs::rename(&staging, &dest) {
            let _ = std::fs::rename(&backup, &dest);
            let _ = std::fs::remove_dir_all(&staging);
            return Err(e.to_string());
        }
        let _ = std::fs::remove_dir_all(&backup);
    } else if let Err(e) = std::fs::rename(&staging, &dest) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e.to_string());
    }
    Ok(ExcalidrawPack {
        version: spec.version.clone(),
        script,
        style,
        dir: dest,
    })
}

type VerifiedBundles = (Arc<[u8]>, Arc<[u8]>);

fn unpack_and_verify(staging: &Path, archive_gz: &[u8]) -> Result<VerifiedBundles, String> {
    std::fs::create_dir_all(staging).map_err(|e| e.to_string())?;
    let decoder = GzDecoder::new(archive_gz);
    let mut archive = tar::Archive::new(decoder);
    let mut total_bytes = 0u64;
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
        let out = staging.join(&rel);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&out, &buf).map_err(|e| e.to_string())?;
    }

    let spec = excalidraw_spec();
    let script = std::fs::read(staging.join("excalidraw.js"))
        .map_err(|_| "Viewer pack is missing excalidraw.js.".to_owned())?;
    if sha256_hex(&script) != spec.script_sha256 {
        return Err("Viewer pack excalidraw.js digest mismatch.".into());
    }
    let style = std::fs::read(staging.join("excalidraw.css"))
        .map_err(|_| "Viewer pack is missing excalidraw.css.".to_owned())?;
    if sha256_hex(&style) != spec.style_sha256 {
        return Err("Viewer pack excalidraw.css digest mismatch.".into());
    }
    for (font_rel, expected_sha) in &spec.fonts {
        let bytes = std::fs::read(staging.join("fonts").join(font_rel))
            .map_err(|_| format!("Viewer pack is missing font {font_rel}."))?;
        if sha256_hex(&bytes) != *expected_sha {
            return Err(format!("Viewer pack font digest mismatch for {font_rel}."));
        }
    }
    Ok((Arc::from(script), Arc::from(style)))
}

fn fetch_excalidraw_archive(version: &str) -> Result<Vec<u8>, String> {
    if let Some(local) = std::env::var_os("PUPPYONE_VIEWER_PACKS_ARCHIVE") {
        let bytes = std::fs::read(local).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
            return Err("Viewer pack archive exceeds the 32 MiB limit.".into());
        }
        return Ok(bytes);
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
        && let Ok(bytes) = std::fs::read(local)
    {
        return Ok(bytes);
    }
    remote_result
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
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = super::proxy::system(reqwest::Client::builder())
            .redirect_policy(reqwest::redirect::Policy::limited(3))
            .https_only(!loopback)
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|e| e.to_string())?;
        let response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("{url} answered {}", response.status()));
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_ARCHIVE_BYTES)
        {
            return Err("Viewer pack archive exceeds the 32 MiB limit.".into());
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
            return Err("Viewer pack archive exceeds the 32 MiB limit.".into());
        }
        Ok(bytes.to_vec())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use flate2::{Compression, write::GzEncoder};

    fn make_tar_gz(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
        {
            let mut tar = tar::Builder::new(&mut gz);
            for (path, data) in entries {
                let mut header = tar::Header::new_gnu();
                header.set_size(data.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                tar.append_data(&mut header, path, *data).unwrap();
            }
            tar.finish().unwrap();
        }
        gz.finish().unwrap()
    }

    #[test]
    fn pinned_excalidraw_spec_parses_digests_and_fonts() {
        let spec = excalidraw_spec();
        assert!(!spec.version.is_empty());
        assert_eq!(spec.script_sha256.len(), 64);
        assert_eq!(spec.style_sha256.len(), 64);
        assert!(spec.fonts.len() >= 200);
        for family in ["Assistant/", "Excalifont/", "Virgil/", "Xiaolai/"] {
            assert!(spec.fonts.keys().any(|k| k.starts_with(family)), "{family}");
        }
    }

    #[test]
    fn tampered_or_traversing_archives_are_rejected_and_missing_root_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_excalidraw_from(dir.path()).is_none());

        let bad_js = make_tar_gz(&[
            ("excalidraw.js", b"tampered"),
            ("excalidraw.css", b"tampered"),
        ]);
        let err = install_excalidraw_bytes(dir.path(), &bad_js).unwrap_err();
        assert!(err.contains("digest mismatch"), "{err}");
        assert!(load_excalidraw_from(dir.path()).is_none());

        // Tampered on-disk script after manual placement is also refused.
        let spec = excalidraw_spec();
        let manual = dir.path().join(EXCALIDRAW_PACK_ID).join(&spec.version);
        std::fs::create_dir_all(manual.join("fonts")).unwrap();
        std::fs::write(manual.join("excalidraw.js"), b"bad").unwrap();
        std::fs::write(manual.join("excalidraw.css"), b"bad").unwrap();
        assert!(load_excalidraw_from(dir.path()).is_none());

        // Real built pack archive (when packaged locally) installs and loads cleanly.
        if let Some(archive_path) = dev_local_archive(&spec.version) {
            let archive = std::fs::read(archive_path).unwrap();
            let installed = install_excalidraw_bytes(dir.path(), &archive).unwrap();
            assert_eq!(installed.version, spec.version);
            assert!(!installed.script.is_empty());
            assert!(load_excalidraw_from(dir.path()).is_some());
        }
    }
}
