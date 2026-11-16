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
    sync::Arc,
};
use uuid::Uuid;
mod adapter;
pub(super) use adapter::open;

use super::MAX_TEXT_BYTES;

pub struct Workspace {
    pub path: PathBuf,
    dir: Dir,
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
        #[cfg(unix)]
        {
            use cap_std::fs::MetadataExt;
            Self {
                len: meta.len(),
                mtime_ns: i128::from(meta.mtime()) * 1_000_000_000 + i128::from(meta.mtime_nsec()),
                ctime_ns: i128::from(meta.ctime()) * 1_000_000_000 + i128::from(meta.ctime_nsec()),
                ino: meta.ino(),
                dev: meta.dev(),
                mode: meta.mode(),
                nlink: meta.nlink(),
                readonly: meta.permissions().readonly(),
            }
        }
        #[cfg(not(unix))]
        {
            let mtime_ns = meta
                .modified()
                .ok()
                .and_then(|t| t.into_std().duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos() as i128);
            Self {
                len: meta.len(),
                mtime_ns,
                ctime_ns: 0,
                ino: 0,
                dev: 0,
                mode: 0,
                nlink: 1,
                readonly: meta.permissions().readonly(),
            }
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

/// Copies extended attributes, owner (best-effort), creation time (macOS) and
/// mode bits from `src` to `dst` before atomic rename (`DP-30`).
fn copy_file_metadata(
    src: &cap_std::fs::File,
    src_meta: &Metadata,
    dst: &cap_std::fs::File,
) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        use std::os::fd::AsRawFd;
        let src_fd = src.as_raw_fd();
        let dst_fd = dst.as_raw_fd();

        if let Ok(dst_meta) = dst.metadata()
            && (dst_meta.uid() != src_meta.uid() || dst_meta.gid() != src_meta.gid())
        {
            unsafe {
                let _ = libc::fchown(dst_fd, src_meta.uid(), src_meta.gid());
            }
        }

        copy_unix_xattrs(src_fd, dst_fd);

        #[cfg(target_os = "macos")]
        copy_macos_creation_time(src_fd, dst_fd);
    }
    #[cfg(not(unix))]
    let _ = src;

    dst.set_permissions(src_meta.permissions())
}

#[cfg(unix)]
fn copy_unix_xattrs(src_fd: std::os::fd::RawFd, dst_fd: std::os::fd::RawFd) {
    let list_len = unsafe { xattr_list(src_fd, std::ptr::null_mut(), 0) };
    if list_len <= 0 {
        return;
    }
    let mut names = vec![0u8; list_len as usize];
    let read_len = unsafe { xattr_list(src_fd, names.as_mut_ptr().cast(), names.len()) };
    if read_len <= 0 {
        return;
    }
    names.truncate(read_len as usize);

    for raw_name in names.split(|&b| b == 0).filter(|s| !s.is_empty()) {
        let mut c_name = Vec::with_capacity(raw_name.len() + 1);
        c_name.extend_from_slice(raw_name);
        c_name.push(0);
        let name_ptr = c_name.as_ptr().cast::<libc::c_char>();

        let val_len = unsafe { xattr_get(src_fd, name_ptr, std::ptr::null_mut(), 0) };
        if val_len < 0 {
            continue;
        }
        let mut value = vec![0u8; val_len as usize];
        let got = if val_len == 0 {
            0
        } else {
            unsafe { xattr_get(src_fd, name_ptr, value.as_mut_ptr().cast(), value.len()) }
        };
        if got < 0 {
            continue;
        }
        unsafe {
            let _ = xattr_set(dst_fd, name_ptr, value.as_ptr().cast(), got as usize);
        }
    }
}

#[cfg(target_os = "macos")]
unsafe fn xattr_list(fd: libc::c_int, buf: *mut libc::c_char, size: libc::size_t) -> libc::ssize_t {
    unsafe { libc::flistxattr(fd, buf, size, 0) }
}

#[cfg(all(unix, not(target_os = "macos")))]
unsafe fn xattr_list(fd: libc::c_int, buf: *mut libc::c_char, size: libc::size_t) -> libc::ssize_t {
    unsafe { libc::flistxattr(fd, buf, size) }
}

#[cfg(target_os = "macos")]
unsafe fn xattr_get(
    fd: libc::c_int,
    name: *const libc::c_char,
    value: *mut libc::c_void,
    size: libc::size_t,
) -> libc::ssize_t {
    unsafe { libc::fgetxattr(fd, name, value, size, 0, 0) }
}

#[cfg(all(unix, not(target_os = "macos")))]
unsafe fn xattr_get(
    fd: libc::c_int,
    name: *const libc::c_char,
    value: *mut libc::c_void,
    size: libc::size_t,
) -> libc::ssize_t {
    unsafe { libc::fgetxattr(fd, name, value, size) }
}

#[cfg(target_os = "macos")]
unsafe fn xattr_set(
    fd: libc::c_int,
    name: *const libc::c_char,
    value: *const libc::c_void,
    size: libc::size_t,
) -> libc::c_int {
    unsafe { libc::fsetxattr(fd, name, value, size, 0, 0) }
}

#[cfg(all(unix, not(target_os = "macos")))]
unsafe fn xattr_set(
    fd: libc::c_int,
    name: *const libc::c_char,
    value: *const libc::c_void,
    size: libc::size_t,
) -> libc::c_int {
    unsafe { libc::fsetxattr(fd, name, value, size, 0) }
}

#[cfg(target_os = "macos")]
fn copy_macos_creation_time(src_fd: std::os::fd::RawFd, dst_fd: std::os::fd::RawFd) {
    let mut st = std::mem::MaybeUninit::<libc::stat>::zeroed();
    if unsafe { libc::fstat(src_fd, st.as_mut_ptr()) } != 0 {
        return;
    }
    let st = unsafe { st.assume_init() };
    if st.st_birthtime <= 0 && st.st_birthtime_nsec <= 0 {
        return;
    }
    let mut attrlist = libc::attrlist {
        bitmapcount: libc::ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: libc::ATTR_CMN_CRTIME,
        volattr: 0,
        dirattr: 0,
        fileattr: 0,
        forkattr: 0,
    };
    let mut crtime = libc::timespec {
        tv_sec: st.st_birthtime,
        tv_nsec: st.st_birthtime_nsec,
    };
    unsafe {
        let _ = libc::fsetattrlist(
            dst_fd,
            (&raw mut attrlist).cast(),
            (&raw mut crtime).cast(),
            std::mem::size_of::<libc::timespec>(),
            0,
        );
    }
}

fn open_nofollow_read(dir: &Dir, name: &Path) -> Result<cap_std::fs::File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    dir.open_with(name, &options).map_err(io)
}

fn open_nofollow_read_write(dir: &Dir, name: &Path) -> Result<cap_std::fs::File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    dir.open_with(name, &options).map_err(io)
}

fn sync_dir(dir: &Dir) -> Result<()> {
    #[cfg(unix)]
    dir.try_clone()
        .map_err(io)?
        .into_std_file()
        .sync_all()
        .map_err(io)?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

impl Workspace {
    pub fn open_with(path: &Path, _legacy_text: bool) -> Result<Arc<Self>> {
        let path = std::fs::canonicalize(path).map_err(io)?;
        let dir = Dir::open_ambient_dir(&path, cap_std::ambient_authority()).map_err(io)?;
        Ok(Arc::new(Self { path, dir }))
    }

    fn directory(&self, relative: &Path) -> Result<Dir> {
        validate(relative, true)?;
        if relative.as_os_str().is_empty() {
            self.dir.try_clone().map_err(io)
        } else {
            self.dir.open_dir(relative).map_err(io)
        }
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
        let meta = dir.symlink_metadata(name).map_err(io)?;
        if !meta.is_file() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        if meta.len() > MAX_TEXT_BYTES as u64 {
            return Err(crate::localization::t("native.workspace.fileTooLarge").into());
        }
        let mut file = open_nofollow_read(dir, name)?;
        let opened = file.metadata().map_err(io)?;
        if !opened.is_file() {
            return Err(crate::localization::t("native.workspace.typeChanged").into());
        }
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take((MAX_TEXT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(io)?;
        let after = file.metadata().map_err(io)?;
        if opened.len() != after.len() || opened.modified().ok() != after.modified().ok() {
            return Err(crate::localization::t("native.workspace.changedWhileReading").into());
        }
        if bytes.len() > MAX_TEXT_BYTES {
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
        let (bytes, meta) = Self::read_from(&dir, &name)?;
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
        let parent = relative.parent().unwrap_or(Path::new("")).to_owned();
        if name.as_os_str() == next_name {
            return Ok(relative.to_owned());
        }
        // Case-only renames on case-insensitive volumes resolve to the same entry.
        let same_entry = name.to_string_lossy().to_lowercase() == next_name.to_lowercase();
        if !same_entry && Self::exists(&dir, Path::new(next_name)) {
            return Err(crate::localization::t("native.workspace.nameExists").into());
        }
        dir.symlink_metadata(&name).map_err(io)?;
        dir.rename(&name, &dir, next_name).map_err(io)?;
        Ok(parent.join(next_name))
    }

    /// `deleteWorkspaceEntry`: removes files, links and whole folders without
    /// following links outside the grant.
    pub fn remove_entry(&self, relative: &Path) -> Result<()> {
        let (dir, name) = self.parent(relative)?;
        let meta = dir.symlink_metadata(&name).map_err(io)?;
        if meta.is_dir() {
            dir.remove_dir_all(&name).map_err(io)
        } else {
            dir.remove_file(&name).map_err(io)
        }
    }

    /// `moveWorkspaceEntry` into another folder, keeping the name.
    pub fn move_entry(&self, from: &Path, to_folder: &Path) -> Result<PathBuf> {
        let (source_dir, name) = self.parent(from)?;
        if to_folder.starts_with(from) {
            return Err(crate::localization::t("native.workspace.moveIntoSelf").into());
        }
        if from.parent().unwrap_or(Path::new("")) == to_folder {
            return Ok(from.to_owned());
        }
        let target_dir = self.directory(to_folder)?;
        if Self::exists(&target_dir, &name) {
            return Err(crate::localization::t("native.workspace.nameExists").into());
        }
        source_dir.rename(&name, &target_dir, &name).map_err(io)?;
        Ok(to_folder.join(name))
    }

    fn keep_both_name(preferred: &str, index: usize, folder: bool) -> String {
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
            target.create_dir(target_name).map_err(io)?;
            let from = source.open_dir(name).map_err(io)?;
            let to = target.open_dir(target_name).map_err(io)?;
            for entry in from.entries().map_err(io)? {
                let entry = entry.map_err(io)?;
                let child = entry.file_name();
                Self::copy_tree(&from, Path::new(&child), &to, &child.to_string_lossy())?;
            }
            Ok(())
        } else if meta.is_file() {
            let mut input = source.open(name).map_err(io)?;
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            let mut output = target.open_with(target_name, &options).map_err(io)?;
            std::io::copy(&mut input, &mut output).map_err(io)?;
            output.set_permissions(meta.permissions()).map_err(io)?;
            output.sync_all().map_err(io)
        } else {
            Err(crate::localization::t("native.workspace.copyKind").into())
        }
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
            return match Self::copy_tree(&source_dir, &name, &target_dir, &candidate) {
                Ok(()) => Ok(to_folder.join(candidate)),
                Err(error) => {
                    let _ = if folder {
                        target_dir.remove_dir_all(&candidate)
                    } else {
                        target_dir.remove_file(&candidate)
                    };
                    Err(error)
                }
            };
        }
        Err(crate::localization::t("native.workspace.nameExhausted").into())
    }

    /// Import a user-dropped file or folder from outside the grant (copy only).
    pub fn import_external(&self, source: &Path, to_folder: &Path) -> Result<PathBuf> {
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
        for index in 0..=10_000 {
            let candidate = Self::keep_both_name(&preferred, index, meta.is_dir());
            if Self::exists(&target_dir, Path::new(&candidate)) {
                continue;
            }
            return Self::copy_tree(&source_dir, Path::new(name), &target_dir, &candidate)
                .map(|()| to_folder.join(candidate));
        }
        Err(crate::localization::t("native.workspace.nameExhausted").into())
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
        if current_stat == baseline.stat {
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
        let bytes =
            encode_with_roundtrip_guard(text, baseline.encoding, baseline.bom, target_line_ending)?;
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

            dir.rename(&temporary, dir, name).map_err(io)?;
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
