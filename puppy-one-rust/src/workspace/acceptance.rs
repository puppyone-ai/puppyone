//! The Cloud flows against the real deployment (VA-1): sign-in (a Supabase
//! password grant in place of the browser, then this repository's broker
//! from its refresh token), spaces, a new project in a space made once under
//! its operation key, opening its Cloud Computer, editing and saving a file
//! there, History, an Agent invitation, and the project removed at the end.
//! The v0.4.4 space flows follow (AC-1): the default space, its members
//! and access, Plan (catalog, summary, usage and a quote — nothing is paid:
//! a checkout stops at its URL), and Create space with an invitation and a
//! project opened and saved in it, all taken back at the end. Run explicitly:
//!
//! ```text
//! cargo test -p po-workspace --features test-support -- workspace::acceptance --ignored --nocapture
//! ```
#![cfg(test)]
use super::cloud::{
    Target, agents, billing,
    opening::{self, Phase},
    services::{BrokerTransport, Client},
    spaces,
};
use crate::cloud::auth::{Broker, Cancellation, model::ApiRequest, model::Binding};
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
        .find(|s| s.is_default)
        .expect("the account's own space");
    let teams: Vec<_> = found.iter().filter(|s| !s.is_default).collect();
    step(&format!("2 spaces: personal + {} team(s)", teams.len()));
    let name = format!("Rust acceptance {}", &uuid::Uuid::new_v4().to_string()[..8]);
    // The operation key is a canonical UUIDv4, as the create dialog makes it.
    let operation = uuid::Uuid::new_v4().to_string();
    let mut made = Vec::new();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let first = client
            .create_project(&name, &personal.id, &operation)
            .unwrap();
        made.push(first.id.clone());
        let again = client
            .create_project(&name, &personal.id, &operation)
            .unwrap();
        assert_eq!(first.id, again.id, "one project per operation");
        step("4 created once in the personal space");
        if let Some(team) = teams.iter().find(|t| t.can_create_projects) {
            let project = client
                .create_project(&name, &team.id, &uuid::Uuid::new_v4().to_string())
                .unwrap();
            made.push(project.id);
            step("4 created in a team space too");
        }
        let prepared = opening::prepare(
            broker.clone(),
            binding.clone(),
            Target::ProjectRoot {
                project_id: first.id.clone(),
            },
            &Cancellation::default(),
            false,
            |phase: Phase| eprintln!("[cloud]   phase {phase:?}"),
        )
        .unwrap_or_else(|failure| {
            panic!(
                "Cloud opening failed: {} ({:?}, status {:?}, reason {:?})",
                failure.code, failure.recovery, failure.status, failure.reason
            )
        });
        let (workspace, _) = prepared.into_parts().unwrap();
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
        let request =
            super::cloud::history::page_request(&first.id, None).expect("history request");
        let page = broker
            .request(&binding, &request)
            .expect("History must be readable");
        let history = super::cloud::history::parse_page(&page, &first.id, false)
            .expect("History must satisfy its contract");
        assert_eq!(history.project, first.id);
        step("7 History read and validated");
        let agents = agents::Client::new(Arc::new(BrokerTransport {
            broker: broker.clone(),
            binding: binding.clone(),
            cancel: Cancellation::default(),
        }));
        let url = agents
            .create_link(&first.id, agents::Admission::SignIn)
            .expect("Agent link creation");
        assert!(
            url::Url::parse(&url).is_ok(),
            "Agent link must be an absolute URL"
        );
        let inventory = agents.links(&first.id).expect("Agent inventory");
        assert!(
            inventory
                .links
                .iter()
                .any(|link| link.admission == agents::Admission::SignIn),
            "the created Agent link must be listed"
        );
        step("8 Agent link created and listed (not sent)");
    }));
    let mut cleanup_errors = Vec::new();
    for id in made {
        if let Err(error) = client.delete_project(&id) {
            cleanup_errors.push(format!("project {id}: {error:?}"));
        }
    }
    assert!(
        cleanup_errors.is_empty(),
        "test resource cleanup failed: {cleanup_errors:?}"
    );
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// The account's broker through its refresh token, as the App signs in.
fn signed_in() -> (Arc<Broker>, Binding, String) {
    let account = crate::workspace::hosts::acceptance::Account::sign_in();
    let web =
        std::env::var("ACCEPT_WEB").unwrap_or_else(|_| "https://qubits-try.puppyone.ai".into());
    let email = account.grant["user"]["email"].as_str().unwrap().to_owned();
    let broker = crate::cloud::auth::refresh_token_broker(
        &account.api,
        &web,
        &account.user,
        &email,
        account.grant["refresh_token"].as_str().unwrap(),
    );
    let binding = broker.signed_in_binding().unwrap();
    (broker, binding, email)
}
/// A request the App never makes: the test's own cleanup.
fn raw(
    broker: &Broker,
    binding: &Binding,
    method: reqwest::Method,
    path: String,
) -> crate::cloud::auth::model::Result<serde_json::Value> {
    broker.request(
        binding,
        &ApiRequest {
            idempotency_key: None,
            method,
            path,
            query: vec![],
            body: None,
        },
    )
}

/// Project deletion holds space deletion until the server's quiescence period.
/// A bounded retry may wait for that contract, but never report a refusal as success.
fn remove_space(broker: &Broker, binding: &Binding, id: &str) {
    use crate::cloud::auth::model::Error;
    let deadline = Instant::now() + std::time::Duration::from_secs(80 * 60);
    loop {
        match raw(
            broker,
            binding,
            reqwest::Method::DELETE,
            format!("/organizations/{id}"),
        ) {
            Ok(_) | Err(Error::Http(404)) => return,
            Err(error @ (Error::Http(409) | Error::Service(409, _) | Error::OutcomeUnknown))
                if Instant::now() < deadline =>
            {
                eprintln!("[spaces] waiting for cleanup of {id}: {error:?}");
                std::thread::sleep(std::time::Duration::from_secs(60));
            }
            Err(error) => panic!("space cleanup failed for {id}: {error:?}"),
        }
    }
}

#[test]
#[ignore = "real Cloud acceptance; run explicitly"]
fn the_v044_space_flows_work_against_the_real_deployment() {
    let started = Instant::now();
    let step = |what: &str| eprintln!("[spaces] {what} ({} ms)", started.elapsed().as_millis());
    let (broker, binding, _email) = signed_in();
    let transport = || {
        Arc::new(BrokerTransport {
            broker: broker.clone(),
            binding: binding.clone(),
            cancel: Cancellation::default(),
        })
    };
    let client = Client::new(transport());
    let plans = billing::Client::new(transport());
    step("1 signed in through the broker");

    // SC: exactly one default space, listed first.
    let found = spaces::discover(&client).unwrap();
    assert!(found[0].is_default, "the default space comes first");
    assert_eq!(found.iter().filter(|s| s.is_default).count(), 1);
    let default = &found[0];
    step(&format!(
        "2 {} space(s); default {} plan {:?}, can create projects: {}",
        found.len(),
        default.id,
        default.plan_id,
        default.can_create_projects
    ));

    // MB: the default space's members and this person's access.
    let members = client.members(&default.id).unwrap();
    assert!(
        members.iter().any(|m| m.user_id == binding.user),
        "this person is a member"
    );
    let access = plans.access(&default.id).unwrap();
    assert_eq!(access.can_manage_billing, access.role == "owner");
    step(&format!(
        "3 members: {}; my role {} (billing: {})",
        members.len(),
        access.role,
        access.can_manage_billing
    ));

    // PL: the catalog the Plan page prices, and the space's plan and usage.
    let catalog = plans.catalog().unwrap();
    for plan in &catalog.plans {
        step(&format!(
            "4 plan {} ({}) public {} purchasable {} {:?} cents/seat",
            plan.id, plan.name, plan.public, plan.purchasable, plan.price_per_seat_cents
        ));
    }
    step(&format!(
        "4 add-ons: {}",
        catalog.add_ons.as_ref().map_or(0, Vec::len)
    ));
    let summary = plans.summary(&default.id).expect("Plan summary");
    assert!(!summary.plan_id.is_empty());
    plans.usage(&default.id).expect("Plan usage");
    step("4 plan summary and usage read");

    // CS: a space made under a unique name; Members ready to invite.
    let name = format!("Rust acceptance {}", &uuid::Uuid::new_v4().to_string()[..8]);
    let made = client.create_space(&name).unwrap();
    step(&format!("5 created space {} ({name})", made.id));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let after = spaces::discover(&client).unwrap();
        let space = after
            .iter()
            .find(|s| s.id == made.id)
            .expect("the new space is listed");
        assert!(!space.is_default);
        assert_eq!(space.role.as_deref(), Some("owner"));
        assert!(space.can_manage_space && space.can_create_projects);
        let owners = client.members(&made.id).unwrap();
        assert_eq!(owners.len(), 1, "only its maker");
        step("5 listed, owned, ready to invite");
        // A project in the new space: made once, opened, a file saved, and
        // removed before the space is.
        let project = client
            .create_project(&name, &made.id, &uuid::Uuid::new_v4().to_string())
            .unwrap();
        step(&format!("6 created project {} in the space", project.id));
        let cancel = Cancellation::default();
        let opened = opening::prepare(
            broker.clone(),
            binding.clone(),
            Target::ProjectRoot {
                project_id: project.id.clone(),
            },
            &cancel,
            false,
            |phase: Phase| eprintln!("[spaces]   phase {phase:?}"),
        );
        let saved = opened
            .map_err(|f| format!("{} ({:?})", f.code, f.recovery))
            .and_then(|prepared| {
                let (workspace, _) = prepared.into_parts().map_err(|e| format!("{e:?}"))?;
                let created = workspace
                    .create_entry(Path::new(""), "team.md", false, "")
                    .map_err(|e| format!("{e:?}"))?;
                let document = workspace.read(&created).map_err(|e| format!("{e:?}"))?;
                workspace
                    .save(&document, "# Saved in a team space\n")
                    .map_err(|e| format!("{e:?}"))?;
                workspace
                    .read(&created)
                    .map(|d| d.text)
                    .map_err(|e| format!("{e:?}"))
            });
        let removed = client.delete_project(&project.id);
        step(&format!(
            "6 opened and saved: {saved:?}; project removed: {}",
            removed.is_ok()
        ));
        assert_eq!(saved.as_deref(), Ok("# Saved in a team space\n"));
        assert!(removed.is_ok(), "the project made is removed");
        // A quote for the Team plan — nothing is bought.
        if let Some(team) = catalog
            .plans
            .iter()
            .find(|p| p.purchasable && p.id != "free")
        {
            let quote = plans
                .quote_plan(&made.id, &team.id, 1, uuid::Uuid::new_v4().to_string())
                .expect("Plan quote");
            assert_eq!(quote.target_plan_id, team.id);
            if quote.application_mode == "checkout" {
                let (url, _, _) = plans
                    .checkout(&made.id, &quote, None, uuid::Uuid::new_v4().to_string())
                    .expect("Checkout URL");
                assert_eq!(url::Url::parse(&url).unwrap().scheme(), "https");
                step("7 checkout URL validated (not opened, nothing paid)");
            }
        } else {
            // The Plan page then offers nothing to buy ("Coming soon").
            step("7 no purchasable plan in this deployment's catalog: no quote");
        }
    }));
    // This case never sends invitations.
    remove_space(&broker, &binding, &made.id);
    let gone = spaces::discover(&client)
        .unwrap()
        .iter()
        .all(|s| s.id != made.id);
    eprintln!("[spaces] the space is gone: {gone}");
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
    assert!(gone, "the space made is removed");
}

/// This case sends an actual invitation email. Run only with explicit approval.
#[test]
#[ignore = "sends invitation email; requires explicit PUPPYONE_LIVE_EMAIL=1"]
fn the_space_invitation_flow_sends_and_revokes_a_test_invitation() {
    assert_eq!(
        std::env::var("PUPPYONE_LIVE_EMAIL").as_deref(),
        Ok("1"),
        "invitation email acceptance requires explicit opt-in"
    );
    let (broker, binding, email) = signed_in();
    let client = Client::new(Arc::new(BrokerTransport {
        broker: broker.clone(),
        binding: binding.clone(),
        cancel: Cancellation::default(),
    }));
    let made = client
        .create_space(&format!("Rust invitation {}", uuid::Uuid::new_v4()))
        .unwrap();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let (local, domain) = email.split_once('@').unwrap();
        let alias = format!("{local}+rust-accept@{domain}");
        client
            .invite(&made.id, &alias, super::cloud::services::MemberRole::Member)
            .unwrap();
        let value = raw(
            &broker,
            &binding,
            reqwest::Method::GET,
            format!("/organizations/{}/invitations", made.id),
        )
        .unwrap();
        let list = value
            .get("data")
            .unwrap_or(&value)
            .as_array()
            .expect("invitation list");
        assert!(
            list.iter().any(|item| item["email"] == alias),
            "the sent invitation must be listed"
        );
        for invitation in list {
            let id = invitation["id"].as_str().expect("invitation id");
            raw(
                &broker,
                &binding,
                reqwest::Method::DELETE,
                format!("/organizations/{}/invitations/{id}", made.id),
            )
            .unwrap();
        }
    }));
    remove_space(&broker, &binding, &made.id);
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// Spaces an interrupted run left behind (`ACCEPT_SPACE`, comma
/// separated), removed.
#[test]
#[ignore = "real Cloud cleanup; run explicitly"]
fn a_space_a_run_left_behind_is_removed() {
    let (broker, binding, _) = signed_in();
    for id in std::env::var("ACCEPT_SPACE").unwrap().split(',') {
        remove_space(&broker, &binding, id.trim());
    }
}
