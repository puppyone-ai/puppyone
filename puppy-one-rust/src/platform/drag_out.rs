//! Compatibility facade delegating to [`crate::platform::clipboard`].
use std::path::PathBuf;

pub use super::clipboard::MAX_FILES;

pub fn begin_text(
    window: &impl raw_window_handle::HasWindowHandle,
    text: &str,
    icon_path: &str,
    ended: impl FnOnce() + 'static,
) -> bool {
    #[cfg(any(test, feature = "test-support"))]
    if let Some(begun) = BEGUN.with(|b| b.borrow().clone()) {
        begun.borrow_mut().push(text.to_owned());
        return false;
    }
    super::clipboard::begin_text_drag(window, text, icon_path, ended)
}

#[cfg(any(test, feature = "test-support"))]
type Begun = std::rc::Rc<std::cell::RefCell<Vec<String>>>;
#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static BEGUN: std::cell::RefCell<Option<Begun>> = const { std::cell::RefCell::new(None) };
}
/// Tests: this thread's text drag-outs are recorded, and no system session
/// starts.
#[cfg(any(test, feature = "test-support"))]
pub fn record_text_drags() -> Begun {
    let begun = Begun::default();
    BEGUN.with(|b| *b.borrow_mut() = Some(begun.clone()));
    begun
}

pub fn begin_files(
    window: &impl raw_window_handle::HasWindowHandle,
    files: &[PathBuf],
    ended: impl FnOnce() + 'static,
) -> bool {
    super::clipboard::begin_file_drag(window, files, ended)
}

pub fn own_files() -> Option<Vec<PathBuf>> {
    super::clipboard::own_drag_files()
}
