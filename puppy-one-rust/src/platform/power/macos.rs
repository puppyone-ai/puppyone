//! macOS: `IORegisterForSystemPower` on a run loop of its own. Sleep is
//! allowed at once (a listener never delays it); `com.apple.screenIsUnlocked`
//! counts as a wake, as `unlock-screen` does.
use super::{Event, Listener};
use core_foundation_sys::{
    base::CFRelease,
    dictionary::CFDictionaryRef,
    notification_center::{
        CFNotificationCenterAddObserver, CFNotificationCenterGetDistributedCenter,
        CFNotificationCenterRef, CFNotificationSuspensionBehaviorDeliverImmediately,
    },
    runloop::{CFRunLoopAddSource, CFRunLoopGetCurrent, CFRunLoopRun, kCFRunLoopDefaultMode},
    string::{CFStringCreateWithCString, CFStringRef, kCFStringEncodingUTF8},
};
use std::ffi::c_void;
use std::sync::atomic::{AtomicU32, Ordering};

type IoConnect = u32;
type IoObject = u32;
type NotificationPort = *mut c_void;
type InterestCallback =
    extern "C" fn(refcon: *mut c_void, service: IoObject, message: u32, argument: *mut c_void);

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IORegisterForSystemPower(
        refcon: *mut c_void,
        port: *mut NotificationPort,
        callback: InterestCallback,
        notifier: *mut IoObject,
    ) -> IoConnect;
    fn IOAllowPowerChange(kernel_port: IoConnect, notification: isize) -> i32;
    fn IONotificationPortGetRunLoopSource(port: NotificationPort) -> *mut c_void;
}

/// `kIOMessageCanSystemSleep`, `kIOMessageSystemWillSleep`,
/// `kIOMessageSystemHasPoweredOn` (`iokit_common_msg`).
const CAN_SLEEP: u32 = 0xe000_0270;
const WILL_SLEEP: u32 = 0xe000_0280;
const POWERED_ON: u32 = 0xe000_0300;

struct Watcher {
    listener: Listener,
    root: AtomicU32,
}

extern "C" fn power(refcon: *mut c_void, _: IoObject, message: u32, argument: *mut c_void) {
    // SAFETY: `refcon` is the leaked `Watcher` passed at registration.
    let watcher = unsafe { &*(refcon as *const Watcher) };
    let allow = || {
        // SAFETY: the root port this registration returned; `argument` is
        // the notification id IOKit asks to be acknowledged.
        unsafe { IOAllowPowerChange(watcher.root.load(Ordering::Acquire), argument as isize) };
    };
    match message {
        CAN_SLEEP => allow(),
        WILL_SLEEP => {
            (watcher.listener)(Event::Suspend);
            allow();
        }
        POWERED_ON => (watcher.listener)(Event::Wake),
        _ => {}
    }
}

extern "C" fn unlocked(
    _: CFNotificationCenterRef,
    observer: *mut c_void,
    _: CFStringRef,
    _: *const c_void,
    _: CFDictionaryRef,
) {
    // SAFETY: `observer` is the leaked `Watcher` passed when observing.
    let watcher = unsafe { &*(observer as *const Watcher) };
    (watcher.listener)(Event::Wake);
}

pub(super) fn watch(listener: Listener) -> bool {
    let (ready, registered) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new()
        .name("puppyone-power".into())
        .spawn(move || {
            // Lives as long as the process: the run loop never returns.
            let watcher: &'static Watcher = Box::leak(Box::new(Watcher {
                listener,
                root: AtomicU32::new(0),
            }));
            let refcon = watcher as *const Watcher as *mut c_void;
            let mut port: NotificationPort = std::ptr::null_mut();
            let mut notifier: IoObject = 0;
            // SAFETY: out-pointers to locals; the callback and refcon live
            // for the rest of the process.
            let root = unsafe { IORegisterForSystemPower(refcon, &mut port, power, &mut notifier) };
            if root == 0 || port.is_null() {
                let _ = ready.send(false);
                return;
            }
            watcher.root.store(root, Ordering::Release);
            // SAFETY: the run loop and source belong to this thread; the
            // notification name is released once the center has copied it.
            unsafe {
                CFRunLoopAddSource(
                    CFRunLoopGetCurrent(),
                    IONotificationPortGetRunLoopSource(port) as _,
                    kCFRunLoopDefaultMode,
                );
                let name = CFStringCreateWithCString(
                    std::ptr::null(),
                    c"com.apple.screenIsUnlocked".as_ptr(),
                    kCFStringEncodingUTF8,
                );
                CFNotificationCenterAddObserver(
                    CFNotificationCenterGetDistributedCenter(),
                    refcon,
                    unlocked,
                    name,
                    std::ptr::null(),
                    CFNotificationSuspensionBehaviorDeliverImmediately,
                );
                CFRelease(name as _);
            }
            let _ = ready.send(true);
            // SAFETY: runs this thread's run loop for good.
            unsafe { CFRunLoopRun() };
        });
    spawned.is_ok() && registered.recv().unwrap_or(false)
}
