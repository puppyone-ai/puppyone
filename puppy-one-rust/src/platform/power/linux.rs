//! Linux: logind's `PrepareForSleep(start)` on the system bus; `true`
//! before sleep, `false` after.
use super::{Event, Listener};
use futures_lite::StreamExt as _;

pub(super) fn watch(listener: Listener) -> bool {
    let (ready, registered) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new()
        .name("puppyone-power".into())
        .spawn(move || {
            futures_lite::future::block_on(async move {
                let signals = async {
                    let connection = zbus::Connection::system().await?;
                    let manager = zbus::Proxy::new(
                        &connection,
                        "org.freedesktop.login1",
                        "/org/freedesktop/login1",
                        "org.freedesktop.login1.Manager",
                    )
                    .await?;
                    let signals = manager.receive_signal("PrepareForSleep").await?;
                    zbus::Result::Ok((connection, signals))
                };
                let Ok((_connection, mut signals)) = signals.await else {
                    let _ = ready.send(false);
                    return;
                };
                let _ = ready.send(true);
                while let Some(message) = signals.next().await {
                    match message.body().deserialize::<bool>() {
                        Ok(true) => listener(Event::Suspend),
                        Ok(false) => listener(Event::Wake),
                        Err(_) => {}
                    }
                }
            });
        });
    spawned.is_ok() && registered.recv().unwrap_or(false)
}
