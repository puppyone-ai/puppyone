//! An isolated native-engine fixture process, never part of the packaged app.
fn main() {
    #[cfg(target_os = "macos")]
    po_editor::web_host::run_whiteboard_probe(std::path::Path::new(
        &std::env::args_os().nth(1).expect("installed pack root"),
    ));
    #[cfg(not(target_os = "macos"))]
    panic!("The WebKit whiteboard probe requires macOS");
}
