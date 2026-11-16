//! Frozen TS planSubscription component acceptance through actual GPUI
//! rendering and pointer dispatch, without a browser or live billing service.
use super::*;
use crate::features::settings::{Page, PreferencesStore};
use crate::test_support::RecordingText;
use crate::workspace::cloud::{
    billing::{Summary, Usage},
    pricing::PlanHolding,
};
use core::prelude::v1::test;
use gpui_kit::test::{TestQueryExt, TestWindowExt};
use serde_json::{Value, json};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Clone)]
enum Content {
    Page,
    Current(PlanHolding),
    Scheduled(PlanHolding, std::rc::Rc<std::cell::Cell<u32>>),
}
struct PageHarness {
    surface: Entity<SettingsWorkspaceSurface>,
    content: Content,
}
impl Render for PageHarness {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        use crate::ui::appearance::ActiveAppearance;
        let content = self.content.clone();
        div()
            .w_full()
            .h_full()
            .child(self.surface.update(cx, |s, cx| {
                let t = cx.palette();
                match content {
                    Content::Page => s.plan(t, cx),
                    Content::Current(ref holding) | Content::Scheduled(ref holding, _) => {
                        let catalog = pricing::resolve_catalog(None);
                        let plan = catalog
                            .plans
                            .iter()
                            .find(|p| p.id.key() == holding.plan_id)
                            .unwrap();
                        let scheduled_action = if let Content::Scheduled(_, ref calls) = content {
                            let calls = calls.clone();
                            Some(
                                Button::new("keep-plan-fixture")
                                    .label("Keep current plan")
                                    .on_click(move |_, _, _| calls.set(calls.get() + 1))
                                    .into_any_element(),
                            )
                        } else {
                            None
                        };
                        s.current_plan(
                            plan,
                            holding,
                            false,
                            &catalog.add_ons,
                            None,
                            scheduled_action,
                            t,
                        )
                    }
                }
            }))
    }
}
struct Fixture {
    cx: VisualTestContext,
    surface: Entity<SettingsWorkspaceSurface>,
    text: Arc<RecordingText>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.cx.cx.quit();
    }
}
impl Fixture {
    fn mount(
        content: Content,
        usage: Option<Usage>,
        signed_in: bool,
        error: bool,
        restoring: bool,
    ) -> Self {
        Self::mount_responding(content, usage, signed_in, error, restoring, None)
    }
    fn mount_responding(
        content: Content,
        usage: Option<Usage>,
        signed_in: bool,
        error: bool,
        restoring: bool,
        responder: Option<crate::cloud::auth::Responder>,
    ) -> Self {
        let text = Arc::new(RecordingText::default());
        let mut app =
            TestAppContext::build_with_text_system(TestDispatcher::new(0), None, text.clone());
        app.executor().allow_parking();
        crate::localization::set_current("en");
        let (broker, browser) = if signed_in {
            crate::cloud::auth::responding_account_fixture(responder.unwrap_or_else(||Arc::new(|request| {
                if request.path.ends_with("/organizations/") {
                    Ok(
                        json!([{"id":"o1","name":"Space","is_default":true,"can_create_projects":true,"role":"owner"}]),
                    )
                } else {
                    Err(crate::cloud::auth::Error::Unavailable)
                }
            })))
        } else {
            let (broker, browser, _control) = crate::cloud::auth::sign_in_fixture();
            (broker, browser)
        };
        let account = app.update(|cx| {
            gpui_kit::init(cx);
            crate::features::cloud::account::install_fixture(broker, browser, cx)
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            app.run_until_parked();
            let ready = app.update(|cx| {
                crate::features::cloud::account::status(cx)
                    == Some(if signed_in {
                        crate::cloud::auth::Status::Authenticated
                    } else {
                        crate::cloud::auth::Status::SignedOut
                    })
            });
            if ready {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "fixture authentication did not settle"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
        if signed_in {
            let spaces = app.update(crate::features::cloud::global_spaces);
            spaces.update(&mut app, |s, cx| s.ensure(true, true, false, cx));
            loop {
                app.run_until_parked();
                if spaces.read_with(&app, |s, _| s.spaces().len()) == 1 {
                    break;
                }
                assert!(Instant::now() < deadline, "fixture space did not settle");
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        if restoring {
            account.update(&mut app, |a, _| {
                a.snapshot.as_mut().unwrap().status = crate::cloud::auth::Status::Restoring
            });
        }
        let (window, surface) = app.update(|cx| {
            let mut surface = None;
            let window = cx
                .open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(Bounds {
                            origin: Point::default(),
                            size: size(px(1200.), px(1800.)),
                        })),
                        ..Default::default()
                    },
                    |w, cx| {
                        let prefs = cx.new(|_| {
                            let mut p = PreferencesStore::memory();
                            p.state.experimental.payments = true;
                            p.state.experimental.cloud_workspace = true;
                            p
                        });
                        let s = cx.new(|cx| {
                            let mut s = SettingsWorkspaceSurface::new(prefs, w, cx);
                            s.page = Page::Plan;
                            s.plan_page.snapshot.usage = usage;
                            s.plan_page.snapshot.error = error;
                            s.plan_page.snapshot.loading = false;
                            s
                        });
                        surface = Some(s.clone());
                        let view = cx.new(|cx| {
                            cx.observe(&s, |_, _, cx| cx.notify()).detach();
                            PageHarness {
                                surface: s,
                                content,
                            }
                        });
                        cx.new(|cx| gpui_kit::base::Root::new(view, w, cx))
                    },
                )
                .unwrap();
            (window, surface.unwrap())
        });
        let mut f = Self {
            cx: VisualTestContext::from_window(window.into(), &app),
            surface,
            text,
        };
        f.draw();
        f
    }
    fn draw(&mut self) {
        self.cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
    }
    fn strings(&self) -> Vec<String> {
        self.text.0.lock().unwrap().clone()
    }
    fn contains(&self, expected: &str) {
        let actual = self.strings();
        assert!(
            actual.iter().any(|s| s == expected),
            "missing {expected:?}: {actual:?}"
        );
    }
    fn excludes(&self, forbidden: &str) {
        assert!(
            !self.strings().iter().any(|s| s.contains(forbidden)),
            "unexpected {forbidden}"
        );
    }
    fn buttons(&mut self) -> Vec<String> {
        self.cx.update(|w, _| {
            w.find_all_by_role(Role::Button)
                .iter()
                .filter_map(|n| n.label().map(str::to_owned))
                .collect()
        })
    }
    fn ticks(&mut self, expected_active: usize) {
        const NORMAL: [&str; 25] = [
            "plan-meter-tick-0",
            "plan-meter-tick-1",
            "plan-meter-tick-2",
            "plan-meter-tick-3",
            "plan-meter-tick-4",
            "plan-meter-tick-5",
            "plan-meter-tick-6",
            "plan-meter-tick-7",
            "plan-meter-tick-8",
            "plan-meter-tick-9",
            "plan-meter-tick-10",
            "plan-meter-tick-11",
            "plan-meter-tick-12",
            "plan-meter-tick-13",
            "plan-meter-tick-14",
            "plan-meter-tick-15",
            "plan-meter-tick-16",
            "plan-meter-tick-17",
            "plan-meter-tick-18",
            "plan-meter-tick-19",
            "plan-meter-tick-20",
            "plan-meter-tick-21",
            "plan-meter-tick-22",
            "plan-meter-tick-23",
            "plan-meter-tick-24",
        ];
        const ACTIVE: [&str; 25] = [
            "plan-meter-active-0",
            "plan-meter-active-1",
            "plan-meter-active-2",
            "plan-meter-active-3",
            "plan-meter-active-4",
            "plan-meter-active-5",
            "plan-meter-active-6",
            "plan-meter-active-7",
            "plan-meter-active-8",
            "plan-meter-active-9",
            "plan-meter-active-10",
            "plan-meter-active-11",
            "plan-meter-active-12",
            "plan-meter-active-13",
            "plan-meter-active-14",
            "plan-meter-active-15",
            "plan-meter-active-16",
            "plan-meter-active-17",
            "plan-meter-active-18",
            "plan-meter-active-19",
            "plan-meter-active-20",
            "plan-meter-active-21",
            "plan-meter-active-22",
            "plan-meter-active-23",
            "plan-meter-active-24",
        ];
        assert!(self.cx.debug_bounds("plan-hours-meter").is_some());
        for i in 0..25 {
            let active = self.cx.debug_bounds(ACTIVE[i]);
            let plain = self.cx.debug_bounds(NORMAL[i]);
            assert_eq!(active.is_some(), i < expected_active, "active tick {i}");
            assert_eq!(
                plain.is_some(),
                i >= expected_active && i < 24,
                "plain tick {i}"
            );
            if let Some(bounds) = active.or(plain) {
                assert_eq!(bounds.size, size(px(2.), px(18.)));
            }
        }
    }
    fn comparison_cards(&mut self) -> Vec<(String, Vec<String>)> {
        self.cx.update(|w, _| {
            let mut cards = Vec::new();
            for id in ["plan-card-free", "plan-card-team", "plan-card-enterprise"] {
                let card = w.find(id);
                assert_eq!(card.role(), Some(Role::Group));
                let mut scope = w.within(id);
                let mut text = vec![
                    scope.find("amount").value().unwrap().to_owned(),
                    scope.find("period").value().unwrap().to_owned(),
                ];
                for index in 0..4usize {
                    let row = scope.within(("plan-spec", index));
                    text.push(row.find("label").value().unwrap().to_owned());
                    text.push(row.find("value").value().unwrap().to_owned());
                }
                cards.push((card.label().unwrap().to_owned(), text));
            }
            cards
        })
    }
    // Headless TestWindow has no OS accessibility adapter. Kit observes the
    // actual painted elements' native write_a11y_info output; it supplies no
    // test-only labels or values and is a no-op in shipping builds.
    fn accessibility(&mut self) -> Vec<Value> {
        self.cx.update(|w, _| {
            w.elements().into_iter().map(|n| json!({
            "role":n.role().map(|r|format!("{r:?}")), "label":n.label(),
            "numeric_value":n.numeric_value(), "min_numeric_value":n.min_numeric_value(),
            "max_numeric_value":n.max_numeric_value()
        })).collect()
        })
    }
}
fn usage(used: u64, total: u64, reserved: u64, storage: u64) -> Usage {
    serde_json::from_value(json!({"runtime":{"org_id":"o1","allowance":{"granted_units":total,"consumed_units":used,"reserved_units":reserved,"unit_seconds":60}},"storage":{"logical_bytes":storage,"limit_bytes":10000000000u64}})).unwrap()
}
fn holding() -> PlanHolding {
    let summary: Summary = serde_json::from_value(
        json!({"org_id":"o1","plan_id":"team_v2","seat_quantity":1,"status":"active"}),
    )
    .unwrap();
    pricing::resolve_holding(Some(&summary), None)
}
#[test]
fn signed_out_plan_renders_comparable_prices_and_routes_every_offer_to_account() {
    let forbidden = regex::Regex::new(
        r"(?i)\bvCPU\b|\bGPU\b|\bRAM\b|\bcores?\b|\bVM\b|virtual machine|\binstance\b|\bunits?\b",
    )
    .unwrap();
    for plan in ["free", "team", "enterprise"] {
        let mut f = Fixture::mount(Content::Page, None, false, false, false);
        for expected in [
            "Free",
            "Team",
            "Enterprise",
            "$0",
            "$20",
            "$40",
            "/ month",
            "/ person / month",
            "40 h / person / month",
            "Storage",
            "Included",
            "Projects online",
            "20 / person",
            "History",
            "30 days",
        ] {
            f.contains(expected);
        }
        assert_eq!(f.buttons(), ["Sign in to choose"; 3]);
        let cards = f.comparison_cards();
        assert_eq!(
            cards
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            ["Free", "Team", "Enterprise"]
        );
        for (card, price, period) in [
            (&cards[0], "$0", "/ month"),
            (&cards[1], "$20", "/ person / month"),
            (&cards[2], "$40", "/ person / month"),
        ] {
            assert_eq!(&card.1[..2], [price, period]);
        }
        assert_eq!(
            &cards[1].1[2..],
            [
                "Agent hours",
                "40 h / person / month",
                "Storage",
                "Included",
                "Projects online",
                "20 / person",
                "History",
                "30 days"
            ]
        );

        assert!(
            f.strings()
                .iter()
                .any(|s| s.contains("Agent hours cover agents only")
                    && s.contains("AI model costs are separate"))
        );
        assert!(!forbidden.is_match(&f.strings().join("\n")));
        f.excludes("Choose what each agent");
        f.excludes("record of what agents");
        assert!(!f.surface.read_with(&f.cx, |s, _| s.plan_page.storage_open));
        let at = f.cx.debug_bounds("plan-storage-details").unwrap().center();
        f.cx.simulate_click(at, Modifiers::default());
        f.draw();
        assert!(f.surface.read_with(&f.cx, |s, _| s.plan_page.storage_open));
        f.contains("10 GB / person");
        f.cx.update(|w, cx| w.click(SharedString::from(format!("plan-sign-in-{plan}")), cx));
        assert_eq!(f.surface.read_with(&f.cx, |s, _| s.page), Page::Account);
    }
}
#[test]
fn signed_in_and_restoring_pages_keep_loading_without_offering_sign_in_or_free() {
    for (signed_in, restoring) in [(true, false), (false, true)] {
        let mut f = Fixture::mount(Content::Page, None, signed_in, false, restoring);
        assert!(f.cx.debug_bounds("plan-loading").is_some());
        f.ticks(0);
        f.contains("Your plan");
        f.contains("Agent hours");
        f.excludes("Free");
        f.excludes("Sign in to choose");
        assert!(f.buttons().is_empty());
        assert!(f.accessibility().iter().any(|n| n["role"] == "Status"
            && n["label"] == crate::localization::t("common.status.loading")));
        assert!(
            !f.accessibility()
                .iter()
                .any(|n| n["role"] == "ProgressIndicator")
        );
    }
}
#[test]
fn failed_signed_in_read_offers_retry_and_prices_without_inventing_current_plan() {
    let mut f = Fixture::mount(Content::Page, None, true, true, false);
    assert!(f.cx.debug_bounds("plan-loading").is_none());
    f.contains("$20");
    f.excludes("Sign in to choose");
    assert_eq!(f.buttons(), ["Retry"]);
    f.excludes("Current plan");
    assert!(f.accessibility().iter().any(|n| n["role"] == "Alert"));
    assert!(!f.accessibility().iter().any(|n| n["role"] == "Status"));
    assert!(
        f.surface
            .read_with(&f.cx, |s, _| s.plan_page.snapshot.summary.is_none())
    );
    let epoch = f.surface.read_with(&f.cx, |s, _| s.plan_page.epoch);
    f.cx.update(|w, cx| w.click("plan-load-retry", cx));
    assert_eq!(
        f.surface.read_with(&f.cx, |s, _| s.plan_page.epoch),
        epoch + 1
    );
}
#[test]
fn actual_current_plan_keeps_one_meter_and_shows_only_relevant_storage_warnings() {
    for (percent, notice) in [
        (30, None),
        (85, Some("Storage is almost full")),
        (100, Some("Storage is full")),
    ] {
        let mut f = Fixture::mount(
            Content::Current(holding()),
            Some(usage(1200, 2400, 0, percent * 100000000)),
            false,
            false,
            false,
        );
        f.contains("20 / 40 h used");
        f.contains("20 h left");
        f.ticks(12);
        let nodes = f.accessibility();
        let meters: Vec<_> = nodes
            .iter()
            .filter(|n| n["role"] == "ProgressIndicator")
            .collect();
        assert_eq!(meters.len(), 1);
        assert_eq!(meters[0]["label"], "Agent hours");
        assert_eq!(meters[0]["numeric_value"], 50.0);
        assert_eq!(meters[0]["min_numeric_value"], 0.0);
        assert_eq!(meters[0]["max_numeric_value"], 100.0);
        if let Some(text) = notice {
            f.contains(text);
        } else {
            f.excludes("Storage is almost full");
            f.excludes("Storage is full");
        }
    }
}
#[test]
fn actual_usage_text_distinguishes_reserved_legacy_empty_and_missing_readings() {
    let legacy = |used, total, available, reserved| {
        serde_json::from_value(json!({"runtime":{"org_id":"o1","granted_units":total,"consumed_units":used,"available_units":available,"reserved_units":reserved,"postpaid_available_units":0,"postpaid_consumed_units":0,"buckets":[]},"storage":{"logical_bytes":0,"limit_bytes":1000000000}})).unwrap()
    };
    for (reading, used, left, percent) in [
        (
            Some(usage(1200, 2400, 60, 1000000000)),
            "20 / 40 h used",
            "19 h left",
            Some(50.),
        ),
        (Some(legacy(0, 0, 0, 0)), "0 h used", "0 h left", None),
        (
            Some(legacy(120, 300, 150, 30)),
            "2 / 5 h used",
            "2.5 h left",
            Some(40.),
        ),
        (None, "— h used", "— h left", None),
    ] {
        let mut f = Fixture::mount(Content::Current(holding()), reading, false, false, false);
        f.contains(used);
        f.contains(left);
        f.ticks(match percent {
            Some(50.) => 12,
            Some(40.) => 10,
            None => 0,
            _ => unreachable!(),
        });
        if used == "20 / 40 h used" {
            let at = f.cx.debug_bounds("plan-hours-left").unwrap().center();
            f.cx.simulate_mouse_move(at, None, Modifiers::default());
            f.cx.executor().advance_clock(Duration::from_secs(2));
            f.cx.run_until_parked();
            f.draw();
            f.contains("1 h in progress");
        }
        let nodes = f.accessibility();
        let meters: Vec<_> = nodes
            .iter()
            .filter(|n| n["role"] == "ProgressIndicator")
            .collect();
        if let Some(percent) = percent {
            assert_eq!(meters.len(), 1);
            assert_eq!(meters[0]["numeric_value"], percent);
        } else {
            assert!(meters.is_empty());
        }
    }
}

#[test]
fn scheduled_changes_render_the_renewal_and_deliver_one_keep_action() {
    use crate::workspace::cloud::pricing::Scheduled;
    for (current, next, seats, label) in [
        ("team", "team", 2, "2 people from Dec 8"),
        ("enterprise", "team", 1, "Team from Dec 8"),
    ] {
        let mut held = holding();
        held.plan_id = current.into();
        held.seats = 3;
        held.scheduled = Some(Scheduled {
            plan_id: next.into(),
            seats,
            effective_at: "2026-12-08T12:00:00Z".into(),
        });
        let calls = std::rc::Rc::new(std::cell::Cell::new(0));
        let mut f = Fixture::mount(
            Content::Scheduled(held, calls.clone()),
            None,
            false,
            false,
            false,
        );
        f.contains("Scheduled change");
        f.contains(label);
        f.ticks(0);
        assert!(
            !f.accessibility()
                .iter()
                .any(|n| n["role"] == "ProgressIndicator")
        );
        f.cx.update(|w, cx| w.click("keep-plan-fixture", cx));
        assert_eq!(calls.get(), 1);
    }
}

#[path = "controller.rs"]
mod controller_tests;
