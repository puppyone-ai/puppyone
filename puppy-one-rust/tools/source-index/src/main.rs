//! AST source spans for coverage and acceptance review. Never infer production
//! coverage from regex removal of inline test bodies.
use serde_json::{Value, json};
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use syn::{
    Attribute, Meta,
    spanned::Spanned,
    visit::{self, Visit},
};

fn test_cfg(meta: &Meta) -> bool {
    match meta {
        Meta::Path(path) => path.is_ident("test"),
        Meta::NameValue(value) => {
            value.path.is_ident("feature")
                && matches!(&value.value, syn::Expr::Lit(lit) if matches!(&lit.lit, syn::Lit::Str(s) if matches!(s.value().as_str(), "test-support" | "dev-capture")))
        }
        Meta::List(list) if list.path.is_ident("cfg") || list.path.is_ident("any") => list
            .parse_args_with(syn::punctuated::Punctuated::<Meta, syn::Token![,]>::parse_terminated)
            .is_ok_and(|args| !args.is_empty() && args.iter().all(test_cfg)),
        Meta::List(list) if list.path.is_ident("all") => list
            .parse_args_with(syn::punctuated::Punctuated::<Meta, syn::Token![,]>::parse_terminated)
            .is_ok_and(|args| args.iter().any(test_cfg)),
        _ => false,
    }
}
fn test_attribute(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        attr.path()
            .segments
            .last()
            .is_some_and(|s| s.ident == "test")
    })
}
fn test_only(attrs: &[Attribute]) -> bool {
    test_attribute(attrs) || attrs.iter().any(|attr| test_cfg(&attr.meta))
}
#[derive(Default)]
struct Index {
    excluded: Vec<Value>,
    tests: Vec<Value>,
    depth: usize,
    namespace: PathBuf,
    modules: Vec<(PathBuf, bool, bool)>,
}
impl Index {
    fn exclude(&mut self, node: &impl Spanned, reason: &str) {
        let span = node.span();
        self.excluded
            .push(json!({"start":span.start().line,"end":span.end().line,"reason":reason}));
    }
}
impl<'ast> Visit<'ast> for Index {
    fn visit_item_impl(&mut self, node: &'ast syn::ItemImpl) {
        let excluded = test_only(&node.attrs);
        if excluded {
            self.exclude(node, "test support implementation");
            self.depth += 1;
        }
        visit::visit_item_impl(self, node);
        if excluded {
            self.depth -= 1;
        }
    }
    fn visit_item_mod(&mut self, node: &'ast syn::ItemMod) {
        let excluded = test_only(&node.attrs);
        if excluded {
            self.exclude(node, "test module");
            self.depth += 1;
        }
        if node.content.is_none() {
            let explicit = node.attrs.iter().find_map(|attr| match &attr.meta {
                Meta::NameValue(value) if value.path.is_ident("path") => match &value.value {
                    syn::Expr::Lit(lit) => match &lit.lit {
                        syn::Lit::Str(path) => Some(PathBuf::from(path.value())),
                        _ => None,
                    },
                    _ => None,
                },
                _ => None,
            });
            let is_explicit = explicit.is_some();
            self.modules.push((
                self.namespace
                    .join(explicit.unwrap_or_else(|| node.ident.to_string().into())),
                self.depth > 0,
                is_explicit,
            ));
        }
        let previous = self.namespace.clone();
        self.namespace.push(node.ident.to_string());
        visit::visit_item_mod(self, node);
        self.namespace = previous;
        if excluded {
            self.depth -= 1;
        }
    }
    fn visit_item_fn(&mut self, node: &'ast syn::ItemFn) {
        if test_attribute(&node.attrs) {
            self.tests.push(json!({"name":node.sig.ident.to_string(),"start":node.span().start().line,"end":node.span().end().line}));
        }
        if self.depth == 0 && test_only(&node.attrs) {
            self.exclude(node, "test function");
        }
        visit::visit_item_fn(self, node);
    }
    fn visit_impl_item_fn(&mut self, node: &'ast syn::ImplItemFn) {
        if self.depth == 0 && test_only(&node.attrs) {
            self.exclude(node, "test support method");
        }
        visit::visit_impl_item_fn(self, node);
    }
}
fn walk(root: &Path, directory: &Path, files: &mut Vec<Value>) {
    let mut children = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    children.sort();
    for path in children {
        if path.is_dir() {
            walk(root, &path, files);
            continue;
        }
        if path.extension().is_none_or(|ext| ext != "rs") {
            continue;
        }
        let text = fs::read_to_string(&path).unwrap();
        let syntax =
            syn::parse_file(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let mut index = Index::default();
        index.visit_file(&syntax);
        let name = path.file_stem().unwrap().to_string_lossy();
        let module_root = if matches!(name.as_ref(), "mod" | "main" | "lib") {
            path.parent().unwrap().to_path_buf()
        } else {
            path.with_extension("")
        };
        let modules = index.modules.iter().flat_map(|(relative, excluded, explicit)| {
            let candidates = if *explicit { vec![path.parent().unwrap().join(relative)] } else { vec![module_root.join(relative).with_extension("rs"), module_root.join(relative).join("mod.rs")] };
            candidates.into_iter().filter(|p| p.is_file()).map(move |p| json!({"path":p.canonicalize().unwrap().strip_prefix(root).unwrap().to_str().unwrap(),"excluded":excluded}))
        }).collect::<Vec<_>>();
        let dedicated = path.components().any(|part| part.as_os_str() == "tests")
            || matches!(
                name.as_ref(),
                "tests" | "testing" | "live_tests" | "tests_support"
            )
            || name.ends_with("_tests")
            || name.starts_with("tests_");
        if dedicated {
            index.excluded.push(
                json!({"start":1,"end":text.lines().count(),"reason":"dedicated test source"}),
            );
        }
        files.push(json!({"path":path.strip_prefix(root).unwrap().to_str().unwrap(),"lines":text.lines().count(),"excluded":index.excluded,"tests":index.tests,"modules":modules,"verificationOnly":dedicated}));
    }
}
fn main() {
    let root = env::args().nth(1).expect("source root");
    let root = Path::new(&root).canonicalize().unwrap();
    let mut files = Vec::new();
    for directory in ["src", "crates"] {
        walk(&root, &root.join(directory), &mut files);
    }
    loop {
        let mut excluded = std::collections::HashSet::new();
        for file in &files {
            for module in file["modules"].as_array().unwrap() {
                if file["verificationOnly"] == true || module["excluded"] == true {
                    excluded.insert(module["path"].as_str().unwrap().to_owned());
                }
            }
        }
        let mut changed = false;
        for file in &mut files {
            if file["verificationOnly"] != true && excluded.contains(file["path"].as_str().unwrap())
            {
                file["verificationOnly"] = json!(true);
                let end = file["lines"].clone();
                file["excluded"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"start":1,"end":end,"reason":"test or development-only module"}));
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({"files":files})).unwrap()
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cfg_logic_does_not_exclude_production_enabled_alternatives() {
        for (source, expected) in [
            ("cfg(test)", true),
            ("cfg(any(test, feature = \"test-support\"))", true),
            ("cfg(any(test, unix))", false),
            ("cfg(all(test, unix))", true),
            ("cfg(not(test))", false),
            ("cfg(feature = \"dev-capture\")", true),
        ] {
            assert_eq!(
                test_cfg(&syn::parse_str::<Meta>(source).unwrap()),
                expected,
                "{source}"
            );
        }
    }

    #[test]
    fn nested_test_modules_and_gpui_tests_have_real_source_spans() {
        let source = "fn production() { let _ = \"#[cfg(test)] mod fake {}\"; }\n#[cfg(test)]\nmod checks {\n #[gpui::test]\n fn behavior() {}\n}\n";
        let mut index = Index::default();
        index.visit_file(&syn::parse_file(source).unwrap());
        assert_eq!(
            index.excluded,
            vec![json!({"start":2,"end":6,"reason":"test module"})]
        );
        assert_eq!(
            index.tests,
            vec![json!({"name":"behavior","start":4,"end":5})]
        );
    }
}
