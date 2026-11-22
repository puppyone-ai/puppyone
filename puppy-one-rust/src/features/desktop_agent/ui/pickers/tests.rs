//! `tests/component/agent/runtimes/pickers.test.ts` and the model choice of
//! `builtInAgentCompute.test.tsx`, over one session picker.
use super::*;
use crate::features::desktop_agent::domain::agent_session_controls::AgentSessionControlOption;
use core::prelude::v1::test;
use gpui::{Modifiers, TestAppContext, VisualTestContext};

/// A container that shows one picker and applies its choices, as the
/// composer and the compute dock do.
struct Host {
    pickers: Entity<SessionPickers>,
    control: AgentSessionControl,
    disabled: bool,
    chosen: Vec<String>,
    /// The control each choice set.
    sets: Vec<AgentSessionControlId>,
}

impl Render for Host {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let picker = self
            .pickers
            .update(cx, |p, cx| p.picker(&self.control, 248., self.disabled, cx));
        div()
            .size_full()
            .flex()
            .flex_col()
            .justify_end()
            .child(picker)
    }
}

fn option(value: &str, label: &str) -> AgentSessionControlOption {
    AgentSessionControlOption {
        value: value.into(),
        label: label.into(),
        description: None,
        keywords: Some(value.into()),
        ..Default::default()
    }
}

fn setup(
    cx: &mut TestAppContext,
    control: AgentSessionControl,
    disabled: bool,
) -> (Entity<Host>, &mut VisualTestContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::form_input::bind_keys(cx);
    });
    crate::localization::set_current("en");
    let (host, cx) = cx.add_window_view(|window, cx| {
        let pickers = cx.new(|cx| SessionPickers::new(window, cx));
        cx.subscribe(&pickers, |host: &mut Host, _, event, cx| {
            let PickerEvent::Select { id, value } = event;
            host.control.value = Some(value.clone());
            host.chosen.push(value.clone());
            host.sets.push(*id);
            cx.notify();
        })
        .detach();
        Host {
            pickers,
            control,
            disabled,
            chosen: Vec::new(),
            sets: Vec::new(),
        }
    });
    draw(cx);
    (host, cx)
}

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|window, cx| window.draw(cx).clear(cx));
}

fn click(cx: &mut VisualTestContext, selector: &'static str) {
    let bounds = cx.debug_bounds(selector).expect(selector);
    cx.simulate_click(bounds.center(), Modifiers::default());
    draw(cx);
}

fn models(options: Vec<AgentSessionControlOption>, value: &str) -> AgentSessionControl {
    AgentSessionControl {
        id: AgentSessionControlId::Model,
        value: Some(value.into()),
        options,
    }
}

/// `updates the visible Agent and Model labels after pointer selection` (the
/// Model half); `disables model selection during a turn`.
#[gpui::test]
fn a_pointer_choice_updates_the_label_and_a_disabled_picker_stays_shut(cx: &mut TestAppContext) {
    let control = models(
        vec![
            option("claude-sonnet", "Claude Sonnet"),
            option("claude-opus", "Claude Opus"),
        ],
        "claude-sonnet",
    );
    let (host, cx) = setup(cx, control.clone(), false);
    assert!(
        cx.debug_bounds("agent-picker-Model:Claude Sonnet")
            .is_some()
    );
    click(cx, "agent-picker-Model");
    click(cx, "menu-item:Claude Opus");
    assert_eq!(host.read_with(cx, |h, _| h.chosen.clone()), ["claude-opus"]);
    assert!(cx.debug_bounds("agent-picker-Model:Claude Opus").is_some());
    assert!(
        cx.debug_bounds("menu-item:Claude Sonnet").is_none(),
        "closed"
    );

    host.update(cx, |h, cx| {
        h.disabled = true;
        cx.notify();
    });
    draw(cx);
    click(cx, "agent-picker-Model");
    assert!(cx.debug_bounds("menu-item:Claude Sonnet").is_none());
    assert_eq!(host.read_with(cx, |h, _| h.chosen.len()), 1);
}

/// `keeps a large model catalog searchable while bounding mounted picker
/// options`.
#[gpui::test]
fn a_large_catalog_is_bounded_and_searchable(cx: &mut TestAppContext) {
    let options = (0..500)
        .map(|i| option(&format!("provider/model-{i}"), &format!("Model {i}")))
        .collect();
    let (_, cx) = setup(cx, models(options, "provider/model-0"), false);
    click(cx, "agent-picker-Model");
    assert!(cx.debug_bounds("menu-item:Model 0").is_some());
    assert!(cx.debug_bounds("menu-item:Model 119").is_some());
    assert!(cx.debug_bounds("menu-item:Model 120").is_none());
    assert!(
        cx.debug_bounds("agent-picker-showing:Showing 120 of 500. Search to narrow.")
            .is_some()
    );
    cx.simulate_input("Model 499");
    draw(cx);
    assert!(cx.debug_bounds("menu-item:Model 499").is_some());
    assert!(cx.debug_bounds("menu-item:Model 0").is_none());
    assert!(
        cx.debug_bounds("agent-picker-showing:Showing 120 of 500. Search to narrow.")
            .is_none()
    );
}

/// The picker's keys: arrows move, Enter chooses and closes, Escape closes
/// without a choice.
#[gpui::test]
fn arrows_move_enter_chooses_and_escape_closes(cx: &mut TestAppContext) {
    let control = models(
        vec![option("gpt-5", "GPT-5"), option("gpt-5-mini", "GPT-5 mini")],
        "gpt-5",
    );
    let (host, cx) = setup(cx, control, false);
    click(cx, "agent-picker-Model");
    cx.simulate_keystrokes("down enter");
    draw(cx);
    assert_eq!(host.read_with(cx, |h, _| h.chosen.clone()), ["gpt-5-mini"]);
    assert!(cx.debug_bounds("menu-item:GPT-5").is_none(), "closed");
    click(cx, "agent-picker-Model");
    assert!(cx.debug_bounds("menu-item:GPT-5").is_some());
    cx.simulate_keystrokes("escape");
    draw(cx);
    assert!(cx.debug_bounds("menu-item:GPT-5").is_none());
    assert_eq!(host.read_with(cx, |h, _| h.chosen.len()), 1);
}

/// The source picker is a cascading menu for the keyboard: moving onto a
/// source does not open its providers; Right (or Enter) enters them, the
/// arrows move among them, Enter picks one (setting the Model) and Left
/// goes back.
#[gpui::test]
fn the_keyboard_enters_a_source_s_providers_and_picks_one(cx: &mut TestAppContext) {
    let provider = |value: &str, label: &str| AgentSessionControlOption {
        value: value.into(),
        label: label.into(),
        ..Default::default()
    };
    let source = |value: &str, label: &str, children| AgentSessionControlOption {
        value: value.into(),
        label: label.into(),
        children,
        ..Default::default()
    };
    let control = AgentSessionControl {
        id: AgentSessionControlId::Source,
        value: Some("oauth".into()),
        options: vec![
            source("oauth", "Sign-ins", vec![provider("gpt-5", "ChatGPT")]),
            source(
                "local",
                "Local",
                vec![provider("llama", "Ollama"), provider("qwen", "LM Studio")],
            ),
        ],
    };
    let (host, cx) = setup(cx, control, false);
    click(cx, "agent-picker-Source");
    cx.simulate_keystrokes("down");
    draw(cx);
    assert!(
        cx.debug_bounds("menu-item:Ollama").is_none(),
        "a highlight alone opens no submenu"
    );
    cx.simulate_keystrokes("right");
    draw(cx);
    assert!(cx.debug_bounds("menu-item:Ollama").is_some());
    cx.simulate_keystrokes("left");
    draw(cx);
    assert!(cx.debug_bounds("menu-item:Ollama").is_none(), "back out");
    cx.simulate_keystrokes("enter");
    draw(cx);
    assert!(
        cx.debug_bounds("menu-item:LM Studio").is_some(),
        "Enter enters"
    );
    assert!(host.read_with(cx, |h, _| h.chosen.is_empty()));
    cx.simulate_keystrokes("down enter");
    draw(cx);
    assert_eq!(host.read_with(cx, |h, _| h.chosen.clone()), ["qwen"]);
    assert_eq!(
        host.read_with(cx, |h, _| h.sets.clone()),
        [AgentSessionControlId::Model]
    );
    assert!(cx.debug_bounds("menu-item:LM Studio").is_none(), "closed");
}
