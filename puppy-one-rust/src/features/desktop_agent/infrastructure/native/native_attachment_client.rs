use crate::{
    agent::{domain::reference_input::Reference, infrastructure::attachments},
    wake::Wake,
};
use std::{
    path::PathBuf,
    sync::mpsc::{self, Receiver},
};
/// Stages `paths` for the conversation `owner` off the UI thread.
pub fn stage(
    paths: Vec<PathBuf>,
    workspace: PathBuf,
    owner: String,
    existing: Vec<Reference>,
    wake: Wake,
) -> Receiver<Result<Vec<Reference>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = tx.send(attachments::stage(
            paths,
            Some(&workspace),
            &owner,
            &existing,
        ));
        wake.notify();
    });
    rx
}
