//! `managedConnection.test.mjs`: the wallet against a scripted gateway whose
//! answers a test can hold back, fail or let through.
use super::{
    test_support::{calls, hold, refresh, session, session_calls, wallet, world},
    wallet::UsageStatus,
    *,
};
use core::prelude::v1::test;

#[test]
fn the_wallet_reads_like_the_product() {
    let catalog = parse_catalog(&serde_json::json!({
        "models": [{"id": "m1", "name": "Model", "context_window": 128000}],
        "packs": [{"id": "p5", "price_cents": 500}],
        "trial_credit_micro_usd": 2000000,
    }))
    .unwrap();
    assert_eq!(catalog.packs[0].price_cents, 500);
    assert!(parse_catalog(&serde_json::json!({"models": [], "packs": []})).is_none());
    let balance = parse_balance(&serde_json::json!({
        "balance_micro_usd": 1_500_000, "reserved_micro_usd": 0, "available_micro_usd": 1_500_000
    }))
    .unwrap();
    assert_eq!(money(balance.available_micro_usd), "$1.50");
    assert_eq!(money(4_000), "$0.0040");
    assert_eq!(money(0), "$0.00");
    assert!(parse_balance(&serde_json::json!({"balance_micro_usd": 1})).is_none());
    assert!(checkout_url("https://polar.sh/checkout/abc", false).is_some());
    assert!(checkout_url("https://sandbox.polar.sh/c", true).is_some());
    assert!(checkout_url("https://sandbox.polar.sh/c", false).is_none());
    assert!(checkout_url("http://polar.sh/c", false).is_none());
    assert!(checkout_url("https://evil.example/c", false).is_none());
    assert!(checkout_url("https://user:pw@polar.sh/c", false).is_none());
}

/// #5 `maps browser handoff failures to a safe sign-in error`.
#[gpui::test]
fn a_browser_handoff_that_cannot_start_is_a_sign_in_error(cx: &mut TestAppContext) {
    let world = world(false);
    let compute = wallet(&world, cx);
    world.lock().unwrap().sign_in_starts = false;
    compute.update(cx, |c, cx| c.sign_in(cx));
    compute.read_with(cx, |c, _| {
        assert!(c.sign_in_failed);
        assert_eq!(c.reason(), Reason::SignInRequired);
        assert_eq!(c.error_code(), None, "not a billing error");
    });
    world.lock().unwrap().sign_in_starts = true;
    compute.update(cx, |c, cx| c.sign_in(cx));
    compute.read_with(cx, |c, _| assert!(!c.sign_in_failed));
}

/// #6 `reports loading through sign-in and retries, and failure only after
/// a request fails`.
#[gpui::test]
fn loading_lasts_through_sign_in_and_retries_until_a_request_fails(cx: &mut TestAppContext) {
    let world = world(false);
    let compute = wallet(&world, cx);
    refresh(&compute, false, cx);
    assert_eq!(
        compute.read_with(cx, |c, _| c.reason()),
        Reason::SignInRequired
    );
    let balance = hold(&world, "/ai/balance");
    world.lock().unwrap().session = Some(session("user-one"));
    refresh(&compute, false, cx);
    compute.read_with(cx, |c, _| {
        assert!(c.signed_in());
        assert_eq!((c.reason(), c.error_code()), (Reason::Loading, None));
    });
    balance.try_send(Err(Failed)).unwrap();
    cx.run_until_parked();
    compute.read_with(cx, |c, _| {
        assert_eq!(
            (c.reason(), c.error_code()),
            (
                Reason::GatewayUnavailable,
                Some(ErrorCode::GatewayUnavailable)
            )
        )
    });
    let balance = hold(&world, "/ai/balance");
    refresh(&compute, true, cx);
    compute.read_with(cx, |c, _| {
        assert_eq!((c.reason(), c.error_code()), (Reason::Loading, None))
    });
    balance
        .try_send(Ok(serde_json::json!({
            "balance_micro_usd": 1_000_000, "available_micro_usd": 1_000_000, "reserved_micro_usd": 0
        })))
        .unwrap();
    cx.run_until_parked();
    compute.read_with(cx, |c, _| {
        assert_eq!((c.reason(), c.error_code()), (Reason::Ready, None))
    });
}

/// #7 `leaves loading when the public request fails synchronously`.
#[gpui::test]
fn a_directory_read_that_fails_at_once_is_unavailable_until_a_retry(cx: &mut TestAppContext) {
    let world = world(true);
    let compute = wallet(&world, cx);
    hold(&world, "/ai/catalog").close();
    refresh(&compute, false, cx);
    assert_eq!(
        compute.read_with(cx, |c, _| c.reason()),
        Reason::GatewayUnavailable
    );
    refresh(&compute, true, cx);
    assert_eq!(compute.read_with(cx, |c, _| c.reason()), Reason::Ready);
}

/// #8 `reads directory and wallet concurrently, then reuses the directory
/// for balance refreshes`.
#[gpui::test]
fn the_directory_and_wallet_are_read_at_once_and_the_directory_reused(cx: &mut TestAppContext) {
    let world = world(true);
    let compute = wallet(&world, cx);
    let directory = hold(&world, "/ai/catalog");
    refresh(&compute, false, cx);
    assert_eq!(
        calls(&world),
        ["public /ai/catalog", "GET /ai/balance"],
        "the wallet is asked while the directory is still out"
    );
    let catalog = world.lock().unwrap().reply("/ai/catalog");
    directory.try_send(catalog).unwrap();
    cx.run_until_parked();
    assert_eq!(compute.read_with(cx, |c, _| c.reason()), Reason::Ready);
    refresh(&compute, true, cx);
    assert_eq!(
        calls(&world),
        ["public /ai/catalog", "GET /ai/balance", "GET /ai/balance"]
    );
}

/// #9 `ends a stuck request at the deadline, allows retry, and ignores its
/// late response`.
#[gpui::test]
fn a_stuck_refresh_ends_at_its_deadline_and_its_late_answer_is_dropped(cx: &mut TestAppContext) {
    let world = world(true);
    let compute = wallet(&world, cx);
    let stuck = hold(&world, "/ai/balance");
    refresh(&compute, false, cx);
    cx.executor().advance_clock(DEADLINE);
    cx.run_until_parked();
    compute.read_with(cx, |c, _| {
        assert_eq!(
            (c.reason(), c.error_code()),
            (Reason::GatewayUnavailable, Some(ErrorCode::Timeout))
        )
    });
    refresh(&compute, true, cx);
    compute.read_with(cx, |c, _| {
        assert_eq!(c.reason(), Reason::Ready);
        assert_eq!(c.balance.unwrap().available_micro_usd, 5_000_000);
    });
    let _ = stuck.try_send(Ok(serde_json::json!({
        "balance_micro_usd": 0, "available_micro_usd": 0, "reserved_micro_usd": 0
    })));
    cx.run_until_parked();
    assert_eq!(
        compute.read_with(cx, |c, _| c.balance.unwrap().available_micro_usd),
        5_000_000
    );
}

/// #10 `reloads the public directory after its short cache expires`.
#[gpui::test]
fn the_directory_is_read_again_after_a_minute(cx: &mut TestAppContext) {
    let world = world(true);
    let compute = wallet(&world, cx);
    refresh(&compute, false, cx);
    compute.update(cx, |c, _| c.age(Duration::from_millis(60_001)));
    refresh(&compute, true, cx);
    assert_eq!(compute.read_with(cx, |c, _| c.reason()), Reason::Ready);
    let directory = calls(&world)
        .iter()
        .filter(|c| *c == "public /ai/catalog")
        .count();
    assert_eq!(directory, 2);
}

/// #11 `rejects an empty model directory instead of leaving a funded
/// account connecting forever`.
#[gpui::test]
fn an_empty_directory_leaves_no_funded_account_waiting(cx: &mut TestAppContext) {
    let world = world(true);
    world.lock().unwrap().catalog = Some(serde_json::json!({"models": [], "packs": []}));
    let compute = wallet(&world, cx);
    refresh(&compute, false, cx);
    assert_eq!(
        compute.read_with(cx, |c, _| c.reason()),
        Reason::GatewayUnavailable
    );
}

/// #20 `opens a server-created sandbox checkout without exposing
/// credentials to the renderer`.
#[gpui::test]
fn a_checkout_opens_only_at_the_payment_provider(cx: &mut TestAppContext) {
    let world = world(true);
    let compute = wallet(&world, cx);
    refresh(&compute, false, cx);
    compute.update(cx, |c, cx| c.checkout("test-credit".into(), cx));
    cx.run_until_parked();
    assert_eq!(
        world.lock().unwrap().opened,
        ["https://sandbox.polar.sh/checkout/test"]
    );
    assert!(!compute.read_with(cx, |c, _| c.checkout_failed));
    world.lock().unwrap().checkout_url = "https://attacker.example/checkout".into();
    compute.update(cx, |c, cx| c.checkout("test-credit".into(), cx));
    cx.run_until_parked();
    assert_eq!(world.lock().unwrap().opened.len(), 1, "never opened");
    compute.read_with(cx, |c, _| assert!(c.checkout_failed && c.failed()));
}

/// #21 `refreshes the new account immediately when sign-in finishes during
/// a catalog request`.
#[gpui::test]
fn signing_in_during_a_directory_read_reads_the_new_account_at_once(cx: &mut TestAppContext) {
    let world = world(false);
    world.lock().unwrap().trial = 1_000_000;
    let compute = wallet(&world, cx);
    let directory = hold(&world, "/ai/catalog");
    refresh(&compute, false, cx);
    world.lock().unwrap().session = Some(session("user-one"));
    refresh(&compute, false, cx);
    directory
        .try_send(Ok(serde_json::json!({
            "models": [], "packs": [], "trial_credit_micro_usd": 1_000_000
        })))
        .unwrap();
    cx.run_until_parked();
    compute.read_with(cx, |c, _| {
        assert_eq!(c.reason(), Reason::Ready);
        assert_eq!(c.trial_credit_micro_usd(), 1_000_000);
    });
    let claims = calls(&world)
        .iter()
        .filter(|c| *c == "POST /ai/trial")
        .count();
    assert_eq!(claims, 1);
}

/// #22 `claims only after sign-in and uses the claim response without
/// reading the same balance twice`.
#[gpui::test]
fn the_trial_is_claimed_once_after_sign_in_from_its_own_answer(cx: &mut TestAppContext) {
    let signed_out = world(false);
    signed_out.lock().unwrap().trial = 1_000_000;
    let compute = wallet(&signed_out, cx);
    refresh(&compute, false, cx);
    assert!(session_calls(&signed_out).is_empty());
    assert_eq!(
        compute.read_with(cx, |c, _| c.trial_credit_micro_usd()),
        1_000_000
    );

    let world = world(true);
    world.lock().unwrap().trial = 1_000_000;
    let compute = wallet(&world, cx);
    refresh(&compute, false, cx);
    refresh(&compute, true, cx);
    assert_eq!(
        session_calls(&world),
        ["GET /ai/balance", "POST /ai/trial", "GET /ai/balance"]
    );
    assert_eq!(
        compute.read_with(cx, |c, _| c.balance.unwrap().trial_granted_micro_usd),
        1_000_000
    );
}

/// #23 `does not claim again for an account whose server wallet already has
/// a trial grant`.
#[gpui::test]
fn an_account_that_has_its_grant_is_not_claimed_again(cx: &mut TestAppContext) {
    let world = world(true);
    {
        let mut world = world.lock().unwrap();
        world.trial = 1_000_000;
        world.trial_granted = 1_000_000;
    }
    let compute = wallet(&world, cx);
    refresh(&compute, false, cx);
    assert_eq!(compute.read_with(cx, |c, _| c.reason()), Reason::Ready);
    assert_eq!(session_calls(&world), ["GET /ai/balance"]);
}

const RESERVATION: &str = "00000000-0000-4000-8000-000000000001";

/// #24 `keeps a usable wallet ready while its previous usage receipt is
/// still loading`.
#[gpui::test]
fn a_receipt_still_loading_never_holds_the_wallet(cx: &mut TestAppContext) {
    let world = world(true);
    // Reservations are noted process-wide: an account of its own.
    world.lock().unwrap().session = Some(session("receipt-loading"));
    let compute = wallet(&world, cx);
    refresh(&compute, false, cx);
    let key = world.lock().unwrap().session.clone().unwrap().key;
    crate::cloud::auth::reservation::note_for(&key, RESERVATION, "test/model");
    let receipt = hold(&world, &format!("/ai/usage/{RESERVATION}"));
    refresh(&compute, true, cx);
    compute.read_with(cx, |c, _| {
        assert_eq!(c.reason(), Reason::Ready);
        assert_eq!(c.last_usage.as_ref().unwrap().status, UsageStatus::Pending);
    });
    assert!(calls(&world).contains(&format!("GET /ai/usage/{RESERVATION}")));
    receipt
        .try_send(Ok(serde_json::json!({
            "reservation_id": RESERVATION, "status": "running", "model_id": "test/model"
        })))
        .unwrap();
    cx.run_until_parked();
    assert_eq!(compute.read_with(cx, |c, _| c.reason()), Reason::Ready);
}

/// #25 and #26 `reads the settled charge after streaming and clears it on
/// signOut / replaceUser`.
#[gpui::test]
fn the_settled_charge_is_read_after_a_call_and_cleared_with_its_account(cx: &mut TestAppContext) {
    for replace in [false, true] {
        let world = world(true);
        world.lock().unwrap().session = Some(session(&format!("receipt-settled-{replace}")));
        world.lock().unwrap().usage = Some(serde_json::json!({
            "reservation_id": RESERVATION, "status": "settled", "model_id": "test/model",
            "price_book_id": "prices-1", "charged_micro_usd": 47,
            "provider_cost_usd": "PRIVATE-COST", "provider_route": {"private": true},
            "usage": {"input_tokens": 10, "cached_tokens": 4, "output_tokens": 20},
        }));
        let compute = wallet(&world, cx);
        refresh(&compute, false, cx);
        let key = world.lock().unwrap().session.clone().unwrap().key;
        crate::cloud::auth::reservation::note_for(&key, RESERVATION, "test/model");
        refresh(&compute, true, cx);
        let usage = compute.read_with(cx, |c, _| c.last_usage.clone()).unwrap();
        assert_eq!(
            usage,
            Usage {
                reservation_id: RESERVATION.into(),
                model_id: "test/model".into(),
                status: UsageStatus::Settled,
                charged_micro_usd: Some(47),
                price_book_id: Some("prices-1".into()),
                input_tokens: Some(10),
                cached_tokens: Some(4),
                output_tokens: Some(20),
            }
        );
        assert!(!format!("{usage:?}").contains("PRIVATE-COST"));
        world.lock().unwrap().session = replace.then(|| session("user-two"));
        refresh(&compute, false, cx);
        assert_eq!(
            compute.read_with(cx, |c, _| c.last_usage.clone()),
            None,
            "{replace}"
        );
    }
}

/// #27 `does not turn missing usage or a mismatched receipt into a charge`.
#[test]
fn missing_usage_or_a_mismatched_receipt_is_no_charge() {
    assert_eq!(
        parse_usage(&serde_json::json!({"reservation_id": "wrong"}), "expected"),
        None
    );
    assert_eq!(
        parse_usage(
            &serde_json::json!({
                "reservation_id": "id", "status": "settled", "model_id": "model",
                "charged_micro_usd": 1
            }),
            "id"
        ),
        None
    );
    let running = parse_usage(
        &serde_json::json!({
            "reservation_id": "id", "status": "running", "model_id": "model",
            "charged_micro_usd": 0
        }),
        "id",
    )
    .unwrap();
    assert_eq!(
        (running.status, running.charged_micro_usd),
        (UsageStatus::Pending, None)
    );
}
