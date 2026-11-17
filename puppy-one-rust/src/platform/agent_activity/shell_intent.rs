//! Port of `bridge/shell-file-intent.mjs`: literal file operands of a small
//! set of read-only shell commands. An observability hint, not a shell
//! parser: any syntax whose path depends on expansion or process state fails
//! closed.
use serde_json::Value;

const MAX_COMMAND_LENGTH: usize = 64 * 1024;
const MAX_PATHS: usize = 32;
const SHELL_TOOL_NAMES: [&str; 5] = ["bash", "exec_command", "shell", "terminal", "unified_exec"];
const SIMPLE_READ_COMMANDS: [&str; 6] = ["cat", "file", "nl", "stat", "strings", "wc"];

/// `projectShellReadPaths`.
pub fn project_read_paths(tool_name: &str, input: &Value) -> Vec<String> {
    if !SHELL_TOOL_NAMES.contains(&tool_name.to_lowercase().as_str()) {
        return vec![];
    }
    match input.get("command") {
        Some(Value::String(command)) if input.is_object() => extract_read_paths(command),
        _ => vec![],
    }
}

/// `extractShellReadPaths`.
pub fn extract_read_paths(command: &str) -> Vec<String> {
    let Some(tokens) = tokenize(command) else {
        return vec![];
    };
    let segments = split_segments(&tokens);
    if segments
        .iter()
        .any(|segment| command_name(segment).as_deref() == Some("cd"))
    {
        return vec![];
    }
    let mut paths = Vec::new();
    for segment in &segments {
        paths.extend(read_paths(segment));
        if paths.len() >= MAX_PATHS {
            break;
        }
    }
    let mut seen = std::collections::HashSet::new();
    paths.retain(|p| seen.insert(p.clone()));
    paths.truncate(MAX_PATHS);
    paths
}

fn read_paths(segment: &[String]) -> Vec<String> {
    let tokens = strip_assignments(segment);
    let Some(name) = command_name(tokens) else {
        return vec![];
    };
    let operands = match name.as_str() {
        n if SIMPLE_READ_COMMANDS.contains(&n) => simple_operands(tokens, n),
        "head" | "tail" => valued_operands(
            tokens,
            &[
                "-c",
                "-n",
                "--bytes",
                "--lines",
                "--sleep-interval",
                "--pid",
            ],
        ),
        "od" => valued_operands(
            tokens,
            &[
                "-A",
                "-j",
                "-N",
                "-S",
                "-t",
                "-w",
                "--address-radix",
                "--skip-bytes",
                "--read-bytes",
                "--strings",
                "--format",
                "--width",
            ],
        ),
        "grep" | "rg" => search_operands(tokens, &name),
        "sed" => sed_operands(tokens),
        _ => vec![],
    };
    literal_paths(operands)
}

fn simple_operands(tokens: &[String], name: &str) -> Vec<String> {
    let mut operands = Vec::new();
    let mut ended = false;
    let mut index = 1;
    while index < tokens.len() {
        let token = &tokens[index];
        if !ended && token == "--" {
            ended = true;
        } else if !ended && token.starts_with('-') {
            if name == "stat" && ["-f", "--format", "--printf"].contains(&token.as_str()) {
                index += 1;
            }
        } else {
            operands.push(token.clone());
        }
        index += 1;
    }
    operands
}

/// `headOrTailOperands` / `odOperands`: options in `valued` take the next token.
fn valued_operands(tokens: &[String], valued: &[&str]) -> Vec<String> {
    let mut operands = Vec::new();
    let mut ended = false;
    let mut index = 1;
    while index < tokens.len() {
        let token = &tokens[index];
        if !ended && token == "--" {
            ended = true;
        } else if !ended && valued.contains(&token.as_str()) {
            index += 1;
        } else if !(!ended && token.starts_with('-')) {
            operands.push(token.clone());
        }
        index += 1;
    }
    operands
}

fn search_operands(tokens: &[String], name: &str) -> Vec<String> {
    const FLAGS: [&str; 22] = [
        "-c",
        "-h",
        "-H",
        "-i",
        "-l",
        "-L",
        "-n",
        "-q",
        "-s",
        "-v",
        "-w",
        "-x",
        "--count",
        "--files-with-matches",
        "--files-without-match",
        "--fixed-strings",
        "--hidden",
        "--ignore-case",
        "--line-number",
        "--no-heading",
        "--quiet",
        "--word-regexp",
    ];
    const VALUED: [&str; 18] = [
        "-A",
        "-B",
        "-C",
        "-e",
        "-f",
        "-g",
        "-m",
        "-t",
        "-T",
        "--after-context",
        "--before-context",
        "--context",
        "--file",
        "--glob",
        "--max-count",
        "--regexp",
        "--type",
        "--type-not",
    ];
    let mut positional = Vec::new();
    let mut ended = false;
    let mut pattern_by_option = false;
    let mut index = 1;
    while index < tokens.len() {
        let token = tokens[index].as_str();
        if !ended && token == "--" {
            ended = true;
        } else if !ended && FLAGS.contains(&token) {
        } else if !ended && VALUED.contains(&token) {
            if matches!(token, "-e" | "--regexp" | "-f" | "--file") {
                pattern_by_option = true;
            }
            index += 1;
        } else if !ended && token.starts_with('-') {
            return vec![];
        } else {
            positional.push(token.to_owned());
        }
        index += 1;
    }
    if !pattern_by_option && !positional.is_empty() {
        positional.remove(0);
    }
    if name == "rg" && positional.is_empty() {
        return vec![];
    }
    positional
}

fn sed_operands(tokens: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    let mut positional = Vec::new();
    let mut ended = false;
    let mut script_by_option = false;
    let mut index = 1;
    while index < tokens.len() {
        let token = tokens[index].as_str();
        let option = !ended;
        if option && token == "--" {
            ended = true;
        } else if option && (token.starts_with("-i") || token.starts_with("--in-place")) {
            return vec![];
        } else if option
            && ((token.len() > 1
                && token.starts_with('-')
                && token[1..].chars().all(|c| "nErsuz".contains(c)))
                || [
                    "--quiet",
                    "--silent",
                    "--regexp-extended",
                    "--separate",
                    "--unbuffered",
                    "--null-data",
                ]
                .contains(&token))
        {
            // Flags without a value.
        } else if option && (token == "-e" || token == "--expression") {
            if index + 1 >= tokens.len() {
                return vec![];
            }
            script_by_option = true;
            index += 1;
        } else if option
            && ((token.starts_with("-e") && token.len() > 2) || token.starts_with("--expression="))
        {
            script_by_option = true;
        } else if option && (token == "-f" || token == "--file") {
            let Some(script) = tokens.get(index + 1) else {
                return vec![];
            };
            paths.push(script.clone());
            script_by_option = true;
            index += 1;
        } else if option && token.starts_with("-f") && token.len() > 2 {
            paths.push(token[2..].to_owned());
            script_by_option = true;
        } else if option && let Some(script) = token.strip_prefix("--file=") {
            paths.push(script.to_owned());
            script_by_option = true;
        } else if option && token.starts_with('-') {
            return vec![];
        } else {
            positional.push(token.to_owned());
        }
        index += 1;
    }
    if !script_by_option && !positional.is_empty() {
        positional.remove(0);
    }
    paths.extend(positional);
    paths
}

fn literal_paths(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .filter(|value| {
            !value.is_empty()
                && value.chars().count() <= 4_096
                && value != "-"
                && value != "/dev/null"
                && !value.starts_with('-')
                && !value.contains("://")
                && !value
                    .chars()
                    .any(|c| c <= '\u{1f}' || c == '\u{7f}' || "$`*?[]{}~".contains(c))
        })
        .collect()
}

/// `tokenizeLiteralShell`: words, `;`/`;;`/`|`/`||`/`&&` separators, and a
/// newline as `;`. Expansion, substitution, redirection, background jobs and
/// unbalanced quotes make the whole command unreadable (`None`).
fn tokenize(command: &str) -> Option<Vec<String>> {
    if command.is_empty() || command.len() > MAX_COMMAND_LENGTH {
        return None;
    }
    let chars: Vec<char> = command.chars().collect();
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let push = |current: &mut String, tokens: &mut Vec<String>| {
        if !current.is_empty() {
            tokens.push(std::mem::take(current));
        }
    };
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        match quote {
            Some('\'') => {
                if c == '\'' {
                    quote = None;
                } else {
                    current.push(c);
                }
            }
            Some(_) => match c {
                '"' => quote = None,
                '$' | '`' => return None,
                '\\' => {
                    current.push(*chars.get(index + 1)?);
                    index += 1;
                }
                _ => current.push(c),
            },
            None => match c {
                '\'' | '"' => quote = Some(c),
                '\\' => {
                    let next = *chars.get(index + 1)?;
                    if next == '\n' {
                        return None;
                    }
                    current.push(next);
                    index += 1;
                }
                '$' | '`' | '(' | ')' | '<' | '>' => return None,
                c if c.is_whitespace() => {
                    push(&mut current, &mut tokens);
                    if c == '\n' {
                        tokens.push(";".into());
                    }
                }
                ';' | '|' => {
                    push(&mut current, &mut tokens);
                    if chars.get(index + 1) == Some(&c) {
                        tokens.push(format!("{c}{c}"));
                        index += 1;
                    } else {
                        tokens.push(c.to_string());
                    }
                }
                '&' => {
                    push(&mut current, &mut tokens);
                    if chars.get(index + 1) != Some(&'&') {
                        return None;
                    }
                    tokens.push("&&".into());
                    index += 1;
                }
                _ => current.push(c),
            },
        }
        index += 1;
    }
    if quote.is_some() {
        return None;
    }
    push(&mut current, &mut tokens);
    Some(tokens)
}

fn split_segments(tokens: &[String]) -> Vec<Vec<String>> {
    let mut segments = Vec::new();
    let mut segment = Vec::new();
    for token in tokens {
        if [";", "|", "||", "&&"].contains(&token.as_str()) {
            if !segment.is_empty() {
                segments.push(std::mem::take(&mut segment));
            }
        } else {
            segment.push(token.clone());
        }
    }
    if !segment.is_empty() {
        segments.push(segment);
    }
    segments
}

/// Leading `NAME=value` assignments (without expansion) are not the command.
fn strip_assignments(tokens: &[String]) -> &[String] {
    let assignment = |token: &str| {
        let Some((name, value)) = token.split_once('=') else {
            return false;
        };
        let mut chars = name.chars();
        chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
            && !value.contains(['$', '`'])
    };
    let skip = tokens.iter().take_while(|t| assignment(t)).count();
    &tokens[skip..]
}

fn command_name(tokens: &[String]) -> Option<String> {
    strip_assignments(tokens)
        .first()
        .map(|token| token.rsplit('/').next().unwrap_or("").to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    fn paths(command: &str) -> Vec<String> {
        extract_read_paths(command)
    }
    #[test]
    fn literal_read_commands_name_their_files() {
        assert_eq!(
            paths("cat README.md src/main.rs"),
            ["README.md", "src/main.rs"]
        );
        assert_eq!(paths("head -n 20 notes.txt | wc -l"), ["notes.txt"]);
        assert_eq!(paths("LC_ALL=C nl -ba 'a b.txt'"), ["a b.txt"]);
        assert_eq!(paths("stat -f %z file.bin"), ["file.bin"]);
        assert_eq!(paths("od -A x -t x1 data.bin"), ["data.bin"]);
        assert_eq!(paths("/usr/bin/sed -n 1,20p src/lib.rs"), ["src/lib.rs"]);
        assert_eq!(paths("sed -e s/a/b/ in.txt"), ["in.txt"]);
        assert_eq!(paths("sed -f script.sed in.txt"), ["script.sed", "in.txt"]);
        assert_eq!(
            paths("grep -n TODO src/a.rs src/b.rs"),
            ["src/a.rs", "src/b.rs"]
        );
        assert_eq!(paths("grep -e TODO src/a.rs"), ["src/a.rs"]);
        assert_eq!(
            paths("cat a.txt\ncat b.txt && cat a.txt"),
            ["a.txt", "b.txt"]
        );
    }
    #[test]
    fn anything_that_depends_on_shell_state_fails_closed() {
        for command in [
            "cat $HOME/x",
            "cat `pwd`/x",
            "cat <(echo)",
            "cat a > b",
            "cd src && cat main.rs",
            "cat 'unbalanced",
            "cat a &",
            "cat *.rs",
            "cat ~/x",
            "sed -i s/a/b/ file",
            "rg pattern",
            "grep --weird x file",
            "python read.py",
            "cat https://example.com/x",
            "cat - /dev/null",
            "",
        ] {
            assert!(paths(command).is_empty(), "{command:?}");
        }
    }
    #[test]
    fn only_shell_tools_are_projected() {
        let input = serde_json::json!({ "command": "cat a.txt" });
        assert_eq!(project_read_paths("Bash", &input), ["a.txt"]);
        assert_eq!(project_read_paths("exec_command", &input), ["a.txt"]);
        assert!(project_read_paths("Read", &input).is_empty());
        assert!(project_read_paths("bash", &serde_json::json!({ "command": 1 })).is_empty());
    }
}
