//! Uses the real Settings controller, broker, billing decoder and GPUI queue.
//! Server replies and the executor are controlled; no live payment is created.
use super::*;
use crate::workspace::cloud::billing::{self, Operation, Plan};
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
};

#[derive(Clone, Debug)]
struct Request {
    path: String,
    body: Option<Value>,
    key: Option<String>,
}
#[derive(Default)]
struct Server {
    requests: Vec<Request>,
    replies: HashMap<String, VecDeque<Result<Value, crate::cloud::auth::Error>>>,
    operations: Vec<Value>,
    before_reply: HashMap<String, Box<dyn FnOnce() + Send>>,
}
fn plan() -> Plan {
    serde_json::from_value(json!({"id":"team_v2","name":"Team","public":true,"purchasable":true,"currency":"USD","price_per_seat_cents":2000,"seats":{"minimum":1,"maximum":14}})).unwrap()
}
fn quote_value(mode: &str) -> Value {
    json!({"quote_id":"q1","org_id":"o1","target_plan_id":"team_v2","target_seats":2,"currency":"USD","target_amount_cents":4000,"application_mode":mode,"expires_at":"2099-01-01T00:00:00Z"})
}
fn operation_value(state: &str) -> Value {
    json!({"id":"operation-o1","org_id":"o1","kind":"checkout","state":state,"terminal":state=="succeeded","target_plan_id":"team_v2","target_seat_quantity":2,"quote_id":"q1"})
}
impl Server {
    fn answer(
        &mut self,
        r: &crate::cloud::auth::model::ApiRequest,
    ) -> Result<Value, crate::cloud::auth::Error> {
        self.requests.push(Request {
            path: r.path.clone(),
            body: r.body.clone(),
            key: r.idempotency_key.clone(),
        });
        if let Some(queue) = self.replies.get_mut(&r.path)
            && let Some(reply) = queue.pop_front()
        {
            return reply;
        }
        let p = r.path.as_str();
        if p == "/organizations/" {
            return Ok(
                json!([{"id":"o1","name":"Space","is_default":true,"can_create_projects":true,"role":"owner"}]),
            );
        }
        if p == "/billing/catalog" {
            return Ok(
                json!({"schema_version":"1.0","plans":[{"id":"team_v2","name":"Team","public":true,"purchasable":true,"currency":"USD","price_per_seat_cents":2000,"seats":{"minimum":1,"maximum":14}}],"runtime":{"unit_seconds":60}}),
            );
        }
        if p == "/organizations/o1/access" {
            return Ok(
                json!({"org_id":"o1","user_id":"alice","role":"owner","can_manage_billing":true}),
            );
        }
        if p.ends_with("/summary") {
            return Ok(
                json!({"org_id":"o1","plan_id":"team_v2","status":"active","seat_quantity":2,"source_revision":2,"seat_changes_available":true,"portal_available":true}),
            );
        }
        if p.ends_with("/usage") {
            return Ok(
                json!({"runtime":{"org_id":"o1","allowance":{"granted_units":2400,"consumed_units":1200,"reserved_units":0,"unit_seconds":60}},"storage":{"logical_bytes":0,"limit_bytes":1000000000,"threshold_percent":0}}),
            );
        }
        if p.ends_with("/operations") {
            return Ok(json!(self.operations));
        }
        if p.ends_with("/operations/operation-o1") {
            return Ok(operation_value("processing"));
        }
        if p.ends_with("/quote") {
            return Ok(quote_value("checkout"));
        }
        if p.ends_with("/checkout") {
            return Ok(
                json!({"checkout_url":"https://checkout.example/session","quote":quote_value("checkout"),"operation":operation_value("processing")}),
            );
        }
        if p.ends_with("/portal") {
            return Ok(json!({"portal_url":"https://portal.example/"}));
        }
        if p.ends_with("/plan/change") {
            let mut q = quote_value("plan_change");
            q["operation"] = operation_value("processing");
            return Ok(q);
        }
        if p.ends_with("/add-ons/storage_10gb") {
            return Ok(
                json!({"org_id":"o1","add_on_id":"storage_10gb","current_quantity":0,"target_quantity":1,"monthly_amount_cents":500,"currency":"USD","outcome":"checkout","checkout_url":"https://checkout.example/add-on","effective":"now"}),
            );
        }
        Err(crate::cloud::auth::Error::Unavailable)
    }
}
struct BillingFixture {
    f: Fixture,
    server: Arc<Mutex<Server>>,
}
impl BillingFixture {
    fn new() -> Self {
        Self::with_server(Arc::new(Mutex::new(Server::default())))
    }
    fn with_server(server: Arc<Mutex<Server>>) -> Self {
        let remote = server.clone();
        let f = Fixture::mount_responding(
            Content::Page,
            None,
            true,
            false,
            false,
            Some(Arc::new(move |r| {
                let (reply, before_reply) = {
                    let mut server = remote.lock().unwrap();
                    (server.answer(r), server.before_reply.remove(&r.path))
                };
                if let Some(before_reply) = before_reply {
                    before_reply();
                }
                reply
            })),
        );
        let mut h = Self { f, server };
        h.f.surface
            .update(&mut h.f.cx, |s, cx| s.load_plan(false, cx));
        h.wait(|s| !s.plan_page.snapshot.loading && s.plan_page.snapshot.summary.is_some());
        h.server.lock().unwrap().requests.clear();
        h
    }
    fn wait(&mut self, ready: impl Fn(&SettingsWorkspaceSurface) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            self.f.cx.run_until_parked();
            if self.f.surface.read_with(&self.f.cx, |s, _| ready(s)) {
                break;
            }
            assert!(Instant::now() < deadline, "billing did not settle");
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    fn enqueue(&self, suffix: &str, reply: Result<Value, crate::cloud::auth::Error>) {
        self.server
            .lock()
            .unwrap()
            .replies
            .entry(format!("/billing/organizations/o1/{suffix}"))
            .or_default()
            .push_back(reply);
    }
    fn requests(&self, suffix: &str) -> Vec<Request> {
        self.server
            .lock()
            .unwrap()
            .requests
            .iter()
            .filter(|r| r.path.ends_with(suffix))
            .cloned()
            .collect()
    }
    fn reopen(&mut self) {
        self.f.surface.update(&mut self.f.cx, |s, cx| {
            s.preferences
                .update(cx, |p, _| p.state.experimental.payments = false);
            s.load_plan(false, cx);
            s.preferences
                .update(cx, |p, _| p.state.experimental.payments = true);
            s.load_plan(false, cx);
        });
    }
    fn start_quote(&mut self) {
        self.f
            .surface
            .update(&mut self.f.cx, |s, cx| s.quote_plan(plan(), 2, cx));
    }
    fn finish_quote(&mut self) {
        self.start_quote();
        self.wait(|s| !s.plan_page.controller.acting);
        assert!(
            self.f
                .surface
                .read_with(&self.f.cx, |s, _| s.plan_page.controller.quote.is_some())
        );
    }
}
#[test]
fn reopening_the_same_scope_rejects_every_old_billing_action_reply() {
    for action in ["plan-quote", "seat-quote", "checkout", "portal", "add-on"] {
        let mut h = BillingFixture::new();
        h.f.surface.update(&mut h.f.cx, |s, cx| match action {
            "plan-quote" => s.quote_plan(plan(), 2, cx),
            "seat-quote" => s.quote_seats(cx),
            "checkout" => {
                s.plan_page.controller.quote =
                    Some(serde_json::from_value(quote_value("checkout")).unwrap());
                s.confirm_quote(cx);
            }
            "portal" => s.open_portal(cx),
            "add-on" => {
                s.draft_add_on("storage_10gb".into(), 1, 0, cx);
                s.confirm_add_on(cx);
            }
            _ => unreachable!(),
        });
        // The action is admitted before disable/re-enable; its future is still
        // queued. Draining afterward exercises the real completion callback.
        h.reopen();
        h.wait(|s| !s.plan_page.snapshot.loading);
        assert!(h.f.cx.opened_url().is_none(), "{action} opened a stale URL");
        h.f.surface.read_with(&h.f.cx, |s, _| {
            let c = &s.plan_page.controller;
            assert!(c.quote.is_none(), "{action} restored an old quote");
            assert!(c.polling.is_none(), "{action} started an old watch");
            assert!(c.error.is_none() && !c.acting && !c.add_on.pending);
            assert!(
                c.add_on.message.is_none(),
                "{action} delivered a stale notice"
            );
        });
    }
}
#[test]
fn an_ordinary_read_refresh_does_not_abandon_an_admitted_quote() {
    let mut h = BillingFixture::new();
    h.start_quote();
    h.f.surface
        .update(&mut h.f.cx, |s, cx| s.load_plan(true, cx));
    h.wait(|s| !s.plan_page.snapshot.loading && !s.plan_page.controller.acting);
    assert_eq!(
        h.f.surface.read_with(&h.f.cx, |s, _| s
            .plan_page
            .controller
            .quote
            .as_ref()
            .map(|q| q.quote_id.clone())),
        Some("q1".into())
    );
}
#[test]
fn old_quote_errors_cannot_replace_the_reopened_pages_error_state() {
    let mut h = BillingFixture::new();
    h.enqueue("plan/quote", Err(crate::cloud::auth::Error::Unavailable));
    h.start_quote();
    h.reopen();
    h.wait(|s| !s.plan_page.snapshot.loading);
    assert!(
        h.f.surface
            .read_with(&h.f.cx, |s, _| s.plan_page.controller.error.is_none())
    );
}
#[test]
fn quote_and_apply_retries_keep_their_key_but_reopening_rotates_it() {
    let mut h = BillingFixture::new();
    h.enqueue("plan/quote", Err(crate::cloud::auth::Error::Unavailable));
    h.start_quote();
    h.wait(|s| !s.plan_page.controller.acting);
    h.enqueue("plan/quote", Ok(quote_value("plan_change")));
    h.finish_quote();
    let quotes = h.requests("plan/quote");
    assert_eq!(quotes.len(), 2);
    assert_eq!(quotes[0].key, quotes[1].key);
    assert!(quotes[0].key.is_some());
    h.enqueue("plan/change", Err(crate::cloud::auth::Error::Unavailable));
    h.f.surface.update(&mut h.f.cx, |s, cx| s.confirm_quote(cx));
    h.wait(|s| !s.plan_page.controller.acting);
    h.f.surface.update(&mut h.f.cx, |s, cx| s.confirm_quote(cx));
    h.wait(|s| !s.plan_page.controller.acting);
    let apply = h.requests("plan/change");
    assert_eq!(apply.len(), 2);
    assert_eq!(apply[0].key, apply[1].key);
    h.reopen();
    h.wait(|s| !s.plan_page.snapshot.loading);
    h.finish_quote();
    let quotes = h.requests("plan/quote");
    assert_eq!(quotes.len(), 3);
    assert_ne!(quotes[0].key, quotes[2].key);
}
#[test]
fn expired_quotes_and_mismatched_checkouts_never_open_the_browser_or_start_polling() {
    for mismatch in [false, true] {
        let mut h = BillingFixture::new();
        h.finish_quote();
        if mismatch {
            let mut q = quote_value("checkout");
            q["quote_id"] = json!("another-quote");
            h.enqueue("checkout",Ok(json!({"checkout_url":"https://checkout.example/session","quote":q,"operation":operation_value("processing")})));
        } else {
            h.f.surface.update(&mut h.f.cx, |s, _| {
                s.plan_page.controller.quote.as_mut().unwrap().expires_at =
                    "2000-01-01T00:00:00Z".into()
            });
        }
        h.f.surface.update(&mut h.f.cx, |s, cx| s.confirm_quote(cx));
        h.wait(|s| !s.plan_page.controller.acting);
        assert_eq!(h.requests("checkout").len(), usize::from(mismatch));
        assert!(h.f.cx.opened_url().is_none());
        assert!(
            h.f.surface
                .read_with(&h.f.cx, |s, _| s.plan_page.controller.error.is_some()
                    && s.plan_page.controller.polling.is_none())
        );
    }
}
#[test]
fn a_membership_checkout_reuses_the_admitted_seat_operation() {
    let mut h = BillingFixture::new();
    h.f.surface.update(&mut h.f.cx, |s, cx| {
        let mut op: Operation = serde_json::from_value(operation_value("requires_action")).unwrap();
        op.kind = "member_activation".into();
        op.action_required = true;
        s.plan_page.controller.operations = vec![op];
        s.plan_page.controller.seats = 2;
        s.quote_seats(cx);
    });
    h.wait(|s| !s.plan_page.controller.acting);
    h.f.surface.update(&mut h.f.cx, |s, cx| s.confirm_quote(cx));
    h.wait(|s| !s.plan_page.controller.acting);
    let quotes = h.requests("seats/quote");
    let checkouts = h.requests("checkout");
    assert_eq!(quotes.len(), 1);
    assert_eq!(checkouts.len(), 1);
    assert_eq!(
        quotes[0].body.as_ref().unwrap()["operation_id"],
        "operation-o1"
    );
    assert_eq!(
        checkouts[0].body.as_ref().unwrap()["operation_id"],
        "operation-o1"
    );
    assert_eq!(
        h.f.cx.opened_url().as_deref(),
        Some("https://checkout.example/session")
    );
}

impl BillingFixture {
    fn advance(&mut self, seconds: u64) {
        self.f
            .cx
            .executor()
            .advance_clock(Duration::from_secs(seconds));
        self.f.cx.run_until_parked();
    }
    fn checkout(&mut self) {
        self.finish_quote();
        self.f
            .surface
            .update(&mut self.f.cx, |s, cx| s.confirm_quote(cx));
        self.wait(|s| !s.plan_page.controller.acting);
        assert!(
            self.f
                .surface
                .read_with(&self.f.cx, |s, _| s.plan_page.controller.polling.is_some())
        );
    }
}
#[test]
fn a_slow_checkout_keeps_watching_until_the_durable_operation_ends() {
    let mut h = BillingFixture::new();
    h.checkout();
    assert!(h.requests("operations/operation-o1").is_empty());
    for delay in [2, 4, 8, 15, 30, 30] {
        h.advance(delay);
    }
    assert_eq!(h.requests("operations/operation-o1").len(), 6);
    h.f.surface.read_with(&h.f.cx, |s, _| {
        assert!(s.plan_page.controller.polling.is_some());
        assert!(s.plan_page.controller.error.is_none());
    });
    h.enqueue("operations/operation-o1", Ok(operation_value("succeeded")));
    h.advance(30);
    h.wait(|s| !s.plan_page.snapshot.loading);
    assert!(
        h.f.surface
            .read_with(&h.f.cx, |s, _| s.plan_page.controller.polling.is_none())
    );
    let requests = h.requests("operations/operation-o1").len();
    h.advance(120);
    assert_eq!(h.requests("operations/operation-o1").len(), requests);
}
#[test]
fn native_window_activation_refreshes_the_watch_without_waiting_for_backoff() {
    let mut h = BillingFixture::new();
    h.checkout();
    h.f.cx.deactivate_window();
    h.f.cx.run_until_parked();
    assert!(h.requests("operations/operation-o1").is_empty());
    h.f.cx.update(|w, _| w.activate_window());
    h.f.cx.run_until_parked();
    assert_eq!(h.requests("operations/operation-o1").len(), 1);
}
#[test]
fn resetting_the_scope_cancels_the_sleeping_watch_before_it_sends_a_request() {
    let mut h = BillingFixture::new();
    h.checkout();
    h.reopen();
    h.wait(|s| !s.plan_page.snapshot.loading);
    h.advance(120);
    assert!(h.requests("operations/operation-o1").is_empty());
}
#[test]
fn an_operations_refresh_preserves_the_supplied_reading_and_refreshes_it_even_on_failure() {
    let mut h = BillingFixture::new();
    h.server.lock().unwrap().operations = vec![operation_value("processing")];
    h.f.surface
        .update(&mut h.f.cx, |s, cx| s.load_operations(cx));
    h.f.cx.run_until_parked();
    assert!(h.requests("summary").is_empty());
    assert!(h.requests("usage").is_empty());
    assert!(h.requests("catalog").is_empty());
    assert_eq!(h.requests("operations").len(), 1);
    assert!(
        h.f.surface
            .read_with(&h.f.cx, |s, _| s.plan_page.controller.polling.is_some())
    );
    h.enqueue("operations", Err(crate::cloud::auth::Error::Unavailable));
    h.f.surface.update(&mut h.f.cx, |s, cx| s.refresh_plan(cx));
    h.wait(|s| !s.plan_page.snapshot.loading);
    assert_eq!(h.requests("summary").len(), 1);
    assert_eq!(h.requests("usage").len(), 1);
    assert_eq!(h.requests("catalog").len(), 1);
    assert_eq!(h.requests("operations").len(), 2);
}
#[test]
fn a_reopened_controller_stops_foreign_responses_until_explicit_refresh() {
    let mut h = BillingFixture::new();
    h.server.lock().unwrap().operations = vec![operation_value("processing")];
    h.reopen();
    h.wait(|s| !s.plan_page.snapshot.loading);
    assert!(
        h.f.surface
            .read_with(&h.f.cx, |s, _| s.plan_page.controller.polling.is_some())
    );
    let mut foreign = operation_value("processing");
    foreign["id"] = json!("another-operation");
    h.enqueue("operations/operation-o1", Ok(foreign));
    h.advance(2);
    h.f.surface.read_with(&h.f.cx, |s, _| {
        assert!(s.plan_page.controller.polling.is_none());
        assert_eq!(s.plan_page.controller.error, Some(billing::MISMATCH));
    });
    assert_eq!(h.requests("operations/operation-o1").len(), 1);
    h.advance(120);
    assert_eq!(h.requests("operations/operation-o1").len(), 1);
    h.f.surface.update(&mut h.f.cx, |s, cx| s.refresh_plan(cx));
    h.wait(|s| !s.plan_page.snapshot.loading);
    h.advance(2);
    assert_eq!(h.requests("operations/operation-o1").len(), 2);
}
#[test]
fn a_lagging_operation_or_list_cannot_reopen_a_terminal_operation() {
    let mut h = BillingFixture::new();
    h.checkout();
    h.server.lock().unwrap().operations = vec![operation_value("succeeded")];
    h.f.surface
        .update(&mut h.f.cx, |s, cx| s.load_operations(cx));
    h.f.cx.run_until_parked();
    assert!(h.f.surface.read_with(&h.f.cx, |s, _| {
        s.plan_page.controller.operations[0].terminal
    }));
    // The individual endpoint still reports processing, after the list has
    // already observed the durable terminal state.
    h.advance(2);
    h.f.surface.read_with(&h.f.cx, |s, _| {
        assert!(s.plan_page.controller.operations[0].terminal);
        assert!(s.plan_page.controller.polling.is_none());
    });
    h.server.lock().unwrap().operations = vec![operation_value("processing")];
    h.f.surface
        .update(&mut h.f.cx, |s, cx| s.load_operations(cx));
    h.f.cx.run_until_parked();
    h.f.surface.read_with(&h.f.cx, |s, _| {
        assert!(s.plan_page.controller.operations[0].terminal);
        assert!(s.plan_page.controller.polling.is_none());
    });
}

#[test]
fn a_pending_operation_request_stays_single_flight_across_timer_and_focus_wakes() {
    let mut h = BillingFixture::new();
    h.checkout();
    let executor = h.f.cx.executor();
    let server = h.server.clone();
    let wake = h.f.surface.read_with(&h.f.cx, |s, _| {
        s.plan_page.controller.poll_wake.clone().unwrap()
    });
    h.server.lock().unwrap().before_reply.insert(
        "/billing/organizations/o1/operations/operation-o1".into(),
        Box::new(move || {
            // The real operation request has entered the broker but has not
            // returned. Advance the scheduler while its reply is withheld.
            wake.try_send(()).unwrap();
            executor.advance_clock(Duration::from_secs(60));
            assert_eq!(
                server
                    .lock()
                    .unwrap()
                    .requests
                    .iter()
                    .filter(|r| r.path.ends_with("operations/operation-o1"))
                    .count(),
                1
            );
        }),
    );
    h.advance(2);
    // A queued activation may immediately refresh after the first request
    // settles, but can never overlap it.
    assert_eq!(h.requests("operations/operation-o1").len(), 2);
    h.advance(8);
    assert_eq!(h.requests("operations/operation-o1").len(), 3);
}
#[test]
fn replacing_the_account_discards_pending_reads_quotes_and_checkout_effects() {
    for action in ["read", "quote", "checkout"] {
        let mut h = BillingFixture::new();
        let broker = h.f.cx.update(|_, cx| {
            crate::features::cloud::account::broker_and_binding(cx)
                .unwrap()
                .0
        });
        if action == "checkout" {
            h.finish_quote();
        }
        h.f.surface.update(&mut h.f.cx, |s, cx| match action {
            "read" => s.load_plan(true, cx),
            "quote" => s.quote_plan(plan(), 2, cx),
            "checkout" => s.confirm_quote(cx),
            _ => unreachable!(),
        });
        let suffix = match action {
            "read" => "summary",
            "quote" => "plan/quote",
            "checkout" => "checkout",
            _ => unreachable!(),
        };
        if action == "read" {
            h.enqueue("summary", Ok(json!({"org_id":"o1","plan_id":"team_v2","status":"active","seat_quantity":99,"source_revision":99})));
        }
        h.server.lock().unwrap().before_reply.insert(
            format!("/billing/organizations/o1/{suffix}"),
            Box::new(move || crate::cloud::auth::relogin(&broker, "bob")),
        );
        h.f.cx.run_until_parked();
        h.wait(|s| !s.plan_page.snapshot.loading);
        assert!(h.f.cx.opened_url().is_none());
        h.f.surface.read_with(&h.f.cx, |s, cx| {
            let binding = crate::features::cloud::account::broker_and_binding(cx)
                .unwrap()
                .1;
            assert_eq!(binding.user, "bob");
            let summary = s.plan_page.snapshot.summary.as_ref().unwrap();
            assert_eq!(summary.source_revision, Some(2));
            assert_eq!(summary.seat_quantity, 2);
            assert_eq!(
                s.plan_page.context.as_ref().unwrap().0,
                crate::features::cloud::billing_namespace(&binding)
            );
            assert!(s.plan_page.controller.quote.is_none());
            assert!(s.plan_page.controller.polling.is_none());
            assert!(!s.plan_page.controller.acting);
            assert!(s.plan_page.controller.error.is_none());
        });
    }
}
#[test]
fn changing_api_host_revokes_the_old_page_and_cancels_its_watch() {
    let mut h = BillingFixture::new();
    h.checkout();
    let broker = h.f.cx.update(|_, cx| {
        crate::features::cloud::account::broker_and_binding(cx)
            .unwrap()
            .0
    });
    broker.set_environment(
        crate::cloud::auth::Environment::new(
            "http://127.0.0.1:28080/api/v1",
            "http://127.0.0.1:23000",
        )
        .unwrap(),
    );
    h.wait(|s| s.plan_page.context.is_none());
    h.advance(120);
    assert!(h.requests("operations/operation-o1").is_empty());
    h.f.surface.read_with(&h.f.cx, |s, _| {
        assert!(s.plan_page.snapshot.summary.is_none());
        assert!(s.plan_page.controller.quote.is_none());
        assert!(s.plan_page.controller.polling.is_none());
    });
}
#[test]
fn disposing_the_native_page_does_not_retain_or_deliver_an_abandoned_checkout() {
    let mut h = BillingFixture::new();
    h.finish_quote();
    h.f.surface.update(&mut h.f.cx, |s, cx| s.confirm_quote(cx));
    let weak = h.f.surface.downgrade();
    let app = h.f.cx.cx.clone();
    h.f.cx.update(|w, _| w.remove_window());
    drop(h);
    app.run_until_parked();
    assert!(weak.upgrade().is_none());
    assert!(app.opened_url().is_none());
}

#[test]
fn a_new_native_page_resumes_the_persisted_operation_without_submitting_it_again() {
    let mut first = BillingFixture::new();
    first.checkout();
    let server = first.server.clone();
    server.lock().unwrap().operations = vec![operation_value("processing")];
    drop(first);
    let mut remounted = BillingFixture::with_server(server);
    assert!(remounted.f.surface.read_with(&remounted.f.cx, |s, _| {
        s.plan_page.controller.polling.is_some()
    }));
    remounted.enqueue("operations/operation-o1", Ok(operation_value("succeeded")));
    remounted.advance(2);
    remounted.wait(|s| !s.plan_page.snapshot.loading);
    assert!(remounted.f.surface.read_with(&remounted.f.cx, |s, _| {
        s.plan_page.controller.polling.is_none()
    }));
    assert_eq!(remounted.requests("operations/operation-o1").len(), 1);
    assert!(remounted.requests("checkout").is_empty());
    assert!(remounted.requests("plan/quote").is_empty());
}
