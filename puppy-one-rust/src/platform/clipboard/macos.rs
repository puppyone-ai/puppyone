//! macOS system file clipboard (`NSPasteboard`) and AppKit drag-out sessions.
use std::path::PathBuf;

#[cfg_attr(any(test, feature = "test-support"), allow(dead_code))]
pub(super) fn write_files(paths: &[PathBuf]) -> bool {
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

pub(super) fn begin_text_drag(
    window: &impl raw_window_handle::HasWindowHandle,
    text: &str,
    icon_path: &str,
    ended: impl FnOnce() + 'static,
) -> bool {
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

pub(super) fn begin_file_drag(
    window: &impl raw_window_handle::HasWindowHandle,
    files: &[PathBuf],
    ended: impl FnOnce() + 'static,
) -> bool {
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
                    if index == 0 {
                        item.setString_forType(&NSString::from_str(&text), NSPasteboardTypeString);
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

pub(super) fn own_drag_files() -> Option<Vec<PathBuf>> {
    native::OWN.with(|own| own.borrow().clone())
}

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
        // SAFETY: the window owns this live NSView; this runs on AppKit's main thread.
        let view = unsafe { &*handle.ns_view.as_ptr().cast::<NSView>() };
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
        HELD.with(|held| held.borrow_mut().push(source));
        true
    }

    pub(super) struct Ivars {
        files: bool,
        ended: RefCell<Option<Box<dyn FnOnce()>>>,
    }

    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[name = "PuppyOneDragSource"]
        #[ivars = Ivars]
        pub(super) struct DragSource;

        unsafe impl NSObjectProtocol for DragSource {}

        unsafe impl NSDraggingSource for DragSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn operation_mask(
                &self,
                _session: &NSDraggingSession,
                context: NSDraggingContext,
            ) -> NSDragOperation {
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
                if let Some(ended) = self.ivars().ended.borrow_mut().take() {
                    ended();
                }
                HELD.with(|held| held.borrow_mut().retain(|s| !std::ptr::eq(&**s, self)));
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
            // SAFETY: NSObject's designated initializer.
            unsafe { msg_send![super(this), init] }
        }
    }
}
