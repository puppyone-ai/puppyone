//! The process's Agent host (`electron/main.mjs`'s Agent services): started
//! when a window first needs it, and drained before the app quits
//! (`agent-shutdown.mjs` holds quit until sessions and processes end).
use crate::agent::host::agent_host::{AgentHostHandle, AgentHostOptions};
use gpui::{App, Global};
use std::time::Duration;

/// How long quitting waits for Agent sessions and processes to drain.
const QUIT_DRAIN: Duration = Duration::from_secs(10);

struct AgentHostGlobal(AgentHostHandle);
impl Global for AgentHostGlobal {}

/// The running Agent host, started on first use.
pub fn agent_host(cx: &mut App) -> Result<AgentHostHandle, String> {
    if let Some(AgentHostGlobal(handle)) = cx.try_global::<AgentHostGlobal>() {
        return Ok(handle.clone());
    }
    let handle = AgentHostHandle::start_production(AgentHostOptions {
        user_data_path: crate::platform::data_dir(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        app_path: None,
        executable_path: std::env::current_exe()
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
    })
    .map_err(|error| error.to_string())?;
    let drain = handle.clone();
    cx.on_app_quit(move |_| {
        // GPUI waits only briefly for quit handlers; the drain blocks the
        // quit itself, bounded, as the product's quit coordinator does.
        let done = drain.shutdown();
        let (sender, drained) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            if let Ok(runtime) = tokio::runtime::Builder::new_current_thread().build() {
                runtime.block_on(done);
            }
            let _ = sender.send(());
        });
        let _ = drained.recv_timeout(QUIT_DRAIN);
        async {}
    })
    .detach();
    cx.set_global(AgentHostGlobal(handle.clone()));
    Ok(handle)
}
