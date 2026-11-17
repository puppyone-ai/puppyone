//! Desktop application icon contract and macOS development bundle adapter
//! (`shared/desktop/app-icon-contract.mjs` + `electron/main/app-icon.mjs`).
//!
//! Installed bundles use their stamped `icon.icns` (`CFBundleIconFile`).
//! Unstamped development binaries (`target/{debug,release}/puppy-one-rust`)
//! materialize a lightweight `.app` wrapper alongside the Cargo binary and
//! apply the GPUI Blue-`D` development Dock icon (`puppy-app-image-gpui-dev.png`).

use super::application_identity;
use super::build_identity::Channel;
use std::path::Path;

pub const MACOS_APP_ICON_FILENAME: &str = "icon.icns";

/// Source PNG relative to `assets/release/` (`resolveDesktopAppIcon`).
pub const fn channel_icon_source(channel: Channel) -> &'static str {
    match channel {
        Channel::Dev => "puppy-app-image-gpui-dev.png",
        Channel::Internal | Channel::Stable => "puppy-app-image.png",
    }
}

#[cfg(target_os = "macos")]
const DEV_APP_ICON_PNG: &[u8] = include_bytes!("../../assets/release/puppy-app-image-gpui-dev.png");

/// When an unstamped development binary is launched directly out of Cargo's
/// `target/{debug,release}/puppy-one-rust`, materialize `<app_name>.app` beside
/// it and `exec` in-place so macOS Dock, `Cmd+Tab`, and Mission Control display
/// `app_name` and the PuppyOne Blue-`D` icon rather than `puppy-one-rust`.
pub fn reexec_in_development_bundle(app_name: &str) {
    #[cfg(target_os = "macos")]
    {
        if std::env::var_os("PUPPYONE_NO_DEV_BUNDLE").is_some()
            || std::env::var_os("PUPPYONE_DEV_BUNDLED").is_some()
        {
            return;
        }
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        if exe.file_name().and_then(|n| n.to_str()) != Some("puppy-one-rust") {
            return;
        }
        let Some(profile_dir) = exe.parent() else {
            return;
        };
        let in_cargo_target = profile_dir
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| matches!(n, "debug" | "release"))
            && profile_dir
                .parent()
                .and_then(|t| t.file_name())
                .is_some_and(|n| n == "target");
        if !in_cargo_target {
            return;
        }
        let Some(bundled_exe) = materialize_dev_bundle(profile_dir, &exe, app_name) else {
            return;
        };
        use std::os::unix::process::CommandExt as _;
        let args: Vec<_> = std::env::args_os().skip(1).collect();
        let _ = std::process::Command::new(&bundled_exe)
            .args(args)
            .env("PUPPYONE_DEV_BUNDLED", "1")
            .exec();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_name;
    }
}

/// Applies the development process name and Blue-`D` PuppyOne Dock icon for
/// unpackaged builds (`setDevelopmentDockIcon` in `electron/main/app-icon.mjs`).
pub fn set_development_dock_icon(app_name: &str, packaged: bool) {
    #[cfg(target_os = "macos")]
    {
        if packaged {
            return;
        }
        set_macos_process_name(app_name);
        if let Some(mtm) = objc2::MainThreadMarker::new()
            && let Some(icon) = decode_dev_dock_icon()
        {
            let app = objc2_app_kit::NSApplication::sharedApplication(mtm);
            // SAFETY: `app` is the main-thread singleton and `icon` is a valid retained `NSImage`.
            unsafe {
                let _: () = objc2::msg_send![&*app, setApplicationIconImage: &*icon];
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app_name, packaged);
    }
}

#[cfg(target_os = "macos")]
fn set_macos_process_name(app_name: &str) {
    use objc2::{class, msg_send, runtime::AnyObject};
    use objc2_foundation::NSString;
    let ns_name = NSString::from_str(app_name);
    // SAFETY: `NSProcessInfo.processInfo` is thread-safe and accepts an `NSString`.
    unsafe {
        let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        if !info.is_null() {
            let _: () = msg_send![info, setProcessName: &*ns_name];
        }
    }
}

#[cfg(target_os = "macos")]
fn decode_dev_dock_icon() -> Option<objc2::rc::Retained<objc2_app_kit::NSImage>> {
    use objc2::{AnyThread as _, class, msg_send, rc::Retained, runtime::AnyObject};
    use objc2_app_kit::NSImage;
    // SAFETY: `DEV_APP_ICON_PNG` is static valid PNG data; `NSData` wraps the slice for `initWithData:`.
    unsafe {
        let data: *mut AnyObject = msg_send![
            class!(NSData),
            dataWithBytes: DEV_APP_ICON_PNG.as_ptr().cast::<std::ffi::c_void>(),
            length: DEV_APP_ICON_PNG.len(),
        ];
        if data.is_null() {
            return None;
        }
        let image: Option<Retained<NSImage>> = msg_send![NSImage::alloc(), initWithData: data];
        image
    }
}

#[cfg(target_os = "macos")]
fn materialize_dev_bundle(
    profile_dir: &Path,
    exe: &Path,
    app_name: &str,
) -> Option<std::path::PathBuf> {
    use std::os::unix::fs::MetadataExt as _;
    let bundle_name: String = app_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_' | '[' | ']' | '.'))
        .collect();
    let bundle_name = bundle_name.trim();
    if bundle_name.is_empty() {
        return None;
    }
    let app_dir = profile_dir.join(format!("{bundle_name}.app"));
    let contents = app_dir.join("Contents");
    let macos_dir = contents.join("MacOS");
    let resources_dir = contents.join("Resources");
    std::fs::create_dir_all(&macos_dir).ok()?;
    std::fs::create_dir_all(&resources_dir).ok()?;

    let bundled_exe = macos_dir.join("puppy-one-rust");
    let src_meta = std::fs::metadata(exe).ok()?;
    let needs_link = std::fs::metadata(&bundled_exe)
        .map(|dst| dst.ino() != src_meta.ino() || dst.len() != src_meta.len())
        .unwrap_or(true);
    if needs_link {
        let _ = std::fs::remove_file(&bundled_exe);
        std::fs::hard_link(exe, &bundled_exe)
            .or_else(|_| std::fs::copy(exe, &bundled_exe).map(|_| ()))
            .ok()?;
    }

    let cloud_link = resources_dir.join("desktop-cloud.json");
    if std::fs::symlink_metadata(&cloud_link).is_err() {
        let _ = std::os::unix::fs::symlink(Path::new("../../../desktop-cloud.json"), &cloud_link);
    }

    ensure_dev_bundle_icns(&resources_dir);

    let escaped_name = xml_escape(app_name);
    let version = env!("CARGO_PKG_VERSION");
    let bundle_id = application_identity::dev_wrapper_bundle_id(bundle_name);
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>{escaped_name}</string>
    <key>CFBundleExecutable</key>
    <string>puppy-one-rust</string>
    <key>CFBundleIconFile</key>
    <string>{MACOS_APP_ICON_FILENAME}</string>
    <key>CFBundleIdentifier</key>
    <string>{bundle_id}</string>
    <key>CFBundleName</key>
    <string>{escaped_name}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>{version}</string>
    <key>CFBundleVersion</key>
    <string>{version}</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
"#
    );
    let plist_path = contents.join("Info.plist");
    if std::fs::read(&plist_path).ok().as_deref() != Some(plist.as_bytes()) {
        std::fs::write(&plist_path, plist.as_bytes()).ok()?;
    }
    Some(bundled_exe)
}

#[cfg(target_os = "macos")]
fn ensure_dev_bundle_icns(resources_dir: &Path) {
    let icns = resources_dir.join(MACOS_APP_ICON_FILENAME);
    let stamp = resources_dir.join(".icon.blake3");
    let hash = blake3::hash(DEV_APP_ICON_PNG).to_hex().to_string();
    if icns.is_file() && std::fs::read_to_string(&stamp).ok().as_deref() == Some(hash.as_str()) {
        return;
    }
    let staging = resources_dir.join("app.iconset");
    let _ = std::fs::remove_dir_all(&staging);
    if std::fs::create_dir_all(&staging).is_err() {
        return;
    }
    let source = staging.join("icon_512x512@2x.png");
    if std::fs::write(&source, DEV_APP_ICON_PNG).is_err() {
        let _ = std::fs::remove_dir_all(&staging);
        return;
    }
    for (name, px) in [
        ("icon_16x16.png", "16"),
        ("icon_16x16@2x.png", "32"),
        ("icon_32x32.png", "32"),
        ("icon_32x32@2x.png", "64"),
        ("icon_128x128.png", "128"),
        ("icon_128x128@2x.png", "256"),
        ("icon_256x256.png", "256"),
        ("icon_256x256@2x.png", "512"),
        ("icon_512x512.png", "512"),
    ] {
        let out = staging.join(name);
        let _ = std::process::Command::new("/usr/bin/sips")
            .args(["-z", px, px])
            .arg(&source)
            .arg("--out")
            .arg(&out)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    let ok = std::process::Command::new("/usr/bin/iconutil")
        .args(["-c", "icns"])
        .arg(&staging)
        .arg("-o")
        .arg(&icns)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    let _ = std::fs::remove_dir_all(&staging);
    if ok {
        let _ = std::fs::write(&stamp, hash.as_bytes());
    }
}

#[cfg(target_os = "macos")]
fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn channel_icon_sources_match_release_policy() {
        assert_eq!(
            channel_icon_source(Channel::Dev),
            "puppy-app-image-gpui-dev.png"
        );
        assert_eq!(
            channel_icon_source(Channel::Internal),
            "puppy-app-image.png"
        );
        assert_eq!(channel_icon_source(Channel::Stable), "puppy-app-image.png");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn embedded_dev_dock_icon_decodes_at_1024px() {
        let icon = decode_dev_dock_icon().expect("decode embedded Blue-D dev icon");
        let size: objc2_foundation::NSSize = unsafe { objc2::msg_send![&*icon, size] };
        assert_eq!((size.width, size.height), (1024.0, 1024.0));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn materialize_dev_bundle_writes_plist_and_icns() {
        let tmp = tempfile::tempdir().unwrap();
        let target_debug = tmp.path().join("target/debug");
        std::fs::create_dir_all(&target_debug).unwrap();
        let fake_exe = target_debug.join("puppy-one-rust");
        std::fs::write(&fake_exe, b"#!/bin/sh\n").unwrap();

        let bundled = materialize_dev_bundle(
            &target_debug,
            &fake_exe,
            "PuppyOne Rust Dev [cloud-desktop]",
        )
        .expect("materialize dev bundle");
        assert!(bundled.is_file());
        let app_dir = target_debug.join("PuppyOne Rust Dev [cloud-desktop].app");
        let plist = std::fs::read_to_string(app_dir.join("Contents/Info.plist")).unwrap();
        assert!(plist.contains("<string>PuppyOne Rust Dev [cloud-desktop]</string>"));
        assert!(app_dir.join("Contents/Resources/icon.icns").is_file());
    }
}
