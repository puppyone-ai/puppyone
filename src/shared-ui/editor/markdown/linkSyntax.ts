/**
 * Link token scanning for code outside the editor. It stays apart from the
 * package entry, which assembles the whole editor, so a navigation helper can
 * read link syntax without depending on the editor that depends on it.
 */
export { findMarkdownLinkTokens } from "./core/links/markdownLinkModel";
export { findWikiLinkTokens } from "./core/links/wikiLinkModel";
