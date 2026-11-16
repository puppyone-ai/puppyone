//! Admission resolves mutable specs before cache lookup. Only identities and
//! semantic models are cached; every admitted file handle drops on hit/error.
use super::{MAX_RESOURCE_BYTES, Revision, git, working};
use std::{path::Path, sync::atomic::AtomicBool};
pub(super) enum Admitted {
    Missing,
    Blob { oid: String, size: u64 },
    Working(working::Revision),
}
impl Admitted {
    pub(super) fn open(
        root: &Path,
        revision: Option<Revision>,
        cancel: &AtomicBool,
    ) -> Result<Self, String> {
        working::check_cancel(cancel)?;
        match revision {
            None => Ok(Self::Missing),
            Some(Revision::Working(local)) => {
                let local = local
                    .ok_or_else(|| crate::localization::t("native.git.pathOutside").to_owned())?;
                working::Revision::open(root, &local, cancel)?
                    .map(Self::Working)
                    .ok_or_else(|| "The Word revision is not a regular file.".into())
            }
            Some(Revision::Blob(spec)) => {
                let oid = git(
                    root,
                    &["rev-parse", "--verify", "--end-of-options", &spec],
                    None,
                    cancel,
                )?;
                let oid = std::str::from_utf8(&oid)
                    .map_err(|e| e.to_string())?
                    .trim()
                    .to_owned();
                if !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("Git returned an invalid revision object id.".into());
                }
                let size: u64 = git(root, &["cat-file", "-s", &oid], None, cancel)
                    .ok()
                    .and_then(|out| String::from_utf8_lossy(&out).trim().parse().ok())
                    .ok_or("The Word revision could not be read from Git.")?;
                Ok(Self::Blob { oid, size })
            }
        }
    }
    pub(super) fn validate(&self, cancel: &AtomicBool) -> Result<(), String> {
        working::check_cancel(cancel)?;
        let size = match self {
            Self::Missing => 0,
            Self::Blob { size, .. } => *size,
            Self::Working(revision) => {
                revision.validate(cancel)?;
                revision.size()
            }
        };
        if size > MAX_RESOURCE_BYTES {
            return Err("The Word revision exceeds the semantic diff resource budget.".into());
        }
        Ok(())
    }
    pub(super) fn identity(&self) -> Option<String> {
        match self {
            Self::Missing => Some("missing".into()),
            Self::Blob { oid, .. } => Some(format!("blob:{oid}")),
            Self::Working(revision) => revision.identity(),
        }
    }
    pub(super) fn read(self, root: &Path, cancel: &AtomicBool) -> Result<Option<Vec<u8>>, String> {
        self.validate(cancel)?;
        match self {
            Self::Missing => Ok(None),
            Self::Working(revision) => revision.read(MAX_RESOURCE_BYTES, cancel).map(Some),
            Self::Blob { oid, size } => {
                let bytes = git::git_read_bounded(
                    root,
                    &["cat-file", "blob", &oid],
                    None,
                    cancel,
                    MAX_RESOURCE_BYTES as usize,
                )?;
                if bytes.len() as u64 != size {
                    return Err("Git returned an incomplete revision blob.".into());
                }
                Ok(Some(bytes))
            }
        }
    }
}
