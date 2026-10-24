use crate::{
    agent::{domain::reference_input::Reference, infrastructure::attachments},
    wake::Wake,
};
use std::{
    path::PathBuf,
    sync::mpsc::{self, Receiver},
};
pub fn stage(paths: Vec<PathBuf>, wake: Wake) -> Receiver<Result<Vec<Reference>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = tx.send(attachments::stage(paths));
        wake.notify();
    });
    rx
}
