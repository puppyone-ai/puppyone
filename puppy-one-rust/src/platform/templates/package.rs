//! `local-api/templates/package.mjs`: a store package is a zip of
//! `manifest.json` and `content/…`, checked end to end before anything is
//! written — the bundle against the descriptor's size and SHA-256, every
//! entry's kind and name, the manifest against the descriptor, each file
//! against its SHA-256, and the whole content against its digest. Secrets
//! (`.env`, keys, `.ssh`…) are refused.
use super::{MAX_BYTES, Plan, link::require_id, require_relative_path, sha256_hex};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, io::Read as _};

/// `TEMPLATE_MAX_BYTES`.
pub const BUNDLE_MAX: usize = MAX_BYTES;
const MANIFEST_MAX: usize = 512 * 1024;

fn failure() -> String {
    "Template package verification failed. Please download it again.".into()
}
fn sha_hex(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
}

/// The store's answer to "download this release".
#[derive(Clone, Debug, PartialEq)]
pub struct Descriptor {
    pub template_id: String,
    pub release_id: String,
    pub download_url: String,
    pub bundle_sha256: String,
    pub content_sha256: String,
    pub bundle_bytes: usize,
    pub total_bytes: usize,
    pub file_count: usize,
    pub version: String,
    pub locale: String,
    pub initial_open_path: Option<String>,
}
/// `validateDownloadDescriptor`.
pub fn descriptor(
    value: &Value,
    id: &str,
    release: &str,
    now_ms: i64,
) -> Result<Descriptor, String> {
    let text = |field: &str| value[field].as_str().map(str::to_owned);
    if value["schema_version"] != 1
        || value["template_id"] != id
        || value["release_id"] != release
        || require_id(id).is_err()
        || require_id(release).is_err()
        || !sha_hex(&value["bundle_sha256"])
        || !sha_hex(&value["content_sha256"])
    {
        return Err(failure());
    }
    let count = |field: &str, min: u64, max: u64| {
        value[field]
            .as_u64()
            .filter(|n| (min..=max).contains(n))
            .map(|n| n as usize)
            .ok_or_else(failure)
    };
    let file_count = count("file_count", 1, 256)?;
    let total_bytes = count("total_bytes", 0, MAX_BYTES as u64)?;
    let bundle_bytes = count("bundle_bytes", 1, MAX_BYTES as u64)?;
    let bounded = |field: &str, max: usize| {
        text(field)
            .filter(|s| !s.is_empty() && s.encode_utf16().count() <= max)
            .ok_or_else(failure)
    };
    let locale = bounded("locale", 20)?;
    let version = bounded("version", 80)?;
    let expires = value["expires_at"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.timestamp_millis())
        .ok_or_else(failure)?;
    if expires <= now_ms {
        return Err(failure());
    }
    let initial_open_path = match &value["initial_open_path"] {
        Value::Null => None,
        Value::String(path) => Some(
            require_relative_path(path)
                .map_err(|_| failure())?
                .to_owned(),
        ),
        _ => return Err(failure()),
    };
    Ok(Descriptor {
        template_id: id.into(),
        release_id: release.into(),
        download_url: text("download_url").ok_or_else(failure)?,
        bundle_sha256: text("bundle_sha256").unwrap_or_default(),
        content_sha256: text("content_sha256").unwrap_or_default(),
        bundle_bytes,
        total_bytes,
        file_count,
        version,
        locale,
        initial_open_path,
    })
}

/// `requireSafeContentPath`: no repository, credential or system files.
fn require_safe_content_path(value: &str) -> Result<(), String> {
    require_relative_path(value).map_err(|_| failure())?;
    let refused = |part: &str| {
        let lower = part.to_ascii_lowercase();
        matches!(
            lower.as_str(),
            ".git" | ".aws" | ".ssh" | ".env" | "node_modules" | ".ds_store"
        ) || lower.starts_with(".env.")
    };
    if value.split('/').any(refused) {
        return Err(failure());
    }
    Ok(())
}

struct Entry {
    name: String,
    method: u16,
    compressed: usize,
    size: usize,
    offset: usize,
    mode: u32,
    encrypted: bool,
}
fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}
fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}
/// The zip's central directory (no ZIP64: a package is at most 32 MB).
fn entries(bytes: &[u8]) -> Option<Vec<Entry>> {
    let floor = bytes.len().saturating_sub(22 + 65_535);
    let end = (floor..=bytes.len().checked_sub(22)?)
        .rev()
        .find(|&i| u32_at(bytes, i) == Some(0x0605_4b50))?;
    let count = u16_at(bytes, end + 10)? as usize;
    let mut at = u32_at(bytes, end + 16)? as usize;
    let mut found = Vec::with_capacity(count);
    for _ in 0..count {
        if u32_at(bytes, at)? != 0x0201_4b50 {
            return None;
        }
        let flags = u16_at(bytes, at + 8)?;
        let method = u16_at(bytes, at + 10)?;
        let compressed = u32_at(bytes, at + 20)? as usize;
        let size = u32_at(bytes, at + 24)? as usize;
        let name_len = u16_at(bytes, at + 28)? as usize;
        let extra = u16_at(bytes, at + 30)? as usize;
        let comment = u16_at(bytes, at + 32)? as usize;
        let attributes = u32_at(bytes, at + 38)?;
        let offset = u32_at(bytes, at + 42)? as usize;
        let name = std::str::from_utf8(bytes.get(at + 46..at + 46 + name_len)?)
            .ok()?
            .to_owned();
        found.push(Entry {
            name,
            method,
            compressed,
            size,
            offset,
            mode: (attributes >> 16) & 0o170000,
            encrypted: flags & 1 != 0,
        });
        at += 46 + name_len + extra + comment;
    }
    Some(found)
}
/// An entry's bytes, inflated, exactly its declared size and at most `limit`.
fn read(bytes: &[u8], entry: &Entry, limit: usize) -> Option<Vec<u8>> {
    let at = entry.offset;
    if u32_at(bytes, at)? != 0x0403_4b50 || entry.size > limit {
        return None;
    }
    let name_len = u16_at(bytes, at + 26)? as usize;
    let extra = u16_at(bytes, at + 28)? as usize;
    let start = at + 30 + name_len + extra;
    let data = bytes.get(start..start.checked_add(entry.compressed)?)?;
    let content = match entry.method {
        0 => data.to_vec(),
        8 => {
            let mut out = Vec::with_capacity(entry.size);
            flate2::read::DeflateDecoder::new(data)
                .take(limit as u64 + 1)
                .read_to_end(&mut out)
                .ok()?;
            out
        }
        _ => return None,
    };
    (content.len() == entry.size).then_some(content)
}
/// `validateArchiveEntry`: `true` for a folder entry, which carries nothing.
fn check_entry(
    entry: &Entry,
    seen: &mut std::collections::HashSet<String>,
) -> Result<bool, String> {
    let name = &entry.name;
    if entry.encrypted
        || !seen.insert(name.clone())
        || (entry.mode != 0 && entry.mode != 0o100000 && entry.mode != 0o040000)
        || name.contains('\\')
        || name.starts_with('/')
    {
        return Err(failure());
    }
    if let Some(folder) = name.strip_suffix('/') {
        if entry.mode != 0 && entry.mode != 0o040000 {
            return Err(failure());
        }
        if name != "content/" {
            let inner = folder.strip_prefix("content/").ok_or_else(failure)?;
            require_relative_path(inner).map_err(|_| failure())?;
        }
        return Ok(true);
    }
    if entry.mode == 0o040000 {
        return Err(failure());
    }
    if name != "manifest.json" {
        let inner = name.strip_prefix("content/").ok_or_else(failure)?;
        require_safe_content_path(inner)?;
    }
    Ok(false)
}
/// `contentDigest`.
fn content_digest(files: &[(String, Vec<u8>)]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"papertrain-template-content-v1\0");
    let mut sorted: Vec<&(String, Vec<u8>)> = files.iter().collect();
    sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    for (path, content) in sorted {
        hash.update((path.len() as u32).to_be_bytes());
        hash.update(path.as_bytes());
        hash.update((content.len() as u64).to_be_bytes());
        hash.update(Sha256::digest(content));
    }
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// `parseTemplatePackage`: the verified files, ready to write.
pub fn parse(bytes: &[u8], descriptor: &Descriptor) -> Result<Plan, String> {
    if bytes.len() != descriptor.bundle_bytes
        || bytes.len() > BUNDLE_MAX
        || sha256_hex(bytes) != descriptor.bundle_sha256
    {
        return Err(failure());
    }
    let listed = entries(bytes).ok_or_else(failure)?;
    if !(2..=1024).contains(&listed.len()) {
        return Err(failure());
    }
    let mut seen = std::collections::HashSet::new();
    let mut files: HashMap<String, Vec<u8>> = HashMap::new();
    let mut total = 0usize;
    for entry in &listed {
        if check_entry(entry, &mut seen)? {
            continue;
        }
        let limit = if entry.name == "manifest.json" {
            MANIFEST_MAX
        } else {
            MAX_BYTES
        };
        total += entry.size;
        if entry.size > limit || total > MAX_BYTES + MANIFEST_MAX || files.len() >= 257 {
            return Err(failure());
        }
        let content = read(bytes, entry, limit).ok_or_else(failure)?;
        files.insert(entry.name.clone(), content);
    }
    let manifest: Value = files
        .get("manifest.json")
        .and_then(|m| serde_json::from_slice(m).ok())
        .ok_or_else(failure)?;
    let allowed = [
        "format_version",
        "template_id",
        "release_id",
        "created_at",
        "content_sha256",
        "files",
    ];
    let listed_files = manifest["files"].as_array().ok_or_else(failure)?;
    if manifest
        .as_object()
        .is_none_or(|m| m.keys().any(|k| !allowed.contains(&k.as_str())))
        || manifest["format_version"] != 1
        || manifest["template_id"] != descriptor.template_id.as_str()
        || manifest["release_id"] != descriptor.release_id.as_str()
        || manifest["content_sha256"] != descriptor.content_sha256.as_str()
        || listed_files.len() != descriptor.file_count
        || files.len() != listed_files.len() + 1
    {
        return Err(failure());
    }
    let mut paths = std::collections::HashSet::new();
    let mut plan_files = Vec::with_capacity(listed_files.len());
    for file in listed_files {
        let path = file["path"].as_str().ok_or_else(failure)?;
        require_safe_content_path(path)?;
        let content = files.get(&format!("content/{path}")).ok_or_else(failure)?;
        if file.as_object().is_none_or(|f| {
            f.keys()
                .any(|k| !["path", "size", "sha256"].contains(&k.as_str()))
        }) || !paths.insert(path.to_owned())
            || !sha_hex(&file["sha256"])
            || file["size"].as_u64() != Some(content.len() as u64)
            || file["sha256"] != sha256_hex(content).as_str()
            || private_key(content)
        {
            return Err(failure());
        }
        plan_files.push((path.to_owned(), content.clone()));
    }
    let total: usize = plan_files.iter().map(|(_, c)| c.len()).sum();
    if total != descriptor.total_bytes || content_digest(&plan_files) != descriptor.content_sha256 {
        return Err(failure());
    }
    let plan = Plan {
        files: plan_files,
        initial_open: descriptor.initial_open_path.clone(),
    };
    super::validate(&plan)?;
    Ok(plan)
}
/// `/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/`.
fn private_key(content: &[u8]) -> bool {
    let text = String::from_utf8_lossy(content);
    text.match_indices("-----BEGIN ").any(|(at, _)| {
        let rest = &text[at + 11..];
        rest.find("PRIVATE KEY-----").is_some_and(|end| {
            let middle = &rest[..end];
            middle.is_empty()
                || (middle.ends_with(' ')
                    && middle.chars().all(|c| c.is_ascii_uppercase() || c == ' '))
        })
    })
}

#[cfg(any(test, feature = "test-support"))]
pub mod fixtures {
    //! A signed template package, for these tests and the window's.
    use super::*;
    use serde_json::json;

    pub const ID: &str = "0d3b7a4e-1f2a-4b5c-8d9e-0123456789ab";
    pub const RELEASE: &str = "11111111-2222-4333-8444-555555555555";

    /// A stored (uncompressed) zip of `entries`.
    pub fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, content) in entries {
            let offset = out.len() as u32;
            let crc = crc32(content);
            let local = [
                0x0403_4b50u32.to_le_bytes().to_vec(),
                20u16.to_le_bytes().to_vec(),
                0u16.to_le_bytes().to_vec(),
                0u16.to_le_bytes().to_vec(),
                0u32.to_le_bytes().to_vec(),
                crc.to_le_bytes().to_vec(),
                (content.len() as u32).to_le_bytes().to_vec(),
                (content.len() as u32).to_le_bytes().to_vec(),
                (name.len() as u16).to_le_bytes().to_vec(),
                0u16.to_le_bytes().to_vec(),
            ]
            .concat();
            out.extend(local);
            out.extend(name.as_bytes());
            out.extend(*content);
            let mode: u32 = if name.ends_with('/') {
                0o040755
            } else {
                0o100644
            };
            central.extend(
                [
                    0x0201_4b50u32.to_le_bytes().to_vec(),
                    (0x0314u16).to_le_bytes().to_vec(),
                    20u16.to_le_bytes().to_vec(),
                    0u16.to_le_bytes().to_vec(),
                    0u16.to_le_bytes().to_vec(),
                    0u32.to_le_bytes().to_vec(),
                    crc.to_le_bytes().to_vec(),
                    (content.len() as u32).to_le_bytes().to_vec(),
                    (content.len() as u32).to_le_bytes().to_vec(),
                    (name.len() as u16).to_le_bytes().to_vec(),
                    0u16.to_le_bytes().to_vec(),
                    0u16.to_le_bytes().to_vec(),
                    0u16.to_le_bytes().to_vec(),
                    0u16.to_le_bytes().to_vec(),
                    (mode << 16).to_le_bytes().to_vec(),
                    offset.to_le_bytes().to_vec(),
                ]
                .concat(),
            );
            central.extend(name.as_bytes());
        }
        let start = out.len() as u32;
        let size = central.len() as u32;
        out.extend(central);
        out.extend(
            [
                0x0605_4b50u32.to_le_bytes().to_vec(),
                0u16.to_le_bytes().to_vec(),
                0u16.to_le_bytes().to_vec(),
                (entries.len() as u16).to_le_bytes().to_vec(),
                (entries.len() as u16).to_le_bytes().to_vec(),
                size.to_le_bytes().to_vec(),
                start.to_le_bytes().to_vec(),
                0u16.to_le_bytes().to_vec(),
            ]
            .concat(),
        );
        out
    }
    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = !0u32;
        for byte in bytes {
            crc ^= *byte as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }
    /// A package of `files`, and the descriptor that vouches for it.
    pub fn package(files: &[(&str, &str)]) -> (Vec<u8>, Value) {
        let owned: Vec<(String, Vec<u8>)> = files
            .iter()
            .map(|(p, c)| (p.to_string(), c.as_bytes().to_vec()))
            .collect();
        let digest = content_digest(&owned);
        let manifest = json!({"format_version": 1, "template_id": ID, "release_id": RELEASE,
            "created_at": "2026-11-01T00:00:00Z", "content_sha256": digest,
            "files": files.iter().map(|(p, c)| json!({"path": p, "size": c.len(),
                "sha256": sha256_hex(c.as_bytes())})).collect::<Vec<_>>()});
        let manifest = serde_json::to_vec(&manifest).unwrap();
        let mut entries: Vec<(String, Vec<u8>)> = vec![("manifest.json".into(), manifest)];
        entries.push(("content/".into(), vec![]));
        for (p, c) in files {
            entries.push((format!("content/{p}"), c.as_bytes().to_vec()));
        }
        let refs: Vec<(&str, &[u8])> = entries
            .iter()
            .map(|(n, c)| (n.as_str(), c.as_slice()))
            .collect();
        let bytes = zip(&refs);
        let descriptor = json!({"schema_version": 1, "template_id": ID, "release_id": RELEASE,
            "download_url": format!("https://www.puppyone.ai/api/templates/{ID}/package"),
            "bundle_sha256": sha256_hex(&bytes), "content_sha256": digest,
            "bundle_bytes": bytes.len(), "total_bytes": files.iter().map(|(_, c)| c.len()).sum::<usize>(),
            "file_count": files.len(), "version": "1.0.0", "locale": "en",
            "initial_open_path": files.first().map(|(p, _)| *p),
            "expires_at": "2099-01-01T00:00:00Z"});
        (bytes, descriptor)
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_package_is_verified_end_to_end() {
        let (bytes, value) = package(&[("README.md", "# Plan\n"), ("notes/a.md", "a")]);
        let descriptor = descriptor(&value, ID, RELEASE, 0).unwrap();
        let plan = parse(&bytes, &descriptor).unwrap();
        assert_eq!(plan.files.len(), 2);
        assert_eq!(plan.initial_open.as_deref(), Some("README.md"));
        // A changed byte, an expired descriptor, another release.
        let mut tampered = bytes.clone();
        let at = tampered.len() / 3;
        tampered[at] ^= 1;
        assert!(parse(&tampered, &descriptor).is_err());
        assert!(super::descriptor(&value, ID, RELEASE, i64::MAX).is_err());
        assert!(super::descriptor(&value, ID, ID, 0).is_err());
        // Secrets and repositories are refused.
        for secret in [".env", "a/.git/config", ".ssh/id"] {
            let (bytes, value) = package(&[(secret, "x")]);
            assert!(parse(&bytes, &super::descriptor(&value, ID, RELEASE, 0).unwrap()).is_err());
        }
        let (bytes, value) = package(&[("key.pem", "-----BEGIN RSA PRIVATE KEY-----\nx")]);
        assert!(parse(&bytes, &super::descriptor(&value, ID, RELEASE, 0).unwrap()).is_err());
        assert!(!private_key(b"-----BEGIN PUBLIC KEY-----"));
    }
}
