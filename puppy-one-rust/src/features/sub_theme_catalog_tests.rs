//! Catalog resolution and palette registration.
use super::*;
use core::prelude::v1::test;

fn theme(id: &str, modes: Vec<Mode>, targets: Vec<Target>) -> Theme {
    Theme {
        id: id.into(),
        name: id.into(),
        version: "1".into(),
        author: None,
        modes,
        targets,
        compatible_root_theme_ids: vec!["default".into()],
        source: service::Source::LocalCss,
        application: Some([
            vec![("--po-accent".into(), "#123456".into())],
            vec![("--po-accent".into(), "#abcdef".into())],
        ]),
    }
}

#[test]
fn installed_themes_resolve_per_mode_and_paint() {
    let all = vec![Target::Application, Target::Markdown, Target::Csv];
    let catalog = Catalog::with(vec![
        theme(
            "local.user.both",
            vec![Mode::Light, Mode::Dark],
            all.clone(),
        ),
        theme("local.user.light", vec![Mode::Light], all),
        theme(
            "local.user.partial",
            vec![Mode::Light, Mode::Dark],
            vec![Target::Application],
        ),
        theme("default.warm", vec![Mode::Light], vec![Target::Csv]),
    ]);
    assert_eq!(
        catalog.effective("local.user.both", true),
        "local.user.both"
    );
    assert_eq!(
        catalog.effective("local.user.light", false),
        "local.user.light"
    );
    assert_eq!(
        catalog.effective("local.user.light", true),
        "default.neutral"
    );
    assert_eq!(
        catalog.effective("local.user.partial", false),
        "default.neutral"
    );
    assert_eq!(
        catalog.effective("local.user.gone", false),
        "default.neutral"
    );
    let light: Vec<String> = catalog
        .selectable(false)
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert_eq!(&light[5..], ["local.user.both", "local.user.light"]);
    assert!(catalog.contains("local.user.partial") && !catalog.contains("local.user.gone"));
    assert_eq!(
        catalog.diagnostics()[0].message,
        "Sub Theme id conflicts with a built-in variant: default.warm."
    );
    let accent = |id: &str, dark: bool| crate::theme::pack_theme(id, dark).accent;
    assert_eq!(accent("local.user.both", false), gpui::rgb(0x123456));
    assert_eq!(accent("local.user.both", true), gpui::rgb(0xabcdef));
    assert_eq!(
        accent("local.user.light", true),
        accent("default.neutral", true),
        "a missing mode keeps the Neutral palette"
    );
    crate::theme::set_pack("local.user.both");
    assert_eq!(crate::theme::pack_id(), "local.user.both");
    crate::theme::set_installed(vec![]);
    crate::theme::set_pack("local.user.both");
    assert_eq!(crate::theme::pack_id(), "default.neutral");
}

#[gpui::test]
fn the_theme_menu_lists_the_mode_and_checks_the_effective_theme(cx: &mut gpui::TestAppContext) {
    cx.update(|cx| {
        assert!(
            sync_menu("local.user.gone", false, cx),
            "first sync builds the menu"
        );
        assert!(
            !sync_menu("local.user.gone", false, cx),
            "unchanged state keeps it"
        );
        let menu = theme_menu(|key| key.to_owned().into());
        assert_eq!(menu.name.as_ref(), "native.menu.theme");
        let gpui::MenuItem::Submenu(pack) = &menu.items[0] else {
            panic!("Visual Variant submenu")
        };
        let checked: Vec<(String, bool)> = pack
            .items
            .iter()
            .filter_map(|item| match item {
                gpui::MenuItem::Action { name, checked, .. } => Some((name.to_string(), *checked)),
                _ => None,
            })
            .collect();
        assert_eq!(checked.len(), 5);
        assert_eq!(
            checked[0],
            ("Neutral".to_owned(), true),
            "a missing id checks Neutral"
        );
        assert!(matches!(
            &menu.items[2],
            gpui::MenuItem::Action { name, .. } if name.as_ref() == "native.menu.theme.openFolder"
        ));
        assert!(sync_menu("default.warm", false, cx));
    });
}
