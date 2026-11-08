//! `AgentCreature`'s geometry and colours against the product's.
use super::*;
use core::prelude::v1::test;

/// The same name makes the same creature as in the product
/// (`agentCreatureFor`, read off qubits@686d41c49 in node).
#[test]
fn a_name_makes_the_products_creature() {
    // Colours by index: #57B96A is 3, #D9B23A is 7, #E8489A is 4.
    for (seed, body, color) in [
        ("Claude Code", 5, 3),
        ("my agent", 7, 3),
        ("Robo", 2, 7),
        ("维修工", 3, 7),
        ("x", 4, 4),
        ("  ROBO ", 2, 7),
    ] {
        assert_eq!(creature_for(seed), (body, color), "{seed}");
    }
    assert_eq!(hash("claude code"), 2679350757);
}

#[test]
fn a_creature_sleeps_at_rest_and_wakes_at_work() {
    let ground: Rgba = gpui::white().into();
    let awake = svg("Robo", true, ground);
    let asleep = svg("Robo", false, ground);
    assert!(awake.contains("<ellipse") && !asleep.contains("<ellipse"));
    assert!(awake.contains("#d9b23a") && !asleep.contains("#d9b23a"));
    assert!(asleep.contains(r##"stroke="#ffffff""##));
    // Every body draws.
    for index in 0..8 {
        assert!(!body(index).is_empty());
    }
    assert_eq!(
        rounded_polygon(&[(0., 0.), (10., 0.), (10., 10.)], 2.),
        "M1.41 1.41 Q0.00 0.00 2.00 0.00 L8.00 0.00 Q10.00 0.00 10.00 2.00 L10.00 8.00 Q10.00 10.00 8.59 8.59 Z"
    );
}
