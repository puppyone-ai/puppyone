use super::*;
use core::prelude::v1::test;
fn env(entries: &[(&str, &str)]) -> Environment {
    entries
        .iter()
        .map(|(key, value)| ((*key).into(), (*value).into()))
        .collect()
}
#[test]
fn fresh_login_removes_launcher_and_conda_activation_metadata_without_mutating_user_configuration()
{
    let source = env(&[
        ("HOME", "/Users/test"),
        (
            "PATH",
            "/workspace/node_modules/.bin:/Users/test/.hermes/node/bin:/opt/anaconda3/envs/project/bin:/opt/anaconda3/bin:/usr/bin",
        ),
        ("SHELL", "/bin/zsh"),
        ("http_proxy", "http://127.0.0.1:7897"),
        ("npm_config_prefix", "/Users/test/.hermes/node"),
        ("npm_execpath", "/tools/npm-cli.js"),
        ("npm_node_execpath", "/tools/node"),
        ("npm_lifecycle_event", "dev"),
        ("npm_lifecycle_script", "node scripts/dev-electron.mjs"),
        ("npm_package_name", "@puppyone/desktop"),
        ("npm_config_registry", "https://registry.npmjs.org/"),
        ("NPM_TOKEN", "user-configured-token"),
        ("INIT_CWD", "/workspace"),
        ("PREFIX", "/tools/node"),
        ("CONDA_PREFIX", "/opt/anaconda3/envs/project"),
        ("CONDA_PREFIX_1", "/opt/anaconda3"),
        ("CONDA_SHLVL", "2"),
        ("CONDA_DEFAULT_ENV", "project"),
        ("CONDA_PROMPT_MODIFIER", "(project) "),
        ("CONDA_STACKED_2", "true"),
        ("__CONDA_SHLVL_1_SDKROOT", "/old-sdk"),
        ("CONDA_PATH_BACKUP", "/legacy/path"),
        ("CONDA_PS1_BACKUP", "old prompt"),
        ("CONDA_EXE", "/opt/anaconda3/bin/conda"),
        ("CONDA_ROOT", "/opt/anaconda3"),
        ("NO_COLOR", "1"),
        ("COLORFGBG", "0;15"),
        ("TERM", "inherited-term"),
        ("TERM_PROGRAM", "inherited-program"),
    ]);
    let original = source.clone();
    let result = build(
        &source,
        "0.2.0-test",
        &Environment::new(),
        None,
        true,
        "darwin",
    );
    assert_eq!(source, original);
    for key in [
        "npm_config_prefix",
        "npm_execpath",
        "npm_node_execpath",
        "npm_lifecycle_event",
        "npm_lifecycle_script",
        "npm_package_name",
        "INIT_CWD",
        "PREFIX",
        "CONDA_PREFIX",
        "CONDA_PREFIX_1",
        "CONDA_SHLVL",
        "CONDA_DEFAULT_ENV",
        "CONDA_PROMPT_MODIFIER",
        "CONDA_STACKED_2",
        "__CONDA_SHLVL_1_SDKROOT",
        "CONDA_PATH_BACKUP",
        "CONDA_PS1_BACKUP",
        "NO_COLOR",
        "COLORFGBG",
    ] {
        assert!(!result.contains_key(key), "retained {key}");
    }
    assert_eq!(
        result["PATH"],
        "/workspace/node_modules/.bin:/Users/test/.hermes/node/bin:/usr/bin"
    );
    for key in [
        "HOME",
        "SHELL",
        "http_proxy",
        "npm_config_registry",
        "NPM_TOKEN",
        "CONDA_EXE",
        "CONDA_ROOT",
    ] {
        assert_eq!(result[key], original[key]);
    }
    for (key, value) in [
        ("TERM", "xterm-256color"),
        ("COLORTERM", "truecolor"),
        ("CLICOLOR", "1"),
        ("TERM_PROGRAM", "PuppyOne"),
        ("TERM_PROGRAM_VERSION", "0.2.0-test"),
        ("PUPPYONE_TERMINAL", "1"),
    ] {
        assert_eq!(result[key], value);
    }
}
#[test]
fn renderer_brightness_replaces_inherited_colorfgbg_and_preserves_explicit_clicolor() {
    for (background, expected) in [
        ([22, 20, 19], "15;0"),
        ([251, 250, 247], "0;15"),
        ([187; 3], "15;0"),
        ([188; 3], "0;15"),
    ] {
        let result = build(
            &env(&[("COLORFGBG", "wrong"), ("CLICOLOR", "0")]),
            "test",
            &Environment::new(),
            Some(DefaultColors {
                foreground: [209, 206, 198],
                background,
            }),
            true,
            "darwin",
        );
        assert_eq!(result["COLORFGBG"], expected);
        assert_eq!(result["CLICOLOR"], "0");
    }
}
#[test]
fn metadata_filtering_is_case_insensitive_and_only_the_current_host_can_supply_control_endpoints() {
    for key in [
        "npm_config_prefix",
        "NPM_CONFIG_PREFIX",
        "NpM_CoNfIg_PrEfIx",
    ] {
        let result = build(
            &env(&[("HOME", "/Users/test"), (key, "/unexpected-prefix")]),
            "test",
            &Environment::new(),
            None,
            true,
            "darwin",
        );
        assert!(!result.contains_key(key));
        assert_eq!(result["HOME"], "/Users/test");
    }
    let source = env(&[
        ("PUPPYONE_CLI_ENDPOINT", "/inherited/control.sock"),
        ("puppyone_app_path", "/Applications/Other.app"),
        ("no_color", "1"),
    ]);
    let host = env(&[
        ("PUPPYONE_CLI_ENDPOINT", "/host/cli/control.sock"),
        ("PUPPYONE_APP_PATH", ""),
        ("UNRELATED", "x"),
    ]);
    let result = build(&source, "test", &host, None, true, "darwin");
    assert_eq!(result["PUPPYONE_CLI_ENDPOINT"], "/host/cli/control.sock");
    for key in [
        "PUPPYONE_APP_PATH",
        "puppyone_app_path",
        "UNRELATED",
        "no_color",
    ] {
        assert!(!result.contains_key(key));
    }
    let no_host = build(&source, "test", &Environment::new(), None, true, "darwin");
    assert!(!no_host.contains_key("PUPPYONE_CLI_ENDPOINT"));
}
#[test]
fn resolved_agent_environments_preserve_conda_paths_but_not_npm_process_metadata() {
    let source = env(&[
        ("PATH", "/opt/anaconda3/envs/project/bin:/usr/bin"),
        ("CONDA_PREFIX", "/opt/anaconda3/envs/project"),
        ("CONDA_SHLVL", "1"),
        ("npm_execpath", "/tools/npm-cli.js"),
        ("npm_config_prefix", "/tools/node"),
    ]);
    let result = build(&source, "test", &Environment::new(), None, false, "darwin");
    for key in ["PATH", "CONDA_PREFIX", "CONDA_SHLVL"] {
        assert_eq!(result[key], source[key]);
    }
    assert!(!result.contains_key("npm_execpath"));
    assert!(!result.contains_key("npm_config_prefix"));
}
#[test]
fn conda_path_removal_respects_platform_separators_case_and_exact_activation_roots() {
    let source = env(&[
        (
            "PATH",
            r"C:\Conda;C:\Conda\Library\mingw-w64\bin;C:\Conda\Library\usr\bin;C:\Conda\Library\bin;C:\Conda\Scripts;c:\conda\bin\;C:\Conda\binary;C:\Windows",
        ),
        ("CONDA_PREFIX", r"C:\Conda"),
    ]);
    let result = build(&source, "test", &Environment::new(), None, true, "win32");
    assert_eq!(result["PATH"], r"C:\Conda\binary;C:\Windows");
    let source = env(&[
        ("PATH", "/env/bin/:/env/BIN:/env/binary:/usr/bin::"),
        ("CONDA_PREFIX", "/env/./"),
    ]);
    let result = build(&source, "test", &Environment::new(), None, true, "darwin");
    assert_eq!(result["PATH"], "/env/BIN:/env/binary:/usr/bin::");
}
