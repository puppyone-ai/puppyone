//! Private local filesystem adapter. Capability checks, stat-first conditional
//! writes, metadata/identity preservation and lossless encoding round-trips
//! stay here; application code uses the provider ports.
use super::contracts::{
    EntryStat, Error, ErrorKind, LineEnding, Result, Revision, TextEncoding, TextSnapshot,
};
use crate::model::{MAX_DIRECTORY_ENTRIES, Node};
use cap_std::fs::{Dir, Metadata, OpenOptions};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};
use uuid::Uuid;
mod adapter;
mod rename;
mod session_reader;
pub(super) use adapter::{open, open_file_parent};

use super::MAX_TEXT_BYTES;

/// Independent windows can hold separate grants for the same file. Keep the
/// complete conditional publication serial across those grants, not just one
/// editor's save queue. Idle entries are weak and reclaimed on the next write.
fn write_lock(path: PathBuf) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<std::collections::HashMap<PathBuf, Weak<Mutex<()>>>>> =
        OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(&path).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(path, Arc::downgrade(&lock));
    lock
}

/// A dropped item as an uploading provider reads it.
pub(crate) enum ImportSource {
    File(Vec<u8>),
    Folder(Vec<PathBuf>),
}

pub struct Workspace {
    pub path: PathBuf,
    dir: Dir,
    /// A file window's folder (`decodesLegacyText`): text that is not UTF-8
    /// is decoded for reading instead of refused.
    legacy_text: bool,
    text_limit: usize,
}

/// Stat fingerprint compared before reading or hashing file contents (`DP-21`, `DP-22`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatFingerprint {
    pub len: u64,
    pub mtime_ns: i128,
    pub ctime_ns: i128,
    pub ino: u64,
    pub dev: u64,
    pub mode: u32,
    #[serde(default)]
    pub nlink: u64,
    #[serde(default)]
    pub readonly: bool,
}

impl StatFingerprint {
    pub(super) fn from_metadata(meta: &Metadata) -> Self {
        let s = crate::platform::fs::cap_stat_summary(meta);
        Self {
            len: s.len,
            mtime_ns: s.mtime_ns,
            ctime_ns: s.ctime_ns,
            ino: s.ino,
            dev: s.dev,
            mode: s.mode,
            nlink: s.nlink,
            readonly: s.readonly,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Version {
    pub(super) stat: StatFingerprint,
    pub(super) hash_hex: String,
    pub(super) encoding: TextEncoding,
    pub(super) bom: bool,
    pub(super) line_ending: LineEnding,
}

impl Version {
    fn new(
        bytes: &[u8],
        meta: &Metadata,
        encoding: TextEncoding,
        bom: bool,
        line_ending: LineEnding,
    ) -> Self {
        Self::from_hash(blake3::hash(bytes), meta, encoding, bom, line_ending)
    }

    fn from_hash(
        hash: blake3::Hash,
        meta: &Metadata,
        encoding: TextEncoding,
        bom: bool,
        line_ending: LineEnding,
    ) -> Self {
        Self {
            stat: StatFingerprint::from_metadata(meta),
            hash_hex: hash.to_hex().to_string(),
            encoding,
            bom,
            line_ending,
        }
    }

    /// `true` when the file had lone `CR` or mixed line endings (`DP-31`).
    pub const fn requires_line_ending_normalization(&self) -> bool {
        self.line_ending.requires_normalization()
    }

    pub(super) fn hash(&self) -> Option<blake3::Hash> {
        blake3::Hash::from_hex(&self.hash_hex).ok()
    }

    pub(super) fn revision(&self) -> Revision {
        // Opaque adapter-local token carrying stat fingerprint, content hash
        // and wire format metadata (`DP-22`, `DP-31`, `DP-32`).
        let encoded = serde_json::to_string(self).expect("local Version serializes");
        Revision(format!("local-v2:{encoded}"))
    }

    pub(super) fn parse(revision: &Revision) -> Result<Self> {
        let payload = revision
            .0
            .strip_prefix("local-v2:")
            .ok_or_else(|| Error::from("Invalid local document revision"))?;
        serde_json::from_str(payload).map_err(|_| Error::from("Invalid local document revision"))
    }
}

#[derive(Clone, Debug)]
pub struct Document {
    pub text: String,
    pub(super) version: Version,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
}

#[derive(Debug)]
pub struct WriteOutcome {
    pub document: Document,
    /// The conditional write observed a newer disk snapshot without replacing it.
    pub updated: bool,
}

fn io(error: std::io::Error) -> Error {
    use std::io::ErrorKind as Io;
    let kind = match error.kind() {
        Io::NotFound => ErrorKind::NotFound,
        Io::PermissionDenied => ErrorKind::PermissionDenied,
        Io::AlreadyExists => ErrorKind::AlreadyExists,
        Io::InvalidInput => ErrorKind::InvalidInput,
        Io::InvalidData => ErrorKind::InvalidData,
        _ => ErrorKind::Io,
    };
    Error::new(kind, error.to_string())
}

impl Document {
    pub(super) fn into_snapshot(self) -> TextSnapshot {
        TextSnapshot {
            revision: self.version.revision(),
            text: self.text,
            encoding: self.encoding,
            line_ending: self.line_ending,
        }
    }
}

fn decode_utf16(payload: &[u8], little_endian: bool) -> (String, bool) {
    let mut lossless = payload.len().is_multiple_of(2);
    let units = payload.chunks_exact(2).map(|pair| {
        if little_endian {
            u16::from_le_bytes([pair[0], pair[1]])
        } else {
            u16::from_be_bytes([pair[0], pair[1]])
        }
    });
    let mut out = String::with_capacity(payload.len() / 2);
    for decoded in char::decode_utf16(units) {
        match decoded {
            Ok(ch) => out.push(ch),
            Err(_) => {
                lossless = false;
                out.push(char::REPLACEMENT_CHARACTER);
            }
        }
    }
    if !payload.len().is_multiple_of(2) {
        out.push(char::REPLACEMENT_CHARACTER);
    }
    (out, lossless)
}

/// Decodes raw file bytes into normalized `\n` text along with `(encoding, bom, line_ending)`.
///
/// Supports (`DP-31`, `DP-32`):
/// - `Utf8` (with or without `EF BB BF` BOM)
/// - `Utf16Le` (with `FF FE` BOM)
/// - `Utf16Be` (with `FE FF` BOM)
/// - `Gb18030` (validated lossless round-trip)
/// - `Lossy` fallback (opens read-only with `U+FFFD` replacement)
///
/// Rejects binary inputs containing `NUL` (`\0`) with [`ErrorKind::InvalidData`].
pub(super) fn decode_text_bytes(bytes: &[u8]) -> Result<(String, TextEncoding, bool, LineEnding)> {
    let (raw_text, encoding, bom) = if let Some(payload) = bytes.strip_prefix(&[0xff, 0xfe]) {
        let (decoded, lossless) = decode_utf16(payload, true);
        let enc = if lossless {
            TextEncoding::Utf16Le
        } else {
            TextEncoding::Lossy
        };
        (decoded, enc, true)
    } else if let Some(payload) = bytes.strip_prefix(&[0xfe, 0xff]) {
        let (decoded, lossless) = decode_utf16(payload, false);
        let enc = if lossless {
            TextEncoding::Utf16Be
        } else {
            TextEncoding::Lossy
        };
        (decoded, enc, true)
    } else {
        if bytes.contains(&0) {
            return Err(Error::new(
                ErrorKind::InvalidData,
                crate::localization::t("native.workspace.binary"),
            ));
        }
        let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
        let payload = if bom { &bytes[3..] } else { bytes };
        if let Ok(utf8) = std::str::from_utf8(payload) {
            (utf8.to_owned(), TextEncoding::Utf8, bom)
        } else if let Some(gb) =
            encoding_rs::GB18030.decode_without_bom_handling_and_without_replacement(bytes)
        {
            let (reencoded, _, had_errors) = encoding_rs::GB18030.encode(&gb);
            let roundtrips = !had_errors
                && encoding_rs::GB18030
                    .decode_without_bom_handling_and_without_replacement(&reencoded)
                    .as_deref()
                    == Some(gb.as_ref());
            if roundtrips {
                (gb.into_owned(), TextEncoding::Gb18030, false)
            } else {
                (
                    String::from_utf8_lossy(payload).into_owned(),
                    TextEncoding::Lossy,
                    bom,
                )
            }
        } else {
            (
                String::from_utf8_lossy(payload).into_owned(),
                TextEncoding::Lossy,
                bom,
            )
        }
    };

    if raw_text.contains('\0') {
        return Err(Error::new(
            ErrorKind::InvalidData,
            crate::localization::t("native.workspace.binary"),
        ));
    }

    let (normalized, line_ending) = LineEnding::detect_and_normalize(&raw_text);
    Ok((normalized, encoding, bom, line_ending))
}

/// Encodes normalized `\n` `text` back to `(encoding, bom, line_ending)` and
/// verifies strict decode equality (`DP-32` round-trip fidelity guard).
pub(super) fn encode_with_roundtrip_guard(
    text: &str,
    encoding: TextEncoding,
    bom: bool,
    line_ending: LineEnding,
) -> Result<Vec<u8>> {
    if text.len() > MAX_TEXT_BYTES || text.contains(['\0', '\r']) {
        return Err(crate::localization::t("native.workspace.invalidText").into());
    }
    if encoding.is_lossy() {
        return Err(Error::new(
            ErrorKind::PermissionDenied,
            crate::localization::t("editor.fileMode.readOnlyEncoding"),
        ));
    }
    if line_ending.requires_normalization() {
        return Err(Error::new(
            ErrorKind::LineEndingNormalizationRequired,
            crate::localization::t("native.workspace.lineEndings"),
        ));
    }

    let wire_text: std::borrow::Cow<'_, str> = match line_ending {
        LineEnding::Crlf => std::borrow::Cow::Owned(text.replace('\n', "\r\n")),
        LineEnding::Lf => std::borrow::Cow::Borrowed(text),
        LineEnding::Cr | LineEnding::Mixed { .. } => unreachable!(),
    };

    let bytes = match encoding {
        TextEncoding::Utf8 => {
            let mut out = Vec::with_capacity((if bom { 3 } else { 0 }) + wire_text.len());
            if bom {
                out.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            }
            out.extend_from_slice(wire_text.as_bytes());
            out
        }
        TextEncoding::Utf16Le => {
            let mut out = Vec::with_capacity(2 + wire_text.len() * 2);
            out.extend_from_slice(&[0xff, 0xfe]);
            for unit in wire_text.encode_utf16() {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            out
        }
        TextEncoding::Utf16Be => {
            let mut out = Vec::with_capacity(2 + wire_text.len() * 2);
            out.extend_from_slice(&[0xfe, 0xff]);
            for unit in wire_text.encode_utf16() {
                out.extend_from_slice(&unit.to_be_bytes());
            }
            out
        }
        TextEncoding::Gb18030 => {
            let (encoded, _, had_errors) = encoding_rs::GB18030.encode(&wire_text);
            if had_errors {
                return Err(Error::new(
                    ErrorKind::EncodingRoundTrip,
                    crate::localization::t("native.workspace.notUtf8"),
                ));
            }
            encoded.into_owned()
        }
        TextEncoding::Lossy => unreachable!(),
    };

    if bytes.len() > MAX_TEXT_BYTES {
        return Err(crate::localization::t("native.workspace.encodedTooLarge").into());
    }

    // Round-trip fidelity guard (`DP-32`): decode the encoded bytes strictly in
    // the target encoding and verify exact character-for-character equality.
    let strict_decoded = match encoding {
        TextEncoding::Utf8 => {
            let payload = if bom {
                bytes.strip_prefix(&[0xef, 0xbb, 0xbf])
            } else {
                Some(bytes.as_slice())
            };
            payload
                .and_then(|s| std::str::from_utf8(s).ok())
                .map(str::to_owned)
        }
        TextEncoding::Utf16Le => bytes
            .strip_prefix(&[0xff, 0xfe])
            .map(|p| decode_utf16(p, true))
            .and_then(|(s, lossless)| lossless.then_some(s)),
        TextEncoding::Utf16Be => bytes
            .strip_prefix(&[0xfe, 0xff])
            .map(|p| decode_utf16(p, false))
            .and_then(|(s, lossless)| lossless.then_some(s)),
        TextEncoding::Gb18030 => encoding_rs::GB18030
            .decode_without_bom_handling_and_without_replacement(&bytes)
            .map(|cow| cow.into_owned()),
        TextEncoding::Lossy => None,
    };

    if strict_decoded.as_deref() != Some(wire_text.as_ref()) {
        return Err(Error::new(
            ErrorKind::EncodingRoundTrip,
            crate::localization::t("native.workspace.notUtf8"),
        ));
    }

    let (normalized_back, _, _, _) = decode_text_bytes(&bytes).map_err(|_| {
        Error::new(
            ErrorKind::EncodingRoundTrip,
            crate::localization::t("native.workspace.notUtf8"),
        )
    })?;
    if normalized_back != text {
        return Err(Error::new(
            ErrorKind::EncodingRoundTrip,
            crate::localization::t("native.workspace.notUtf8"),
        ));
    }

    Ok(bytes)
}

fn validate(path: &Path, allow_empty: bool) -> Result<()> {
    if (!allow_empty && path.as_os_str().is_empty())
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(crate::localization::t("native.workspace.relativeOnly").into());
    }
    Ok(())
}

/// Copies OS file metadata (Unix owner/xattrs, macOS creation time, and mode
/// bits) from `src` to `dst` before atomic rename (`DP-30`).
fn copy_file_metadata(
    src: &cap_std::fs::File,
    src_meta: &Metadata,
    dst: &cap_std::fs::File,
) -> std::io::Result<()> {
    crate::platform::fs::copy_file_metadata(src, src_meta, dst)
}

fn open_nofollow_read(dir: &Dir, name: &Path) -> Result<cap_std::fs::File> {
    crate::platform::fs::open_nofollow_read(dir, name).map_err(io)
}

fn open_nofollow_read_write(dir: &Dir, name: &Path) -> Result<cap_std::fs::File> {
    crate::platform::fs::open_nofollow_read_write(dir, name).map_err(io)
}

fn sync_dir(dir: &Dir) -> Result<()> {
    crate::platform::fs::sync_dir(dir).map_err(io)
}

impl Workspace {
    fn markdown_dialect(&self) -> Result<Option<crate::formats::markdown::MarkdownDialect>> {
        let directory = match self.directory(Path::new(".ok")) {
            Ok(directory) => directory,
            Err(error) if matches!(error.kind, ErrorKind::NotFound | ErrorKind::InvalidInput) => {
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        match directory.symlink_metadata("config.yml") {
            Ok(metadata) => Ok(metadata
                .is_file()
                .then_some(crate::formats::markdown::MarkdownDialect::OpenKnowledgeMdx)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(io(error)),
        }
    }
    pub fn open_with(path: &Path, legacy_text: bool) -> Result<Arc<Self>> {
        Self::open_with_limit(path, legacy_text, MAX_TEXT_BYTES)
    }
    fn open_with_limit(path: &Path, legacy_text: bool, text_limit: usize) -> Result<Arc<Self>> {
        let path = std::fs::canonicalize(path).map_err(io)?;
        let dir = Dir::open_ambient_dir(&path, cap_std::ambient_authority()).map_err(io)?;
        Ok(Arc::new(Self {
            path,
            dir,
            legacy_text,
            text_limit,
        }))
    }

    fn directory(&self, relative: &Path) -> Result<Dir> {
        validate(relative, true)?;
        let mut dir = self.dir.try_clone().map_err(io)?;
        for part in relative.components() {
            dir = Self::open_directory(&dir, Path::new(part.as_os_str()))?;
        }
        Ok(dir)
    }
    fn open_directory(parent: &Dir, name: &Path) -> Result<Dir> {
        if !parent.symlink_metadata(name).map_err(io)?.is_dir() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        crate::platform::fs::open_directory_nofollow(parent, name).map_err(io)
    }
    fn regular_entry(dir: &Dir, name: &Path) -> Result<Metadata> {
        let meta = dir.symlink_metadata(name).map_err(io)?;
        if !meta.is_file() && !meta.is_dir() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        Ok(meta)
    }

    pub fn list(&self, relative: &Path) -> Result<Vec<Node>> {
        let dir = self.directory(relative)?;
        let mut nodes = vec![];
        for entry in dir.entries().map_err(io)? {
            let entry = entry.map_err(io)?;
            let ty = entry.file_type().map_err(io)?;
            if !ty.is_file() && !ty.is_dir() {
                continue;
            }
            if nodes.len() == MAX_DIRECTORY_ENTRIES {
                return Err(crate::localization::t("native.workspace.folderLimit").into());
            }
            nodes.push(Node {
                name: entry.file_name().to_string_lossy().into_owned(),
                folder: ty.is_dir(),
                path: relative.join(entry.file_name()),
                ..Default::default()
            });
        }
        nodes.sort_by_cached_key(|n| (!n.folder, n.name.to_lowercase()));
        Ok(nodes)
    }

    fn parent(&self, relative: &Path) -> Result<(Dir, PathBuf)> {
        validate(relative, false)?;
        let name = relative
            .file_name()
            .ok_or(crate::localization::t("native.workspace.filenameRequired"))?;
        Ok((
            self.directory(relative.parent().unwrap_or(Path::new("")))?,
            PathBuf::from(name),
        ))
    }

    /// Fast `lstat`-based fingerprint used by background observation (`DP-21`).
    pub(super) fn stat_fingerprint(&self, relative: &Path) -> Result<StatFingerprint> {
        let (dir, name) = self.parent(relative)?;
        let meta = dir.symlink_metadata(&name).map_err(io)?;
        if !meta.is_file() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        Ok(StatFingerprint::from_metadata(&meta))
    }

    /// Fast size/kind preflight without reading file contents (`RG-02`).
    pub fn stat_entry(&self, relative: &Path) -> Result<EntryStat> {
        let (dir, name) = self.parent(relative)?;
        let meta = dir.symlink_metadata(&name).map_err(io)?;
        Ok(EntryStat {
            size: meta.len(),
            is_file: meta.is_file(),
            readonly: meta.permissions().readonly(),
        })
    }

    /// Reads at most `max_bytes` from the start of a regular file (`RG-01`),
    /// even when the full file exceeds `MAX_TEXT_BYTES`.
    pub fn read_head(&self, relative: &Path, max_bytes: usize) -> Result<Vec<u8>> {
        let (dir, name) = self.parent(relative)?;
        let meta = dir.symlink_metadata(&name).map_err(io)?;
        if !meta.is_file() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        let mut file = open_nofollow_read(&dir, &name)?;
        let opened = file.metadata().map_err(io)?;
        if !opened.is_file() {
            return Err(crate::localization::t("native.workspace.typeChanged").into());
        }
        let capped = max_bytes.min(MAX_TEXT_BYTES);
        let mut buf = Vec::with_capacity(capped.min(opened.len() as usize));
        Read::by_ref(&mut file)
            .take(capped as u64)
            .read_to_end(&mut buf)
            .map_err(io)?;
        Ok(buf)
    }

    /// Reads and hashes raw file bytes when `StatFingerprint` changed (`DP-21`).
    pub(super) fn read_hash_and_stat(
        &self,
        relative: &Path,
    ) -> Result<(StatFingerprint, blake3::Hash)> {
        let (dir, name) = self.parent(relative)?;
        let (bytes, meta) = Self::read_from(&dir, &name)?;
        // Validate text eligibility (e.g. reject binary replacement) just like `read`.
        let _ = decode_text_bytes(&bytes)?;
        Ok((StatFingerprint::from_metadata(&meta), blake3::hash(&bytes)))
    }

    fn read_from(dir: &Dir, name: &Path) -> Result<(Vec<u8>, Metadata)> {
        Self::read_bounded(dir, name, MAX_TEXT_BYTES as u64)
    }
    fn open_regular(dir: &Dir, name: &Path) -> Result<(cap_std::fs::File, Metadata)> {
        let meta = dir.symlink_metadata(name).map_err(io)?;
        if !meta.is_file() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        let file = open_nofollow_read(dir, name)?;
        let opened = file.metadata().map_err(io)?;
        if !opened.is_file() {
            return Err(crate::localization::t("native.workspace.typeChanged").into());
        }
        Ok((file, opened))
    }
    fn read_bounded(dir: &Dir, name: &Path, max: u64) -> Result<(Vec<u8>, Metadata)> {
        let (mut file, opened) = Self::open_regular(dir, name)?;
        if opened.len() > max {
            return Err(crate::localization::t("native.workspace.fileTooLarge").into());
        }
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take(max.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(io)?;
        let after = file.metadata().map_err(io)?;
        if opened.len() != after.len() || opened.modified().ok() != after.modified().ok() {
            return Err(crate::localization::t("native.workspace.changedWhileReading").into());
        }
        if bytes.len() as u64 > max {
            return Err(crate::localization::t("native.workspace.fileTooLarge").into());
        }
        Ok((bytes, opened))
    }

    fn build_document(bytes: &[u8], meta: &Metadata) -> Result<Document> {
        let (text, encoding, bom, line_ending) = decode_text_bytes(bytes)?;
        let version = Version::new(bytes, meta, encoding, bom, line_ending);
        Ok(Document {
            text,
            version,
            encoding,
            line_ending,
        })
    }

    pub fn read(&self, relative: &Path) -> Result<Document> {
        let (dir, name) = self.parent(relative)?;
        let (bytes, meta) = Self::read_bounded(&dir, &name, self.text_limit as u64)?;
        Self::build_document(&bytes, &meta)
    }

    /// Publish a new entry without replacing a name that another writer created.
    /// Bytes are fully synced before the no-replace hard-link publication.
    pub fn create_entry(
        &self,
        parent: &Path,
        name: &str,
        folder: bool,
        text: &str,
    ) -> Result<PathBuf> {
        validate(Path::new(name), false)?;
        if Path::new(name).components().count() != 1 || name.contains(['\\', '\0']) {
            return Err(crate::localization::t("native.workspace.singleFilename").into());
        }
        let dir = self.directory(parent)?;
        if folder {
            dir.create_dir(name).map_err(io)?;
        } else {
            if text.len() > MAX_TEXT_BYTES {
                return Err(crate::localization::t("native.workspace.templateTooLarge").into());
            }
            let stage = format!(".puppyone-create-{}.tmp", Uuid::new_v4());
            let result = (|| -> Result<()> {
                let mut options = OpenOptions::new();
                options.write(true).create_new(true);
                let mut file = dir.open_with(&stage, &options).map_err(io)?;
                file.write_all(text.as_bytes()).map_err(io)?;
                file.sync_all().map_err(io)?;
                dir.hard_link(&stage, &dir, name).map_err(io)
            })();
            let _ = dir.remove_file(&stage);
            result?;
        }
        Ok(parent.join(name))
    }

    fn single_name(name: &str) -> Result<()> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(crate::localization::t("workspace.node.error.nameRequired").into());
        }
        if trimmed != name
            || name == "."
            || name == ".."
            || name.contains(['/', '\\', '\0'])
            || Path::new(name).components().count() != 1
        {
            return Err(crate::localization::t("workspace.node.error.nameInvalid").into());
        }
        Ok(())
    }

    fn exists(dir: &Dir, name: &Path) -> bool {
        dir.symlink_metadata(name).is_ok()
    }

    /// `renameWorkspaceEntry`: same folder, refuses to replace an existing item.
    pub fn rename_entry(&self, relative: &Path, next_name: &str) -> Result<PathBuf> {
        Self::single_name(next_name)?;
        let (dir, name) = self.parent(relative)?;
        Self::regular_entry(&dir, &name)?;
        let parent = relative.parent().unwrap_or(Path::new("")).to_owned();
        if name.as_os_str() == next_name {
            return Ok(relative.to_owned());
        }
        rename::exclusive(&dir, &name, &dir, Path::new(next_name))?;
        Ok(parent.join(next_name))
    }
    /// `deleteWorkspaceEntry`: only regular files and folders, never links.
    pub fn remove_entry(&self, relative: &Path) -> Result<()> {
        let (dir, name) = self.parent(relative)?;
        let meta = Self::regular_entry(&dir, &name)?;
        if meta.is_dir() {
            dir.remove_dir_all(&name).map_err(io)
        } else {
            dir.remove_file(&name).map_err(io)
        }
    }

    /// `moveWorkspaceEntry` into another folder, keeping the name.
    pub fn move_entry(&self, from: &Path, to_folder: &Path) -> Result<PathBuf> {
        let (source_dir, name) = self.parent(from)?;
        Self::regular_entry(&source_dir, &name)?;
        if to_folder.starts_with(from) {
            return Err(crate::localization::t("native.workspace.moveIntoSelf").into());
        }
        if from.parent().unwrap_or(Path::new("")) == to_folder {
            return Ok(from.to_owned());
        }
        let target_dir = self.directory(to_folder)?;
        rename::exclusive(&source_dir, &name, &target_dir, &name)?;
        Ok(to_folder.join(name))
    }

    pub(crate) fn keep_both_name(preferred: &str, index: usize, folder: bool) -> String {
        if index == 0 {
            return preferred.into();
        }
        let extension = if folder {
            String::new()
        } else {
            crate::formats::matched_extension(preferred)
                .filter(|e| preferred.len() > e.len() + 1)
                .map(|e| format!(".{}", &preferred[preferred.len() - e.len()..]))
                .unwrap_or_default()
        };
        let stem = &preferred[..preferred.len() - extension.len()];
        let (stem, base) = match stem.rsplit_once(" copy") {
            Some((head, tail))
                if !head.is_empty()
                    && (tail.is_empty()
                        || tail.trim().parse::<usize>().is_ok() && tail.starts_with(' ')) =>
            {
                (
                    head,
                    if tail.is_empty() {
                        1
                    } else {
                        tail.trim().parse().unwrap_or(1)
                    },
                )
            }
            _ => (stem, 0),
        };
        let number = base + index;
        let suffix = if number == 1 {
            " copy".to_owned()
        } else {
            format!(" copy {number}")
        };
        format!("{stem}{suffix}{extension}")
    }

    fn copy_tree(source: &Dir, name: &Path, target: &Dir, target_name: &str) -> Result<()> {
        let meta = source.symlink_metadata(name).map_err(io)?;
        if meta.is_symlink() {
            return Err(crate::localization::t("native.workspace.symlinkCopy").into());
        }
        if meta.is_dir() {
            let from = Self::open_directory(source, name)?;
            target.create_dir(target_name).map_err(io)?;
            // Cleanup belongs only to the invocation that created this entry.
            // A colliding invocation must never remove the winner's tree.
            let result = (|| {
                let to = Self::open_directory(target, Path::new(target_name))?;
                for entry in from.entries().map_err(io)? {
                    let entry = entry.map_err(io)?;
                    let child = entry.file_name();
                    Self::copy_tree(&from, Path::new(&child), &to, &child.to_string_lossy())?;
                }
                // Populate first, then restore a potentially read-only mode.
                to.set_permissions(".", meta.permissions()).map_err(io)
            })();
            if result.is_err() {
                let _ = Self::discard_created_tree(target, Path::new(target_name));
            }
            result
        } else if meta.is_file() {
            let mut input = open_nofollow_read(source, name)?;
            if !input.metadata().map_err(io)?.is_file() {
                return Err(crate::localization::t("native.workspace.regularOnly").into());
            }
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            let mut output = target.open_with(target_name, &options).map_err(io)?;
            let result = (|| {
                std::io::copy(&mut input, &mut output).map_err(io)?;
                output.set_permissions(meta.permissions()).map_err(io)?;
                output.sync_all().map_err(io)
            })();
            if result.is_err() {
                let _ = target.remove_file(target_name);
            }
            result
        } else {
            Err(crate::localization::t("native.workspace.copyKind").into())
        }
    }
    /// Only called for a tree this copy successfully created. Earlier children
    /// may already have their source's read-only mode, so ordinary remove_all
    /// cannot roll them back. Make the copied directories removable, never the
    /// originals, and do not follow links encountered during cleanup.
    fn discard_created_tree(parent: &Dir, name: &Path) -> Result<()> {
        let meta = parent.symlink_metadata(name).map_err(io)?;
        if !meta.is_dir() {
            return parent.remove_file(name).map_err(io);
        }
        let dir = Self::open_directory(parent, name)?;
        crate::platform::fs::make_dir_removable(&dir, &meta).map_err(io)?;
        for entry in dir.entries().map_err(io)? {
            Self::discard_created_tree(&dir, Path::new(&entry.map_err(io)?.file_name()))?;
        }
        parent.remove_dir(name).map_err(io)
    }
    /// `copyWorkspaceEntry` with keep-both naming (`name copy`, `name copy 2`).
    pub fn copy_entry(&self, from: &Path, to_folder: &Path) -> Result<PathBuf> {
        let (source_dir, name) = self.parent(from)?;
        if to_folder == from || to_folder.starts_with(from) {
            return Err(crate::localization::t("native.workspace.copyIntoSelf").into());
        }
        let folder = source_dir.symlink_metadata(&name).map_err(io)?.is_dir();
        let target_dir = self.directory(to_folder)?;
        let duplicate = from.parent().unwrap_or(Path::new("")) == to_folder;
        let preferred = name.to_string_lossy().into_owned();
        for index in usize::from(duplicate)..=10_000 {
            let candidate = Self::keep_both_name(&preferred, index, folder);
            if Self::exists(&target_dir, Path::new(&candidate)) {
                continue;
            }
            match Self::copy_tree(&source_dir, &name, &target_dir, &candidate) {
                Ok(()) => return Ok(to_folder.join(candidate)),
                Err(error) if error.kind == ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(crate::localization::t("native.workspace.nameExhausted").into())
    }

    /// What a dropped item is for a provider that uploads it: a file's bytes
    /// (never over `max`) or a folder's entries. Symlinks are refused.
    pub(crate) fn read_import_source(source: &Path, max: usize) -> Result<ImportSource> {
        let meta = std::fs::symlink_metadata(source).map_err(io)?;
        if meta.is_symlink() {
            return Err(crate::localization::t("native.workspace.symlinkImport").into());
        }
        if meta.is_dir() {
            let mut children = vec![];
            for entry in std::fs::read_dir(source).map_err(io)? {
                children.push(entry.map_err(io)?.path());
            }
            return Ok(ImportSource::Folder(children));
        }
        if !meta.is_file() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        if meta.len() > max as u64 {
            return Err(Error::from("Cloud files are limited to 8 MiB"));
        }
        let (parent, name) = (source.parent(), source.file_name());
        let (Some(parent), Some(name)) = (parent, name) else {
            return Err(crate::localization::t("native.workspace.chooseItem").into());
        };
        let dir = Dir::open_ambient_dir(parent, cap_std::ambient_authority()).map_err(io)?;
        let (bytes, _) = Self::read_bounded(&dir, Path::new(name), max as u64)?;
        Ok(ImportSource::File(bytes))
    }

    /// Import a user-dropped file or folder from outside the grant (copy only).
    pub fn import_external(&self, source: &Path, to_folder: &Path) -> Result<PathBuf> {
        if !source.is_absolute() {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "Import requires an absolute source path",
            ));
        }
        let meta = std::fs::symlink_metadata(source).map_err(io)?;
        if meta.is_symlink() {
            return Err(crate::localization::t("native.workspace.symlinkImport").into());
        }
        let parent = source
            .parent()
            .ok_or(crate::localization::t("native.workspace.chooseItem"))?;
        let name = source
            .file_name()
            .ok_or(crate::localization::t("native.workspace.chooseItem"))?;
        let source_dir = Dir::open_ambient_dir(parent, cap_std::ambient_authority()).map_err(io)?;
        let target_dir = self.directory(to_folder)?;
        let preferred = name.to_string_lossy().into_owned();
        Self::copy_tree(&source_dir, Path::new(name), &target_dir, &preferred)
            .map(|()| to_folder.join(preferred))
    }

    /// Absolute path of an entry, for platform reveal/open actions.
    pub fn resource(&self, relative: &Path) -> Result<PathBuf> {
        let (dir, name) = self.parent(relative)?;
        let meta = dir.symlink_metadata(&name).map_err(io)?;
        if !meta.is_file() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        Ok(self.path.join(relative))
    }
    pub fn preview_bytes(&self, relative: &Path, max: u64) -> Result<Vec<u8>> {
        let (dir, name) = self.parent(relative)?;
        Self::read_bounded(&dir, &name, max).map(|(bytes, _)| bytes)
    }
    pub fn preview_reader(&self, relative: &Path) -> Result<super::ports::ResourceReader> {
        let (dir, name) = self.parent(relative)?;
        let (file, metadata) = Self::open_regular(&dir, &name)?;
        Ok(super::ports::ResourceReader {
            length: metadata.len(),
            reader: Box::new(file.into_std()),
        })
    }
    pub fn absolute(&self, relative: &Path) -> Result<PathBuf> {
        validate(relative, true)?;
        Ok(self.path.join(relative))
    }

    /// Checks whether the on-disk entry still matches `baseline` (`DP-22`).
    ///
    /// Fast path: compares `StatFingerprint` first (`0` disk reads when equal).
    /// Fallback: if `stat` differs while `len` matches, reads once and compares
    /// `blake3` hash so metadata-only touches do not cause false conflicts while
    /// same-length edits are caught cleanly.
    fn check_precondition(dir: &Dir, name: &Path, baseline: &Version) -> Result<Precondition> {
        let meta = dir.symlink_metadata(name).map_err(io)?;
        if !meta.is_file() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        let current_stat = StatFingerprint::from_metadata(&meta);
        // On coarse-timestamp filesystems (e.g. Linux ext4 `CLOCK_REALTIME_COARSE`
        // ~4ms ticks), an external same-size write right after `read` can share
        // the exact same `mtime`/`ctime` and inode. Only trust the zero-read stat
        // fast path once the file's mtime is safely outside the coarse tick window.
        let stat_fresh = meta
            .modified()
            .ok()
            .and_then(|m| {
                std::time::SystemTime::now()
                    .duration_since(m.into_std())
                    .ok()
            })
            .is_some_and(|age| age >= std::time::Duration::from_millis(50));
        if current_stat == baseline.stat && stat_fresh {
            return Ok(Precondition::Matched(meta));
        }

        // Stat differs: read once to either confirm identical content or return
        // the conflict snapshot without a second read.
        let (disk_bytes, opened_meta) = Self::read_from(dir, name)?;
        let disk_hash = blake3::hash(&disk_bytes);
        if Some(disk_hash) == baseline.hash() {
            Ok(Precondition::Matched(opened_meta))
        } else {
            let conflict = Self::build_document(&disk_bytes, &opened_meta)?;
            Ok(Precondition::Conflict(conflict))
        }
    }

    pub(super) fn save_version(
        &self,
        relative: &Path,
        baseline: &Version,
        target_line_ending: LineEnding,
        text: &str,
    ) -> Result<WriteOutcome> {
        if baseline.requires_line_ending_normalization()
            && target_line_ending.requires_normalization()
        {
            return Err(Error::new(
                ErrorKind::LineEndingNormalizationRequired,
                crate::localization::t("native.workspace.lineEndings"),
            ));
        }
        let lock = write_lock(self.path.join(relative));
        let _write = lock.lock().unwrap_or_else(|e| e.into_inner());
        if self.legacy_text && baseline.encoding != TextEncoding::Utf8 {
            return Err(Error::new(
                ErrorKind::PermissionDenied,
                crate::localization::t("editor.fileMode.readOnlyEncoding"),
            ));
        }
        let bytes =
            encode_with_roundtrip_guard(text, baseline.encoding, baseline.bom, target_line_ending)?;
        if bytes.len() > self.text_limit {
            return Err(crate::localization::t("native.workspace.encodedTooLarge").into());
        }
        let encoded_hash = blake3::hash(&bytes);

        let (dir, name) = self.parent(relative)?;
        let meta = match Self::check_precondition(&dir, &name, baseline)? {
            Precondition::Matched(meta) => meta,
            Precondition::Conflict(document) => {
                return Ok(WriteOutcome {
                    document,
                    updated: true,
                });
            }
        };

        if meta.permissions().readonly() {
            return Err(Error::new(
                ErrorKind::PermissionDenied,
                crate::localization::t("native.workspace.readOnly"),
            ));
        }

        // Unchanged byte payload: skip touching the inode or timestamps (`0` reads/writes).
        if bytes.len() as u64 == meta.len() && Some(encoded_hash) == baseline.hash() {
            let version = Version::from_hash(
                encoded_hash,
                &meta,
                baseline.encoding,
                baseline.bom,
                target_line_ending,
            );
            return Ok(WriteOutcome {
                document: Document {
                    text: text.to_owned(),
                    version,
                    encoding: baseline.encoding,
                    line_ending: target_line_ending,
                },
                updated: false,
            });
        }

        let hard_linked = StatFingerprint::from_metadata(&meta).nlink > 1;
        if hard_linked {
            Self::save_in_place_with_backup(
                &dir,
                &name,
                baseline,
                target_line_ending,
                text,
                &bytes,
                encoded_hash,
            )
        } else {
            Self::save_atomic_replace(
                &dir,
                &name,
                baseline,
                target_line_ending,
                text,
                &bytes,
                encoded_hash,
            )
        }
    }

    fn save_atomic_replace(
        dir: &Dir,
        name: &Path,
        baseline: &Version,
        target_line_ending: LineEnding,
        text: &str,
        bytes: &[u8],
        encoded_hash: blake3::Hash,
    ) -> Result<WriteOutcome> {
        let temporary = PathBuf::from(format!(".puppyone-rust-{}.tmp", Uuid::new_v4()));
        let result = (|| -> Result<WriteOutcome> {
            let src_file = open_nofollow_read(dir, name)?;
            let src_meta = src_file.metadata().map_err(io)?;
            if !src_meta.is_file() {
                return Err(crate::localization::t("native.workspace.regularOnly").into());
            }

            let mut staged = dir
                .open_with(&temporary, OpenOptions::new().write(true).create_new(true))
                .map_err(io)?;
            staged.write_all(bytes).map_err(io)?;
            copy_file_metadata(&src_file, &src_meta, &staged).map_err(io)?;
            staged.sync_all().map_err(io)?;
            drop(staged);
            drop(src_file);

            match Self::check_precondition(dir, name, baseline)? {
                Precondition::Matched(_) => {}
                Precondition::Conflict(document) => {
                    return Ok(WriteOutcome {
                        document,
                        updated: true,
                    });
                }
            }

            crate::platform::fs::rename_with_retry(dir, &temporary, dir, name).map_err(io)?;
            sync_dir(dir)?;

            // Derive post-write Version from `stat` + already-computed `encoded_hash` (`DP-22`).
            let post_meta = dir.symlink_metadata(name).map_err(io)?;
            if !post_meta.is_file() {
                return Err(crate::localization::t("native.workspace.typeChanged").into());
            }
            let version = Version::from_hash(
                encoded_hash,
                &post_meta,
                baseline.encoding,
                baseline.bom,
                target_line_ending,
            );
            Ok(WriteOutcome {
                document: Document {
                    text: text.to_owned(),
                    version,
                    encoding: baseline.encoding,
                    line_ending: target_line_ending,
                },
                updated: false,
            })
        })();
        let _ = dir.remove_file(&temporary);
        result
    }

    /// Preserves inode identity across hard-linked peers (`nlink > 1`, `DP-30`):
    /// stages a synced sibling backup first, writes in place + `fsync`, and
    /// restores from backup on partial failure (leaving backup intact if restore
    /// itself fails).
    fn save_in_place_with_backup(
        dir: &Dir,
        name: &Path,
        baseline: &Version,
        target_line_ending: LineEnding,
        text: &str,
        bytes: &[u8],
        encoded_hash: blake3::Hash,
    ) -> Result<WriteOutcome> {
        let mut target = open_nofollow_read_write(dir, name)?;
        let opened_meta = target.metadata().map_err(io)?;
        if !opened_meta.is_file() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        if opened_meta.permissions().readonly() {
            return Err(Error::new(
                ErrorKind::PermissionDenied,
                crate::localization::t("native.workspace.readOnly"),
            ));
        }

        let mut original = Vec::new();
        Read::by_ref(&mut target)
            .take((MAX_TEXT_BYTES + 1) as u64)
            .read_to_end(&mut original)
            .map_err(io)?;
        if original.len() > MAX_TEXT_BYTES {
            return Err(crate::localization::t("native.workspace.fileTooLarge").into());
        }
        if Some(blake3::hash(&original)) != baseline.hash() {
            let conflict = Self::build_document(&original, &opened_meta)?;
            return Ok(WriteOutcome {
                document: conflict,
                updated: true,
            });
        }

        let backup_name = PathBuf::from(format!(".puppyone-backup-{}.tmp", Uuid::new_v4()));
        {
            let mut backup = dir
                .open_with(
                    &backup_name,
                    OpenOptions::new().write(true).create_new(true),
                )
                .map_err(io)?;
            if let Err(err) = (|| -> std::io::Result<()> {
                backup.write_all(&original)?;
                backup.set_permissions(opened_meta.permissions())?;
                backup.sync_all()
            })() {
                drop(backup);
                let _ = dir.remove_file(&backup_name);
                return Err(io(err));
            }
        }
        if let Err(err) = sync_dir(dir) {
            let _ = dir.remove_file(&backup_name);
            return Err(err);
        }

        let write_in_place = (|| -> std::io::Result<()> {
            target.seek(SeekFrom::Start(0))?;
            target.write_all(bytes)?;
            target.set_len(bytes.len() as u64)?;
            target.sync_all()
        })();

        if let Err(write_err) = write_in_place {
            let restored = (|| -> std::io::Result<()> {
                target.seek(SeekFrom::Start(0))?;
                target.write_all(&original)?;
                target.set_len(original.len() as u64)?;
                target.sync_all()
            })()
            .is_ok();
            if restored {
                let _ = dir.remove_file(&backup_name);
            }
            return Err(io(write_err));
        }

        let _ = dir.remove_file(&backup_name);
        let _ = sync_dir(dir);

        let post_meta = target.metadata().map_err(io)?;
        let version = Version::from_hash(
            encoded_hash,
            &post_meta,
            baseline.encoding,
            baseline.bom,
            target_line_ending,
        );
        Ok(WriteOutcome {
            document: Document {
                text: text.to_owned(),
                version,
                encoding: baseline.encoding,
                line_ending: target_line_ending,
            },
            updated: false,
        })
    }
}

enum Precondition {
    Matched(Metadata),
    Conflict(Document),
}
