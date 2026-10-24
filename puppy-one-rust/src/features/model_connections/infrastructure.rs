use crate::{model_connections::configuration, wake::Wake};
pub use configuration::ModelConnection;
use std::sync::mpsc::{self, Receiver};
pub fn load(wake: Wake) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let _ = tx.send(configuration::load());
        wake.notify();
    });
    rx
}
pub fn save(
    connection: ModelConnection,
    secret: Option<String>,
    wake: Wake,
) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let result = configuration::save(connection, secret).and_then(|()| configuration::load());
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}

pub fn remove(
    id: String,
    generation: String,
    wake: Wake,
) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let result = configuration::remove(&id, &generation).and_then(|()| configuration::load());
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}
