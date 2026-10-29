use crate::{
    agent::{domain::reference_input::Reference, infrastructure::attachments},
    wake::Wake,
};
use std::{
    path::PathBuf,
    sync::mpsc::{self, Receiver},
};
/// `authorizeAgentReferences` before a turn: live references are checked
/// and read again; staged snapshots must be intact.
pub fn authorize(references: &mut [Reference], workspace: &std::path::Path) -> Result<(), String> {
    attachments::authorize(references, Some(workspace))
}
/// The grants of references that left the draft end.
pub fn revoke(references: &[Reference]) {
    attachments::revoke(references)
}
/// A closed conversation's attachments go with it (`revokeOwner`).
pub fn revoke_owner(owner: &str) {
    attachments::revoke_owner(owner)
}
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
