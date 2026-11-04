//! A drag that leaves the window with text (`dataTransfer.setData(
//! "text/plain", …)`, `effectAllowed = "copy"`): an AppKit dragging session
//! carrying a plain string, drawn as `icon_path`'s Finder icon. Only text
//! travels, never a file URL, so a drop elsewhere can only copy words.

/// Starts the session from the event being handled; `ended` runs once it
/// is over, wherever it was dropped. `false` where there is no native
/// session to start (another platform, a window without a native view).
#[cfg(target_os = "macos")]
pub fn begin_text(
    window: &gpui::Window,
    text: &str,
    icon_path: &str,
    ended: impl FnOnce() + 'static,
) -> bool {
    use objc2::{AnyThread as _, MainThreadMarker, rc::Retained, runtime::ProtocolObject};
    use objc2_app_kit::{NSApplication, NSDraggingItem, NSEventType, NSView, NSWorkspace};
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let Ok(handle) = HasWindowHandle::window_handle(window) else {
        return false;
    };
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return false;
    };
    // SAFETY: GPUI owns this live NSView; this runs on AppKit's main thread
    // while the view handles the event that starts the drag.
    let view = unsafe { &*handle.ns_view.as_ptr().cast::<NSView>() };
    // A session starts only from the pointer's own drag event; anything
    // else would be refused by AppKit with an exception.
    let Some(event) = NSApplication::sharedApplication(mtm)
        .currentEvent()
        .filter(|e| e.r#type() == NSEventType::LeftMouseDragged)
    else {
        return false;
    };
    let writer = NSString::from_str(text);
    let item = NSDraggingItem::initWithPasteboardWriter(
        NSDraggingItem::alloc(),
        ProtocolObject::from_ref(&*writer),
    );
    let icon = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(icon_path));
    let at = view.convertPoint_fromView(event.locationInWindow(), None);
    let size = 32.;
    // SAFETY: the contents are an `NSImage`, as the frame's contents expect.
    unsafe {
        item.setDraggingFrame_contents(
            NSRect::new(
                NSPoint::new(at.x - size / 2., at.y - size / 2.),
                NSSize::new(size, size),
            ),
            Some(&icon),
        );
    }
    let source: Retained<source::TextDragSource> = source::TextDragSource::new(mtm, ended);
    view.beginDraggingSessionWithItems_event_source(
        &NSArray::from_retained_slice(&[item]),
        &event,
        ProtocolObject::from_ref(&*source),
    );
    // The session holds its source only weakly: keep it until it ends.
    source::hold(source);
    true
}
#[cfg(not(target_os = "macos"))]
pub fn begin_text(_: &gpui::Window, _: &str, _: &str, _: impl FnOnce() + 'static) -> bool {
    false
}

#[cfg(target_os = "macos")]
mod source {
    use objc2::{
        DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, rc::Retained,
    };
    use objc2_app_kit::{NSDragOperation, NSDraggingContext, NSDraggingSession, NSDraggingSource};
    use objc2_foundation::{NSObject, NSObjectProtocol, NSPoint};
    use std::cell::RefCell;

    type Ended = RefCell<Option<Box<dyn FnOnce()>>>;
    thread_local! {
        static HELD: RefCell<Vec<Retained<TextDragSource>>> = const { RefCell::new(Vec::new()) };
    }
    pub(super) fn hold(source: Retained<TextDragSource>) {
        HELD.with(|held| held.borrow_mut().push(source));
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements and this class
        // does not implement `Drop`.
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[name = "PuppyOneTextDragSource"]
        #[ivars = Ended]
        pub(super) struct TextDragSource;

        // SAFETY: no safety requirements.
        unsafe impl NSObjectProtocol for TextDragSource {}

        // SAFETY: the signatures match `NSDraggingSource`.
        unsafe impl NSDraggingSource for TextDragSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn operation_mask(
                &self,
                _session: &NSDraggingSession,
                _context: NSDraggingContext,
            ) -> NSDragOperation {
                NSDragOperation::Copy
            }

            #[unsafe(method(draggingSession:endedAtPoint:operation:))]
            fn ended(
                &self,
                _session: &NSDraggingSession,
                _point: NSPoint,
                _operation: NSDragOperation,
            ) {
                let ended = self.ivars().borrow_mut().take();
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
    impl TextDragSource {
        pub(super) fn new(mtm: MainThreadMarker, ended: impl FnOnce() + 'static) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(RefCell::new(Some(Box::new(ended))));
            // SAFETY: `NSObject`'s designated initializer.
            unsafe { msg_send![super(this), init] }
        }
    }
}
