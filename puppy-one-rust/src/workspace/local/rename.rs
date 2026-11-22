//! Publish a rename without replacing another directory entry. The platform
//! operation decides identity/case folding; spelling equality is not identity.
use super::{Dir, Error, ErrorKind, Path, Result, io};

pub(super) fn exclusive(from: &Dir, name: &Path, to: &Dir, next: &Path) -> Result<()> {
    // The raw dirfd operation must never accept path traversal or a parent
    // component. Callers have already opened the admitted parent capabilities.
    for path in [name, next] {
        super::validate(path, false)?;
        if path.components().count() != 1 {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "Expected a single filename",
            ));
        }
    }
    crate::platform::fs::exclusive_rename(from, name, to, next).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            Error::new(
                ErrorKind::AlreadyExists,
                crate::localization::t("native.workspace.nameExists"),
            )
        } else {
            io(error)
        }
    })
}
