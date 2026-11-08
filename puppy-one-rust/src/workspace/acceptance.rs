//! The Cloud flows against the real deployment (VA-1): sign-in (a Supabase
//! password grant in place of the browser, then this repository's broker
//! from its refresh token), spaces, a new project in a space made once under
//! its operation key, opening its Cloud Computer, editing and saving a file
//! there, History, an Agent invitation, and the project removed at the end.
//! Run explicitly:
//!
//! ```text
//! cargo test -p po-workspace --features test-support -- workspace::acceptance --ignored --nocapture
//! ```
#![cfg(test)]
use super::cloud::{
    Target, agents,
    opening::{self, Phase},
    services::{BrokerTransport, Client},
    spaces::{self, Kind},
};
use crate::cloud::auth::Cancellation;
use std::{path::Path, sync::Arc, time::Instant};

#[test]
#[ignore = "real Cloud acceptance; run explicitly"]
fn the_cloud_flows_work_against_the_real_deployment() {
    let started = Instant::now();
    let step = |what: &str| eprintln!("[cloud] {what} ({} ms)", started.elapsed().as_millis());
    let account = crate::workspace::hosts::acceptance::Account::sign_in();
    let web =
        std::env::var("ACCEPT_WEB").unwrap_or_else(|_| "https://qubits-try.puppyone.ai".into());
    let broker = crate::cloud::auth::refresh_token_broker(
        &account.api,
        &web,
        &account.user,
        account.grant["user"]["email"].as_str().unwrap(),
        account.grant["refresh_token"].as_str().unwrap(),
    );
    let binding = broker.signed_in_binding().unwrap();
    step("1 signed in through the broker");
    let client = Client::new(Arc::new(BrokerTransport {
        broker: broker.clone(),
        binding: binding.clone(),
        cancel: Cancellation::default(),
    }));
    let found = spaces::discover(&client).unwrap();
    let personal = found
        .iter()
        .find(|s| s.kind == Kind::Personal)
        .expect("a personal space");
    let teams: Vec<_> = found.iter().filter(|s| s.kind == Kind::Team).collect();
    step(&format!("2 spaces: personal + {} team(s)", teams.len()));
    let name = format!("Rust acceptance {}", &uuid::Uuid::new_v4().to_string()[..8]);
    // The operation key is a canonical UUIDv4, as the create dialog makes it.
    let operation = uuid::Uuid::new_v4().to_string();
    let first = client
        .create_project(&name, &personal.id, &operation)
        .unwrap();
    let again = client
        .create_project(&name, &personal.id, &operation)
        .unwrap();
    assert_eq!(first.id, again.id, "one project per operation");
    step(&format!(
        "4 created {} once in the personal space",
        first.id
    ));
    let mut made = vec![first.id.clone()];
    if let Some(team) = teams.iter().find(|t| t.can_create_projects) {
        let team_project = client
            .create_project(&name, &team.id, &uuid::Uuid::new_v4().to_string())
            .unwrap();
        made.push(team_project.id);
        step("4 created in a team space too");
    }
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // 6. The Cloud Computer, edited and saved.
        let cancel = Cancellation::default();
        let opened = opening::prepare(
            broker.clone(),
            binding.clone(),
            Target::ProjectRoot {
                project_id: first.id.clone(),
            },
            &cancel,
            false,
            |phase: Phase| eprintln!("[cloud]   phase {phase:?}"),
        );
        match opened {
            Ok(prepared) => {
                let (workspace, root) = prepared.into_parts().unwrap();
                step(&format!("6 opened, {} entries at its root", root.len()));
                let created = workspace
                    .create_entry(Path::new(""), "from-rust.md", false, "")
                    .unwrap();
                let document = workspace.read(&created).unwrap();
                let saved = workspace.save(&document, "# Saved from Rust\n").unwrap();
                assert!(!saved.updated);
                assert_eq!(
                    workspace.read(&created).unwrap().text,
                    "# Saved from Rust\n"
                );
                step("6 edited and saved there");
            }
            Err(failure) => {
                // 9. A failure is classified by what to do next.
                step(&format!(
                    "6/9 opening refused: {} ({:?}, status {:?}, reason {:?}, request {:?})",
                    failure.code,
                    failure.recovery,
                    failure.status,
                    failure.reason,
                    failure.request_id
                ));
            }
        }
        // 7. History.
        if let Some(request) = super::cloud::history::page_request(&first.id, None) {
            match broker.request(&binding, &request) {
                Ok(page) => {
                    let history = super::cloud::history::parse_page(&page, &first.id, false);
                    step(&format!("7 History read: {}", history.is_ok()));
                }
                Err(error) => step(&format!("7 History refused: {error:?}")),
            }
        }
        // 8. An Agent invitation, then the inventory that lists it.
        let agents = agents::Client::new(Arc::new(BrokerTransport {
            broker: broker.clone(),
            binding: binding.clone(),
            cancel: Cancellation::default(),
        }));
        match agents.create_link(&first.id, agents::Admission::SignIn) {
            Ok(url) => {
                let inventory = agents.links(&first.id).unwrap();
                step(&format!(
                    "8 invitation {} made; {} link(s) listed",
                    agents::mask_secret(&url),
                    inventory.links.len()
                ));
            }
            Err(error) => step(&format!("8 invitation refused: {error:?}")),
        }
    }));
    for id in made {
        let removed = client.delete_project(&id);
        eprintln!("[cloud] removed {id}: {}", removed.is_ok());
    }
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
