//! Opt-in OS-composited screenshot, including native child views.
//! Never used as a rendering substitute for the live editor.
use gpui::{App, Window};
use std::path::PathBuf;
/// Dev-capture: an accessory process (no Dock icon, never frontmost).
#[cfg(all(target_os = "macos", feature = "dev-capture"))]
pub fn run_in_background() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    if let Some(mtm) = MainThreadMarker::new() {
        NSApplication::sharedApplication(mtm)
            .setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    }
}
/// Dev-capture: order the window behind all others without activating it.
#[cfg(all(target_os = "macos", feature = "dev-capture"))]
pub fn send_to_back(window: &Window) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let Ok(handle) = HasWindowHandle::window_handle(window) else {
        return;
    };
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return;
    };
    // SAFETY: GPUI owns this live NSView; only accessed on AppKit's main thread.
    let view = unsafe { &*handle.ns_view.as_ptr().cast::<objc2_app_kit::NSView>() };
    if let Some(window) = view.window() {
        window.orderBack(None);
    }
}
#[cfg(all(not(target_os = "macos"), feature = "dev-capture"))]
pub fn run_in_background() {}
#[cfg(all(not(target_os = "macos"), feature = "dev-capture"))]
pub fn send_to_back(_: &Window) {}
#[cfg(target_os = "macos")]
pub fn schedule(
    window: &Window,
    cx: &App,
    path: PathBuf,
    geometry: serde_json::Value,
) -> anyhow::Result<()> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let RawWindowHandle::AppKit(handle) = HasWindowHandle::window_handle(window)?.as_raw() else {
        anyhow::bail!("Expected AppKit window");
    };
    // SAFETY: GPUI owns this live NSView; only accessed on AppKit's main thread.
    let view = unsafe { &*handle.ns_view.as_ptr().cast::<objc2_app_kit::NSView>() };
    let id = view
        .window()
        .ok_or_else(|| anyhow::anyhow!("Missing native window"))?
        .windowNumber();
    window
        .spawn(cx, async move |cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(500))
                .await;
            let result = cx
                .background_executor()
                .spawn(async move {
                    if let Some(parent) = path.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    let status = std::process::Command::new("/usr/sbin/screencapture")
                        .args(["-x", "-o", "-l", &id.to_string()])
                        .arg(&path)
                        .status()?;
                    anyhow::ensure!(status.success(), "OS screenshot failed: {status}");
                    std::fs::write(
                        path.with_extension("json"),
                        serde_json::to_vec_pretty(&geometry)?,
                    )?;
                    Ok::<(), anyhow::Error>(())
                })
                .await;
            let _ = cx.update(|window, _| {
                if let Err(error) = result {
                    eprintln!("Screenshot failed: {error:#}");
                }
                window.remove_window();
            });
        })
        .detach();
    Ok(())
}
#[cfg(not(target_os = "macos"))]
pub fn schedule(_: &Window, _: &App, _: PathBuf, _: serde_json::Value) -> anyhow::Result<()> {
    anyhow::bail!("OS screenshot capture is currently implemented for macOS")
}
