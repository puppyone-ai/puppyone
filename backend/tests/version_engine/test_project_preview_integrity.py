"""Project metadata routes must not own content-tree reads."""

from __future__ import annotations

import inspect

from src.platform.project import router as project_router


def test_project_metadata_router_does_not_depend_on_content_tree_reads() -> None:
    source = inspect.getsource(project_router)

    assert "ProductOperationAdapter" not in source
    assert "get_product_operation_adapter" not in source
    assert ".list_dir(" not in source
    assert "nodes=" not in source
