//! Copy Item on the system's file clipboard: the entries go to the general
//! pasteboard as file URLs, as Finder's own Copy puts them there, so Finder
//! (or any other app) pastes the files themselves. Paths come from
//! `Workspace::absolute`, never from Web content.
use std::path::PathBuf;

/// Replaces the pasteboard's contents with `paths`; `false` when nothing was
/// written (no paths, another platform, or AppKit refused them).
pub fn write(paths: &[PathBuf]) -> bool {
    if paths.is_empty() {
        return false;
    }
    #[cfg(any(test, feature = "test-support"))]
    {
        WRITTEN.with(|w| *w.borrow_mut() = Some(paths.to_vec()));
        true
    }
    #[cfg(not(any(test, feature = "test-support")))]
    {
        write_general(paths)
    }
}

#[cfg(target_os = "macos")]
#[cfg_attr(any(test, feature = "test-support"), allow(dead_code))]
fn write_general(paths: &[PathBuf]) -> bool {
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSString, NSURL};

    let urls: Vec<_> = paths
        .iter()
        .map(|p| NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy())))
        .collect();
    let items: Vec<&ProtocolObject<dyn NSPasteboardWriting>> = urls
        .iter()
        .map(|u| ProtocolObject::from_ref(&**u))
        .collect();
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    pasteboard.writeObjects(&NSArray::from_slice(&items))
}
#[cfg(not(target_os = "macos"))]
#[cfg_attr(any(test, feature = "test-support"), allow(dead_code))]
fn write_general(_: &[PathBuf]) -> bool {
    false
}

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static WRITTEN: std::cell::RefCell<Option<Vec<PathBuf>>> = const { std::cell::RefCell::new(None) };
}
/// What the last [`write`] on this thread put on the (test) pasteboard.
#[cfg(any(test, feature = "test-support"))]
pub fn take_written() -> Option<Vec<PathBuf>> {
    WRITTEN.with(|w| w.borrow_mut().take())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// The general pasteboard's file paths, read the way Finder reads them.
    fn read_general() -> Vec<PathBuf> {
        use objc2_app_kit::NSPasteboard;
        use objc2_foundation::{NSArray, NSURL};

        let pasteboard = NSPasteboard::generalPasteboard();
        let class = NSArray::from_slice(&[objc2::class!(NSURL)]);
        // SAFETY: only `NSURL` is asked for, so every object read is one.
        let objects = unsafe { pasteboard.readObjectsForClasses_options(&class, None) };
        objects
            .map(|objects| objects.to_vec())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|o| o.downcast::<NSURL>().ok())
            .filter_map(|u| u.path().map(|p| PathBuf::from(p.to_string())))
            .collect()
    }

    /// Writes the real general pasteboard (it replaces what is there), so it
    /// runs only on request: `cargo test --locked file_pasteboard -- --ignored`.
    #[test]
    #[ignore]
    fn files_reach_the_general_pasteboard_as_finder_reads_them() {
        let dir = tempfile::tempdir().unwrap();
        let paths = ["a.md", "b c 文件.txt"].map(|name| {
            let path = dir.path().join(name);
            std::fs::write(&path, name).unwrap();
            path.canonicalize().unwrap()
        });
        assert!(write_general(&paths));
        assert_eq!(read_general(), paths);
    }
}
