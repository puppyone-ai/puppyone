//! The update feed's metadata (`<channel>-mac.yml`, electron-updater's
//! generic provider), read the way `desktop-update-feed-verifier.mjs`
//! reads it: a small, closed subset of YAML, every rule checked, and a
//! payload that never leaves its feed's origin and path.
use base64::Engine as _;

/// Larger metadata is refused unread.
pub const MAX_METADATA_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct File {
    pub url: String,
    pub sha512: String,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Metadata {
    pub version: String,
    pub files: Vec<File>,
    pub path: String,
    pub sha512: String,
    pub release_date: String,
}

fn entry(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once(':')?;
    Some((key.trim(), value.trim()))
}
/// `parseScalar`: one pair of matching quotes is removed.
fn scalar(value: &str) -> String {
    let value = value.trim();
    let quoted = value.len() >= 2
        && ((value.starts_with('\'') && value.ends_with('\''))
            || (value.starts_with('"') && value.ends_with('"')));
    if quoted {
        value[1..value.len() - 1].to_owned()
    } else {
        value.to_owned()
    }
}
/// `isSha512Base64`: canonical base64 of exactly 64 bytes.
pub fn is_sha512_base64(value: &str) -> bool {
    let engine = base64::engine::general_purpose::STANDARD;
    !value.is_empty()
        && value.len().is_multiple_of(4)
        && engine
            .decode(value)
            .is_ok_and(|bytes| bytes.len() == 64 && engine.encode(&bytes) == value)
}
fn semantic(version: &str) -> bool {
    let (core, pre) = version.split_once('-').unwrap_or((version, ""));
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        && (!version.contains('-')
            || (!pre.is_empty()
                && pre
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')))
}

/// `parseDesktopUpdaterMetadata` (macOS): every problem is reported.
pub fn parse(source: &str) -> Result<Metadata, Vec<String>> {
    if source.trim().is_empty() {
        return Err(vec!["Desktop updater metadata is empty.".into()]);
    }
    let (mut version, mut path, mut sha512, mut release_date) = (None, None, None, None);
    let mut files: Vec<(String, Option<String>, Option<i64>)> = Vec::new();
    let mut reading_files = false;
    let mut in_file = false;
    for raw in source.lines() {
        if raw.trim().is_empty() || raw.trim_start().starts_with('#') {
            continue;
        }
        let line = raw.trim();
        if raw.len() == raw.trim_start().len() {
            reading_files = false;
            in_file = false;
            let Some((key, value)) = entry(line) else {
                continue;
            };
            match key {
                "files" if value.is_empty() => reading_files = true,
                "version" => version = Some(scalar(value)),
                "path" => path = Some(scalar(value)),
                "sha512" => sha512 = Some(scalar(value)),
                "releaseDate" => release_date = Some(scalar(value)),
                _ => {}
            }
            continue;
        }
        if !reading_files {
            continue;
        }
        if let Some(url) = line
            .strip_prefix('-')
            .filter(|rest| rest.starts_with(char::is_whitespace))
            .map(str::trim_start)
            .and_then(|rest| rest.strip_prefix("url:"))
        {
            files.push((scalar(url), None, None));
            in_file = true;
            continue;
        }
        let (true, Some((key, value)), Some(file)) = (in_file, entry(line), files.last_mut())
        else {
            continue;
        };
        match key {
            "sha512" => file.1 = Some(scalar(value)),
            "size" => file.2 = scalar(value).parse().ok(),
            _ => {}
        }
    }
    let mut errors = Vec::new();
    let version = version.unwrap_or_default();
    if !semantic(&version) {
        errors.push("version must be a semantic version".to_owned());
    }
    if files.is_empty() {
        errors.push("files must contain at least one update payload".to_owned());
    }
    let mut parsed = Vec::new();
    for (url, digest, size) in &files {
        if url.is_empty() {
            errors.push("every update file must declare a URL".to_owned());
        }
        let label = if url.is_empty() { "update file" } else { url };
        let digest = digest.clone().unwrap_or_default();
        if !is_sha512_base64(&digest) {
            errors.push(format!("{label} must declare a base64 SHA-512 digest"));
        }
        match size.filter(|s| *s > 0 && *s < (1i64 << 53)) {
            Some(size) => parsed.push(File {
                url: url.clone(),
                sha512: digest,
                size: size as u64,
            }),
            None => errors.push(format!("{label} must declare a positive byte size")),
        }
    }
    if !files.iter().any(|(url, ..)| zip_url(url)) {
        errors.push("macOS updater metadata must include a ZIP payload".to_owned());
    }
    let path = path.unwrap_or_default();
    let sha512 = sha512.unwrap_or_default();
    match files.iter().find(|(url, ..)| *url == path) {
        Some((_, digest, _)) if !path.is_empty() => {
            if digest.as_deref() != Some(sha512.as_str()) {
                errors.push("top-level sha512 must match the primary update file".to_owned());
            }
        }
        _ => errors.push("path must identify one declared update file".to_owned()),
    }
    let release_date = release_date.unwrap_or_default();
    if chrono::DateTime::parse_from_rfc3339(&release_date).is_err() {
        errors.push("releaseDate must be a valid timestamp".to_owned());
    }
    let mut urls: Vec<&String> = files.iter().map(|(url, ..)| url).collect();
    urls.sort();
    urls.dedup();
    if urls.len() != files.len() {
        errors.push("update file URLs must be unique".to_owned());
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok(Metadata {
        version,
        files: parsed,
        path,
        sha512,
        release_date,
    })
}

fn zip_url(url: &str) -> bool {
    let end = url.find(['?', '#']).unwrap_or(url.len());
    url[..end].to_ascii_lowercase().ends_with(".zip")
}

/// The archive for this processor: a ZIP named for it (`-arm64.zip`,
/// `-x64.zip`), else the one ZIP when there is only one.
pub fn payload<'a>(metadata: &'a Metadata, arch: &str) -> Option<&'a File> {
    let zips: Vec<&File> = metadata.files.iter().filter(|f| zip_url(&f.url)).collect();
    let suffix = format!("-{arch}.zip");
    zips.iter()
        .find(|f| f.url.to_ascii_lowercase().ends_with(&suffix))
        .copied()
        .or_else(|| (zips.len() == 1).then(|| zips[0]))
}

/// `resolveFeedPayloadUrl`: relative to the feed, never leaving its origin
/// or path. `loopback` admits `http://127.0.0.1` (development feeds only).
pub fn payload_url(feed: &url::Url, value: &str, loopback: bool) -> Result<url::Url, String> {
    let mut base = feed.clone();
    if !base.path().ends_with('/') {
        base.set_path(&format!("{}/", base.path()));
    }
    let resolved = base
        .join(value)
        .map_err(|_| format!("Invalid update payload URL: {value}"))?;
    let secure = resolved.scheme() == "https" || (loopback && local_http(&resolved));
    if !secure
        || !resolved.username().is_empty()
        || resolved.password().is_some()
        || resolved.origin() != base.origin()
        || !resolved.path().starts_with(base.path())
    {
        return Err(format!(
            "Update payload must stay under its feed origin and path: {resolved}"
        ));
    }
    Ok(resolved)
}

/// A development feed served on this computer.
pub fn local_http(url: &url::Url) -> bool {
    url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn digest(byte: u8) -> String {
        base64::engine::general_purpose::STANDARD.encode([byte; 64])
    }
    fn metadata(primary: &str) -> String {
        format!(
            "version: 0.4.5\nfiles:\n  - url: puppyone-gpui-0.4.5-arm64.zip\n    sha512: {a}\n    size: 47276072\n  - url: puppyone-gpui-0.4.5-x64.zip\n    sha512: {b}\n    size: 51000000\npath: {primary}\nsha512: {a}\nreleaseDate: '2026-11-15T00:00:00.000Z'\n",
            a = digest(1),
            b = digest(2)
        )
    }

    /// `desktopUpdateFeedVerifier.test.mjs`.
    #[test]
    fn electron_updater_metadata_is_read_and_its_payload_chosen() {
        let parsed = parse(&metadata("puppyone-gpui-0.4.5-arm64.zip")).unwrap();
        assert_eq!(parsed.version, "0.4.5");
        assert_eq!(parsed.files.len(), 2);
        assert_eq!(payload(&parsed, "arm64").unwrap().size, 47276072);
        assert_eq!(
            payload(&parsed, "x64").unwrap().url,
            "puppyone-gpui-0.4.5-x64.zip"
        );
        assert_eq!(payload(&parsed, "ia32"), None);
    }

    #[test]
    fn every_broken_rule_is_reported() {
        assert!(parse("").is_err());
        let errors = parse(&metadata("missing.zip")).unwrap_err();
        assert_eq!(errors, ["path must identify one declared update file"]);
        let bad = "version: v1\nfiles:\n  - url: a.dmg\n    sha512: abc\n    size: 0\npath: a.dmg\nsha512: x\nreleaseDate: soon\n";
        let errors = parse(bad).unwrap_err();
        for expected in [
            "version must be a semantic version",
            "a.dmg must declare a base64 SHA-512 digest",
            "a.dmg must declare a positive byte size",
            "macOS updater metadata must include a ZIP payload",
            "releaseDate must be a valid timestamp",
        ] {
            assert!(
                errors.iter().any(|e| e == expected),
                "{expected}: {errors:?}"
            );
        }
        assert!(!is_sha512_base64(&digest(1)[..84]));
    }

    #[test]
    fn a_payload_stays_under_its_feed() {
        let feed =
            url::Url::parse("https://updates.puppyone.ai/desktop/gpui/stable/mac/latest").unwrap();
        assert_eq!(
            payload_url(&feed, "puppyone-gpui-0.4.5-arm64.zip", false)
                .unwrap()
                .as_str(),
            "https://updates.puppyone.ai/desktop/gpui/stable/mac/latest/puppyone-gpui-0.4.5-arm64.zip"
        );
        for escape in [
            "../x.zip",
            "https://evil.example/x.zip",
            "//evil.example/x.zip",
            "http://updates.puppyone.ai/desktop/gpui/stable/mac/latest/x.zip",
        ] {
            assert!(payload_url(&feed, escape, false).is_err(), "{escape}");
        }
        let local = url::Url::parse("http://127.0.0.1:8765/feed").unwrap();
        assert!(payload_url(&local, "a.zip", false).is_err());
        assert!(payload_url(&local, "a.zip", true).is_ok());
    }
}
