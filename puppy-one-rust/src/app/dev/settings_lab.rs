//! `settings-fixture:<space>/<page>`: Settings by scope, signed in to a
//! fixture account with three spaces: Personal (just the account), Acme
//! Research (a team it owns, on Team) and Studio Lab (a team another person
//! owns, where it is a member). `<space>` is `me`, `acme` or `studio`;
//! `<page>` is `account`, `members`, `plan` or `space`.
use crate::app::*;
use serde_json::json;

fn member(id: &str, name: &str, email: &str, role: &str) -> serde_json::Value {
    json!({"user_id": id, "display_name": name, "email": email, "role": role})
}

/// The fixture account's spaces, their people and their plans.
fn responder() -> crate::cloud::auth::Responder {
    std::sync::Arc::new(|request| {
        let path = request.path.as_str();
        // Every answer names the space it was asked about.
        let org = path
            .trim_start_matches("/billing")
            .trim_start_matches("/organizations/")
            .split('/')
            .next()
            .unwrap_or_default()
            .to_owned();
        let plan = |id: &str, name: &str, cents: u64, history: u64, gb: u64| {
            json!({"id": id, "aliases": [], "name": name, "public": true, "purchasable": true,
                "currency": "USD", "price_per_seat_cents": cents,
                "seats": {"minimum": 1, "maximum": null},
                "features": {"team.member_roles": true, "billing.consolidated": true},
                "runtime": {"fixed_units": 0, "units_per_seat": 2400},
                "fixed_limits": {"history.retention_days": history},
                "per_seat_limits": {"projects.max": 20, "storage.max_bytes": gb * 1_000_000_000u64}})
        };
        Ok(match path {
            "/organizations/" => json!([
                {"id": "me", "name": "alice", "is_default": true, "role": "owner",
                 "can_create_projects": true, "can_manage_space": true,
                 "billing_plan_id": "free"},
                {"id": "acme", "name": "Acme Research", "role": "owner",
                 "can_create_projects": true, "can_manage_space": true,
                 "billing_plan_id": "team_v2"},
                {"id": "studio", "name": "Studio Lab", "role": "member",
                 "can_create_projects": true, "can_manage_space": false,
                 "billing_plan_id": "free"}]),
            "/organizations/me/members" => {
                json!([member("alice", "Alice", "alice@example.test", "owner")])
            }
            "/organizations/acme/members" => json!([
                member("alice", "Alice", "alice@example.test", "owner"),
                member("mia", "Mia Chen", "mia@acme.ai", "member"),
                member("leo", "Leo Park", "leo@acme.ai", "member"),
                member("sam", "Sam Lee", "sam@acme.ai", "viewer")
            ]),
            "/organizations/studio/members" => json!([
                member("ada", "Ada Wong", "ada@studio.dev", "owner"),
                member("alice", "Alice", "alice@example.test", "member")
            ]),
            "/organizations/me/access" | "/organizations/acme/access" => {
                json!({"org_id": org, "user_id": "alice", "role": "owner",
                    "can_manage_billing": true})
            }
            "/organizations/studio/access" => json!({"org_id": "studio", "user_id": "alice",
                "role": "member", "can_manage_billing": false}),
            "/billing/catalog" => json!({"schema_version": "1.1", "runtime": {"unit_seconds": 60},
                "plans": [
                    {"id": "free", "aliases": [], "name": "Free", "public": true,
                        "purchasable": false, "currency": "USD", "price_per_seat_cents": 0,
                        "seats": {"minimum": 1, "maximum": 1},
                        "runtime": {"fixed_units": 300, "units_per_seat": 0},
                        "per_seat_limits": {}, "fixed_limits": {"projects.max": 1,
                            "storage.max_bytes": 1_000_000_000u64, "history.retention_days": 30}},
                    plan("team_v2", "Team", 2000, 30, 10),
                    plan("enterprise_v2", "Enterprise", 4000, 365, 20)]}),
            "/billing/organizations/acme/summary" => json!({"org_id": "acme",
                "plan_id": "team_v2", "status": "active", "seat_quantity": 3,
                "current_period_end": "2026-12-19T00:00:00Z", "cancel_at_period_end": false,
                "portal_available": true, "seat_changes_available": true}),
            p if p.ends_with("/summary") => json!({"org_id": org, "plan_id": "free",
                "status": "free", "seat_quantity": 1}),
            p if p.ends_with("/usage") => json!({"runtime": {"org_id": org,
                "allowance": {"granted_units": 300, "consumed_units": 180,
                    "reserved_units": 12, "resets_at": "2026-12-01T00:00:00Z",
                    "unit_seconds": 60}},
                "storage": {"logical_bytes": 420_000_000u64, "limit_bytes": 1_000_000_000u64}}),
            p if p.ends_with("/operations") => json!([]),
            _ => json!([]),
        })
    })
}

impl Shell {
    pub fn lab_settings(&mut self, case: &str, cx: &mut Context<Self>) {
        use crate::features::settings::Page;
        let (space, page) = case.split_once('/').unwrap_or((case, "members"));
        let page = match page {
            "account" => Page::Account,
            "plan" => Page::Plan,
            "space" => Page::SpaceSettings,
            _ => Page::Space,
        };
        let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder());
        crate::features::cloud::account::install_fixture(broker, browser, cx);
        self.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.experimental.payments = true;
        });
        crate::features::cloud::global_spaces(cx)
            .update(cx, |spaces, cx| spaces.ensure(true, true, true, cx));
        self.open_modal(Modal::Task(Task::Settings), cx);
        let settings = self.dialogs.read(cx).settings.clone();
        let space = space.to_owned();
        // The page is chosen once the spaces are read, as a person would.
        cx.spawn(async move |_, cx| {
            for _ in 0..200 {
                let ready = cx.update(|cx| {
                    crate::features::cloud::global_spaces_read(cx)
                        .is_some_and(|s| s.spaces().len() == 3)
                });
                if ready {
                    break;
                }
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(10))
                    .await;
            }
            settings.update(cx, |s, cx| {
                s.lab_follow_account(cx);
                s.set_space_context(None, Some(space), None, cx);
                s.select_page(page, cx);
            });
        })
        .detach();
    }
}
