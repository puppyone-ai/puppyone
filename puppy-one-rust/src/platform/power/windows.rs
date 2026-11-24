//! Windows: `PowerRegisterSuspendResumeNotification` with a callback (no
//! window needed): `PBT_APMSUSPEND` before sleep, `PBT_APMRESUMEAUTOMATIC`
//! or `PBT_APMRESUMESUSPEND` after.
use super::{Event, Listener};
use std::ffi::c_void;
use windows::Win32::{
    Foundation::{ERROR_SUCCESS, HANDLE},
    System::Power::{DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, PowerRegisterSuspendResumeNotification},
    UI::WindowsAndMessaging::{
        DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMESUSPEND, PBT_APMSUSPEND,
    },
};

unsafe extern "system" fn changed(context: *const c_void, kind: u32, _: *const c_void) -> u32 {
    // SAFETY: `context` is the leaked listener passed at registration.
    let listener = unsafe { &*(context as *const Listener) };
    match kind {
        PBT_APMSUSPEND => listener(Event::Suspend),
        PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => listener(Event::Wake),
        _ => {}
    }
    ERROR_SUCCESS.0
}

pub(super) fn watch(listener: Listener) -> bool {
    // Both live as long as the process; the registration is never undone.
    let listener: &'static Listener = Box::leak(Box::new(listener));
    let parameters: &'static mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS =
        Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(changed),
            Context: listener as *const Listener as *mut c_void,
        }));
    let mut registration = std::ptr::null_mut();
    // SAFETY: the parameters outlive the registration; the out-pointer is
    // a local.
    let result = unsafe {
        PowerRegisterSuspendResumeNotification(
            DEVICE_NOTIFY_CALLBACK,
            HANDLE(parameters as *mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS as *mut c_void),
            &mut registration,
        )
    };
    result == ERROR_SUCCESS
}
