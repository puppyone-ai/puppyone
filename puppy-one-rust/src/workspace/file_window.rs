//! Standalone-file authority. The local filesystem adapter still owns all
//! no-follow, read-budget, versioned-write and retained-directory checks.
use super::{contracts::*, local, ports::*};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

#[cfg(test)]
#[path = "file_window_tests.rs"]
mod tests;

struct FileProvider {
    inner: Arc<dyn Provider>,
    bound: RelativePath,
}

pub(super) fn open(path: &Path) -> Result<Arc<dyn Provider>> {
    let root = path.parent().ok_or_else(Error::unsupported)?;
    let name = path.file_name().ok_or_else(Error::unsupported)?;
    Ok(Arc::new(FileProvider {
        inner: local::open_file_parent(root)?,
        bound: RelativePath::new(Path::new(name))?,
    }))
}

impl FileProvider {
    fn bound(&self, path: &RelativePath) -> Result<()> {
        if path != &self.bound {
            return Err(Error::unsupported());
        }
        Ok(())
    }
}
impl DataPort for FileProvider {
    fn descriptor(&self) -> Descriptor {
        let mut descriptor = self.inner.descriptor();
        descriptor.capabilities = Capabilities {
            read: true,
            write: true,
            preview: true,
            watch: true,
            local_actions: true,
            ..Default::default()
        };
        descriptor
    }
    fn list(&self, _: &RelativePath) -> Result<Vec<Entry>> {
        Err(Error::unsupported())
    }
}
impl DocumentStoragePort for FileProvider {
    fn read(&self, path: &RelativePath) -> Result<TextSnapshot> {
        self.bound(path)?;
        self.inner.read(path)
    }
    fn write(&self, path: &RelativePath, base: &Revision, text: &str) -> Result<WriteResult> {
        self.bound(path)?;
        self.inner.write(path, base, text)
    }
}
impl ResourcePort for FileProvider {
    fn preview(&self, path: &RelativePath) -> Result<PreviewData> {
        self.bound(path)?;
        self.inner.preview(path)
    }
    fn preview_bytes(&self, path: &RelativePath, max: u64) -> Result<Vec<u8>> {
        self.bound(path)?;
        self.inner
            .preview_bytes(path, max.min(Limits::FILE_WINDOW_BYTES as u64))
    }
    fn markdown_asset_bytes(&self, path: &RelativePath, max: u64) -> Result<Vec<u8>> {
        if path != &self.bound
            && !crate::formats::preferred_mime(&path.as_path().to_string_lossy()).is_some_and(
                |mime| {
                    mime.starts_with("image/")
                        || mime.starts_with("audio/")
                        || mime.starts_with("video/")
                },
            )
        {
            return Err(Error::unsupported());
        }
        self.inner.markdown_asset_bytes(path, max)
    }
    fn preview_reader(&self, path: &RelativePath) -> Result<ResourceReader> {
        self.bound(path)?;
        let reader = self.inner.preview_reader(path)?;
        if reader.length > Limits::FILE_WINDOW_BYTES as u64 {
            return Err(Error::unsupported());
        }
        Ok(reader)
    }
    fn platform_path(&self, path: &RelativePath) -> Result<PathBuf> {
        self.bound(path)?;
        self.inner.platform_path(path)
    }
}
impl ResourceWatchPort for FileProvider {
    fn watch(
        &self,
        path: &RelativePath,
        baseline: &Revision,
        notify: Notify,
    ) -> Result<WatchSubscription> {
        self.bound(path)?;
        self.inner.watch(path, baseline, notify)
    }
}
