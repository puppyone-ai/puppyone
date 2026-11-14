//! The Cloud flows against the real deployment (VA-1): sign-in (a Supabase
//! password grant in place of the browser, then this repository's broker
//! from its refresh token), spaces, a new project in a space made once under
//! its operation key, opening its Cloud Computer, editing and saving a file
//! there, History, an Agent invitation, and the project removed at the end.
//! The v0.4.4 space flows follow (AC-1): the default space, its members
//! and access, Plan (catalog, summary, usage and a quote — nothing is paid:
//! a checkout stops at its URL), and Create space with an invitation, both
//! taken back at the end. Run explicitly:
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
fn raw(broker: &Broker, binding: &Binding, method: reqwest::Method, path: String) -> String {
    let request = ApiRequest {
        idempotency_key: None,
        method,
        path,
        query: vec![],
        body: None,
    };
    match broker.request(binding, &request) {
        Ok(value) => format!(
            "ok {}",
            value.to_string().chars().take(160).collect::<String>()
        ),
        Err(error) => format!("refused {error:?}"),
    }
}

#[test]
#[ignore = "real Cloud acceptance; run explicitly"]
fn the_v044_space_flows_work_against_the_real_deployment() {
    let started = Instant::now();
    let step = |what: &str| eprintln!("[spaces] {what} ({} ms)", started.elapsed().as_millis());
    let (broker, binding, email) = signed_in();
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
    match plans.summary(&default.id) {
        Ok(summary) => step(&format!(
            "4 summary: plan {} status {} seats {}",
            summary.plan_id, summary.status, summary.seat_quantity
        )),
        Err(error) => step(&format!("4 summary refused: {error:?}")),
    }
    match plans.usage(&default.id) {
        Ok(_) => step("4 usage read"),
        Err(error) => step(&format!("4 usage refused: {error:?}")),
    }

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
        // An invitation to this account's own alias.
        let (local, domain) = email.split_once('@').unwrap();
        let alias = format!("{local}+rust-accept@{domain}");
        let link = client
            .invite(&made.id, &alias, super::cloud::services::MemberRole::Member)
            .unwrap();
        step(&format!(
            "6 invited {alias}; link returned: {}",
            link.is_some()
        ));
        // A quote for the Team plan — nothing is bought.
        if let Some(team) = catalog
            .plans
            .iter()
            .find(|p| p.purchasable && p.id != "free")
        {
            let quote = plans.quote_plan(&made.id, &team.id, 1, uuid::Uuid::new_v4().to_string());
            match quote {
                Ok(quote) => {
                    step(&format!(
                        "7 quote {}: {} {} cents, mode {}, effective {:?}",
                        quote.target_plan_id,
                        quote.currency,
                        quote.target_amount_cents,
                        quote.application_mode,
                        quote.effective
                    ));
                    if quote.application_mode == "checkout" {
                        match plans.checkout(
                            &made.id,
                            &quote,
                            None,
                            uuid::Uuid::new_v4().to_string(),
                        ) {
                            Ok((url, _, _)) => step(&format!(
                                "7 checkout URL on {} (not opened, nothing paid)",
                                url::Url::parse(&url)
                                    .map(|u| u.host_str().unwrap_or("").to_owned())
                                    .unwrap_or_default()
                            )),
                            Err(error) => step(&format!("7 checkout refused: {error:?}")),
                        }
                    }
                }
                Err(error) => step(&format!("7 quote refused: {error:?}")),
            }
        } else {
            // The Plan page then offers nothing to buy ("Coming soon").
            step("7 no purchasable plan in this deployment's catalog: no quote");
        }
    }));
    // Taken back: the pending invitations, then the space.
    let listed = broker.request(
        &binding,
        &ApiRequest {
            idempotency_key: None,
            method: reqwest::Method::GET,
            path: format!("/organizations/{}/invitations", made.id),
            query: vec![],
            body: None,
        },
    );
    let invitations: Vec<String> = listed
        .ok()
        .and_then(|v| {
            let list = v.get("data").cloned().unwrap_or(v);
            list.as_array().map(|items| {
                items
                    .iter()
                    .filter_map(|i| i["id"].as_str().map(str::to_owned))
                    .collect()
            })
        })
        .unwrap_or_default();
    for invitation in invitations {
        let revoked = raw(
            &broker,
            &binding,
            reqwest::Method::DELETE,
            format!("/organizations/{}/invitations/{invitation}", made.id),
        );
        eprintln!("[spaces] revoked invitation {invitation}: {revoked}");
    }
    let removed = raw(
        &broker,
        &binding,
        reqwest::Method::DELETE,
        format!("/organizations/{}", made.id),
    );
    eprintln!("[spaces] removed space {}: {removed}", made.id);
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
