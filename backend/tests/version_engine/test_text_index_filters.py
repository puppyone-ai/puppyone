"""PostgREST filter-escaping for the grep text index.

The ``query_indexed_grep`` scope predicate interpolates ``scope_path``
into the PostgREST ``or=`` mini-language. Paths with reserved chars
(``,`` ``.`` ``(`` ``)``) or SQL LIKE wildcards (``%`` ``_``) used to
corrupt the filter; these lock in the escaping fix.
"""

from __future__ import annotations

from src.version_engine.infrastructure.supabase.text_index_repository import (
    _escape_like,
    _pgrst_or_quote,
)


class TestEscapeLike:
    def test_percent_and_underscore_escaped(self):
        assert _escape_like("a%b_c") == r"a\%b\_c"

    def test_backslash_escaped_first(self):
        # Backslash doubled so our own escapes aren't re-escaped.
        assert _escape_like("a\\b") == "a\\\\b"

    def test_plain_value_unchanged(self):
        assert _escape_like("notes/client.md") == "notes/client.md"


class TestPgrstOrQuote:
    def test_plain_path_wrapped_in_quotes(self):
        assert _pgrst_or_quote("notes/sub") == '"notes/sub"'

    def test_reserved_chars_neutralised_by_quoting(self):
        # Commas (or= separator) + dots/parens (grammar) must survive.
        assert _pgrst_or_quote("weird,path.with(parens)") == '"weird,path.with(parens)"'

    def test_embedded_double_quote_escaped(self):
        assert _pgrst_or_quote('has"quote') == '"has\\"quote"'

    def test_backslash_escaped(self):
        assert _pgrst_or_quote("a\\b") == '"a\\\\b"'
