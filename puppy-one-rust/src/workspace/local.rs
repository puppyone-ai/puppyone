//! Private local filesystem adapter. Capability checks and byte-preserving
//! conditional writes stay here; application code uses the provider ports.
use super::contracts::{Error, ErrorKind, Result, Revision, TextSnapshot};
use crate::model::{MAX_DIRECTORY_ENTRIES, Node};
use cap_std::fs::{Dir, Metadata, OpenOptions};
use std::{
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use uuid::Uuid;
mod adapter;
pub(super) use adapter::open;

use super::MAX_TEXT_BYTES;

pub struct Workspace {
    pub path: PathBuf,
    id: Uuid,
    dir: Dir,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Version {
    hash: blake3::Hash,
    modified: Option<cap_std::time::SystemTime>,
    readonly: bool,
    #[cfg(unix)]
    mode_and_links: (u32, u64),
    #[cfg(unix)]
    changed: (i64, i64),
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
}
impl Version {
    fn new(bytes: &[u8], meta: &Metadata) -> Self {
        #[cfg(unix)]
        use cap_std::fs::MetadataExt;
        Self {
            hash: blake3::hash(bytes),
            modified: meta.modified().ok(),
            readonly: meta.permissions().readonly(),
            #[cfg(unix)]
            mode_and_links: (meta.mode(), meta.nlink()),
            #[cfg(unix)]
            changed: (meta.ctime(), meta.ctime_nsec()),
            #[cfg(unix)]
            dev: meta.dev(),
            #[cfg(unix)]
            ino: meta.ino(),
        }
    }
}
#[derive(Clone, Debug)]
pub struct Document {
    pub id: String,
    pub relative: PathBuf,
    pub text: String,
    version: Version,
    workspace_id: Uuid,
    bom: bool,
    crlf: bool,
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
        _ => ErrorKind::Io,
    };
    Error::new(kind, error.to_string())
}
impl Version {
    fn revision(&self) -> Revision {
        // Opaque, adapter-local token includes every existing CAS field, not
        // just content. This is not a transport/persisted revision format.
        Revision(format!("local-v1:{self:?}"))
    }
}
impl Document {
    fn into_snapshot(self) -> TextSnapshot {
        TextSnapshot {
            revision: self.version.revision(),
            text: self.text,
        }
    }
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
impl Workspace {
    pub fn open(path: &Path) -> Result<Arc<Self>> {
        let path = std::fs::canonicalize(path).map_err(io)?;
        let dir = Dir::open_ambient_dir(&path, cap_std::ambient_authority()).map_err(io)?;
        Ok(Arc::new(Self {
            path,
            id: Uuid::new_v4(),
            dir,
        }))
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
    fn read_from(dir: &Dir, name: &Path) -> Result<(Vec<u8>, Metadata)> {
        let meta = dir.symlink_metadata(name).map_err(io)?;
        if !meta.is_file() {
            return Err(crate::localization::t("native.workspace.regularOnly").into());
        }
        if meta.len() > MAX_TEXT_BYTES as u64 {
            return Err(crate::localization::t("native.workspace.fileTooLarge").into());
        }
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let mut file = dir.open_with(name, &options).map_err(io)?;
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
    pub fn read(&self, relative: &Path) -> Result<Document> {
        let (dir, name) = self.parent(relative)?;
        let (bytes, meta) = Self::read_from(&dir, &name)?;
        let version = Version::new(&bytes, &meta);
        let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
        let text = std::str::from_utf8(if bom { &bytes[3..] } else { &bytes })
            .map_err(|_| crate::localization::t("native.workspace.notUtf8"))?;
        if text.contains('\0') {
            return Err(crate::localization::t("native.workspace.binary").into());
        }
        let crlf = text.contains("\r\n");
        let normalized = text.replace("\r\n", "\n");
        if normalized.contains('\r') || (crlf && text.replace("\r\n", "").contains('\n')) {
            return Err(crate::localization::t("native.workspace.lineEndings").into());
        }
        Ok(Document {
            id: Uuid::new_v4().to_string(),
            relative: relative.to_owned(),
            text: normalized,
            version,
            workspace_id: self.id,
            bom,
            crlf,
        })
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
    /// A regular file a viewer reads itself (an image, a binary preview):
    /// checked through the workspace capability — no symlinks, nothing
    /// outside the root — and returned as an absolute path.
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
    pub fn observe(&self, document: &Document) -> Result<Document> {
        if document.workspace_id != self.id {
            return Err(Error::new(
                ErrorKind::ForeignResource,
                crate::localization::t("native.workspace.foreignDocument"),
            ));
        }
        let mut current = self.read(&document.relative)?;
        current.id = document.id.clone();
        Ok(current)
    }
    fn storage_update(&self, document: &Document) -> Result<WriteOutcome> {
        self.observe(document).map(|document| WriteOutcome {
            document,
            updated: true,
        })
    }
    pub fn save(&self, document: &Document, text: &str) -> Result<WriteOutcome> {
        if document.workspace_id != self.id {
            return Err(Error::new(
                ErrorKind::ForeignResource,
                crate::localization::t("native.workspace.foreignDocument"),
            ));
        }
        if text.len() > MAX_TEXT_BYTES || text.contains(['\0', '\r']) {
            return Err(crate::localization::t("native.workspace.invalidText").into());
        }
        let (dir, name) = self.parent(&document.relative)?;
        let (current, meta) = Self::read_from(&dir, &name)?;
        if Version::new(&current, &meta) != document.version {
            return self.storage_update(document);
        }
        if meta.permissions().readonly() {
            return Err(Error::new(
                ErrorKind::PermissionDenied,
                crate::localization::t("native.workspace.readOnly"),
            ));
        }
        #[cfg(unix)]
        {
            use cap_std::fs::MetadataExt;
            if meta.nlink() != 1 {
                return Err(crate::localization::t("native.workspace.hardLink").into());
            }
        }
        let mut bytes = if document.bom {
            vec![0xef, 0xbb, 0xbf]
        } else {
            vec![]
        };
        if document.crlf {
            bytes.extend_from_slice(text.replace('\n', "\r\n").as_bytes());
        } else {
            bytes.extend_from_slice(text.as_bytes());
        }
        if bytes.len() > MAX_TEXT_BYTES {
            return Err(crate::localization::t("native.workspace.encodedTooLarge").into());
        }
        if bytes == current {
            return Ok(WriteOutcome {
                document: document.clone(),
                updated: false,
            });
        }
        // Same-directory staging avoids truncating the original on errors. The
        // second version check catches normal concurrent edits. It is not a
        // filesystem CAS against an uncooperative writer (see README).
        let temporary = PathBuf::from(format!(".puppyone-rust-{}.tmp", Uuid::new_v4()));
        let result = (|| {
            let mut file = dir
                .open_with(&temporary, OpenOptions::new().write(true).create_new(true))
                .map_err(io)?;
            file.write_all(&bytes).map_err(io)?;
            file.set_permissions(meta.permissions()).map_err(io)?;
            file.sync_all().map_err(io)?;
            drop(file);
            let (latest, latest_meta) = Self::read_from(&dir, &name)?;
            if Version::new(&latest, &latest_meta) != document.version {
                return self.storage_update(document);
            }
            dir.rename(&temporary, &dir, &name).map_err(io)?;
            #[cfg(unix)]
            dir.try_clone()
                .map_err(io)?
                .into_std_file()
                .sync_all()
                .map_err(io)?;
            // Read back before acknowledging. Failure remains visible and does
            // not mark the editor clean or permit a pending close.
            let mut saved = self.read(&document.relative)?;
            let updated = saved.text != text;
            saved.id = document.id.clone();
            Ok(WriteOutcome {
                document: saved,
                updated,
            })
        })();
        let _ = dir.remove_file(&temporary);
        result
    }
}
