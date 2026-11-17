//! Sanitized HTML DOM facade (`TA-41`, `TA-51`, `TODO-36`):
//! re-exports [`crate::editor::markdown::shared::dom`] where void/self-closing
//! blocked tags and `MAX_HTML_DEPTH = 64` are enforced.
pub use crate::editor::markdown::shared::dom::*;

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn only_authored_nesting_is_accepted() {
        let Parsed::Complete(nodes) =
            parse("<div align=\"center\"><p>a &amp; <b>b</b><br></p><script>x</script></div>")
        else {
            panic!("complete")
        };
        let Node::Element(div) = &nodes[0] else {
            panic!()
        };
        assert_eq!(
            (div.tag.as_str(), div.attribute("align")),
            ("div", Some("center"))
        );
        assert_eq!(div.children.len(), 1, "the script is dropped");
        assert_eq!(div.text(), "a & b");
        assert_eq!(parse("<p><div>x</div></p>"), Parsed::Malformed);
        assert_eq!(parse("<b>x</i>"), Parsed::Malformed);
        assert_eq!(
            parse("<table>text<tr><td>x</td></tr></table>"),
            Parsed::Malformed
        );
        assert_eq!(
            parse("<details><summary>s</summary>"),
            Parsed::Incomplete(vec!["details".into()])
        );
        assert_eq!(parse("<!-- note -->"), Parsed::Unsupported);
        assert_eq!(balance("</details>", vec!["details".into()]), Some(vec![]));
    }
}
