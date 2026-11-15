//! Drags that leave the window as an AppKit dragging session. Text
//! (`dataTransfer.setData("text/plain", …)`, `effectAllowed = "copy"`)
//! carries a plain string drawn as `icon_path`'s Finder icon; files
//! (`resource-drag.mm`) carry one file URL per entry and the paths as text,
//! each drawn as its own Finder icon. Outside the app a drop can only copy;
//! inside it, [`own_files`] tells a drop the files are the app's own drag.
use std::path::PathBuf;

/// Starts a text session from the event being handled; `ended` runs once
/// it is over, wherever it was dropped. `false` where there is no native
/// session to start (another platform, a window without a native view).
pub fn begin_text(
    window: &impl raw_window_handle::HasWindowHandle,
    text: &str,
    icon_path: &str,
    ended: impl FnOnce() + 'static,
) -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2::{AnyThread as _, runtime::ProtocolObject};
        use objc2_app_kit::{NSDraggingItem, NSWorkspace};
        use objc2_foundation::NSString;
        native::begin(window, false, ended, |at| {
            let writer = NSString::from_str(text);
            let item = NSDraggingItem::initWithPasteboardWriter(
                NSDraggingItem::alloc(),
                ProtocolObject::from_ref(&*writer),
            );
            let icon = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(icon_path));
            native::frame(&item, at, 0, &icon);
            vec![item]
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, text, icon_path, ended);
        false
    }
}

/// The most entries one session carries (`resource-drag.mm`).
pub const MAX_FILES: usize = 32;

/// Starts a session carrying `files` (absolute paths, at most
/// [`MAX_FILES`]); `ended` runs once it is over. While it lasts,
/// [`own_files`] names them.
pub fn begin_files(
    window: &impl raw_window_handle::HasWindowHandle,
    files: &[PathBuf],
    ended: impl FnOnce() + 'static,
) -> bool {
    if files.is_empty() || files.len() > MAX_FILES || files.iter().any(|f| !f.is_absolute()) {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        use objc2::{AnyThread as _, runtime::ProtocolObject};
        use objc2_app_kit::{
            NSDraggingItem, NSPasteboardItem, NSPasteboardTypeFileURL, NSPasteboardTypeString,
            NSWorkspace,
        };
        use objc2_foundation::{NSString, NSURL};
        let text = files
            .iter()
            .map(|f| f.to_string_lossy())
            .collect::<Vec<_>>()
            .join("\n");
        let started = native::begin(window, true, ended, |at| {
            files
                .iter()
                .enumerate()
                .map(|(index, file)| {
                    let path = NSString::from_str(&file.to_string_lossy());
                    let item = NSPasteboardItem::new();
                    // SAFETY: AppKit's own pasteboard type constants.
                    unsafe {
                        // The whole list once, for receivers that read only
                        // the first item's text.
                        if index == 0 {
                            item.setString_forType(
                                &NSString::from_str(&text),
                                NSPasteboardTypeString,
                            );
                        }
                        if let Some(url) = NSURL::fileURLWithPath(&path).absoluteString() {
                            item.setString_forType(&url, NSPasteboardTypeFileURL);
                        }
                    }
                    let drag = NSDraggingItem::initWithPasteboardWriter(
                        NSDraggingItem::alloc(),
                        ProtocolObject::from_ref(&*item),
                    );
                    let icon = NSWorkspace::sharedWorkspace().iconForFile(&path);
                    native::frame(&drag, at, index, &icon);
                    drag
                })
                .collect()
        });
        if started {
            native::OWN.with(|own| *own.borrow_mut() = Some(files.to_vec()));
        }
        started
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, ended);
        false
    }
}

/// The files of the app's own session in flight, for a drop inside the
/// app to take them as the drag they are rather than an import.
pub fn own_files() -> Option<Vec<PathBuf>> {
    #[cfg(target_os = "macos")]
    {
        native::OWN.with(|own| own.borrow().clone())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(target_os = "macos")]
mod native {
    use objc2::{
        DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, rc::Retained,
        runtime::ProtocolObject,
    };
    use objc2_app_kit::{
        NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
        NSDraggingSource, NSEventType, NSImage, NSView,
    };
    use objc2_foundation::{NSArray, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize};
    use raw_window_handle::RawWindowHandle;
    use std::{cell::RefCell, path::PathBuf};

    thread_local! {
        static HELD: RefCell<Vec<Retained<DragSource>>> = const { RefCell::new(Vec::new()) };
        pub(super) static OWN: RefCell<Option<Vec<PathBuf>>> = const { RefCell::new(None) };
    }

    /// A 32pt icon under the pointer, each further one a step off.
    pub(super) fn frame(item: &NSDraggingItem, at: NSPoint, index: usize, icon: &NSImage) {
        let size = 32.;
        let step = 4. * index.min(4) as f64;
        // SAFETY: the contents are an `NSImage`, as the frame's contents expect.
        unsafe {
            item.setDraggingFrame_contents(
                NSRect::new(
                    NSPoint::new(at.x - size / 2. + step, at.y - size / 2. - step),
                    NSSize::new(size, size),
                ),
                Some(icon),
            );
        }
    }

    /// Starts a session with `items` (given the pointer in the view) from
    /// the pointer's own drag event. `files`: copy outside the app, copy or
    /// move inside it.
    pub(super) fn begin(
        window: &impl raw_window_handle::HasWindowHandle,
        files: bool,
        ended: impl FnOnce() + 'static,
        items: impl FnOnce(NSPoint) -> Vec<Retained<NSDraggingItem>>,
    ) -> bool {
        let Some(mtm) = MainThreadMarker::new() else {
            return false;
        };
        if HELD.with(|held| !held.borrow().is_empty()) {
            return false;
        }
        let Ok(handle) = window.window_handle() else {
            return false;
        };
        let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
            return false;
        };
        // SAFETY: the window owns this live NSView; this runs on AppKit's main
        // thread while the view handles the event that starts the drag.
        let view = unsafe { &*handle.ns_view.as_ptr().cast::<NSView>() };
        // A session starts only from the pointer's own drag event; anything
        // else would be refused by AppKit with an exception.
        let Some(event) = NSApplication::sharedApplication(mtm)
            .currentEvent()
            .filter(|e| e.r#type() == NSEventType::LeftMouseDragged)
        else {
            return false;
        };
        let at = view.convertPoint_fromView(event.locationInWindow(), None);
        let items = items(at);
        if items.is_empty() {
            return false;
        }
        let source = DragSource::new(mtm, files, ended);
        let session = view.beginDraggingSessionWithItems_event_source(
            &NSArray::from_retained_slice(&items),
            &event,
            ProtocolObject::from_ref(&*source),
        );
        session.setAnimatesToStartingPositionsOnCancelOrFail(true);
        // The session holds its source only weakly: keep it until it ends.
        HELD.with(|held| held.borrow_mut().push(source));
        true
    }

    pub(super) struct Ivars {
        files: bool,
        ended: RefCell<Option<Box<dyn FnOnce()>>>,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements and this class
        // does not implement `Drop`.
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[name = "PuppyOneDragSource"]
        #[ivars = Ivars]
        pub(super) struct DragSource;

        // SAFETY: no safety requirements.
        unsafe impl NSObjectProtocol for DragSource {}

        // SAFETY: the signatures match `NSDraggingSource`.
        unsafe impl NSDraggingSource for DragSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn operation_mask(
                &self,
                _session: &NSDraggingSession,
                context: NSDraggingContext,
            ) -> NSDragOperation {
                // External export is copy-only; a move inside the app is
                // its own command.
                if self.ivars().files && context == NSDraggingContext::WithinApplication {
                    NSDragOperation::Copy | NSDragOperation::Move
                } else {
                    NSDragOperation::Copy
                }
            }

            #[unsafe(method(draggingSession:endedAtPoint:operation:))]
            fn ended(
                &self,
                _session: &NSDraggingSession,
                _point: NSPoint,
                _operation: NSDragOperation,
            ) {
                if self.ivars().files {
                    OWN.with(|own| own.borrow_mut().take());
                }
                let ended = self.ivars().ended.borrow_mut().take();
                if let Some(ended) = ended {
                    ended();
                }
                let this = self as *const Self;
                HELD.with(|held| {
                    held.borrow_mut()
                        .retain(|source| !std::ptr::eq(&**source, this))
                });
            }
        }
    );
    impl DragSource {
        fn new(
            mtm: MainThreadMarker,
            files: bool,
            ended: impl FnOnce() + 'static,
        ) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Ivars {
                files,
                ended: RefCell::new(Some(Box::new(ended))),
            });
            // SAFETY: `NSObject`'s designated initializer.
            unsafe { msg_send![super(this), init] }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn only_absolute_bounded_file_lists_start() {
        struct NoWindow;
        impl raw_window_handle::HasWindowHandle for NoWindow {
            fn window_handle(
                &self,
            ) -> Result<raw_window_handle::WindowHandle<'_>, raw_window_handle::HandleError>
            {
                Err(raw_window_handle::HandleError::Unavailable)
            }
        }
        assert!(!begin_files(&NoWindow, &[], || {}));
        assert!(!begin_files(&NoWindow, &[PathBuf::from("a.md")], || {}));
        let many = vec![PathBuf::from("/a"); MAX_FILES + 1];
        assert!(!begin_files(&NoWindow, &many, || {}));
        assert_eq!(own_files(), None);
    }
}
