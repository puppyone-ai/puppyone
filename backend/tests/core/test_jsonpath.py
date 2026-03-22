"""Tests for jsonpointer operations (resolve, set, delete)."""

from jsonpointer import resolve_pointer, set_pointer


_SAMPLE_DATA = [
    {
        "department": {
            "name": "cardiology",
            "doctors": [
                {"name": "Dr. Smith", "specialty": "heart"},
                {"name": "Dr. Jones", "specialty": "vascular"},
            ],
        }
    }
]


def _fresh_data():
    """Return a deep copy of sample data for each test."""
    import json
    return json.loads(json.dumps(_SAMPLE_DATA))


def test_find_node():
    data = _fresh_data()
    result = resolve_pointer(data, "/0/department/doctors", None)
    assert isinstance(result, list)
    assert len(result) == 2
    assert result[0]["name"] == "Dr. Smith"


def test_create_node():
    """Set a new key-value pair (creates if not exists, overwrites if exists)."""
    data = _fresh_data()
    set_pointer(data, "/0/department/doctors/1/new_field", "new_created_value")
    assert data[0]["department"]["doctors"][1]["new_field"] == "new_created_value"


def test_update_node():
    """Update an existing node value."""
    data = _fresh_data()
    set_pointer(data, "/0/department/doctors/1/specialty", "updated_value")
    assert data[0]["department"]["doctors"][1]["specialty"] == "updated_value"


def test_delete_node():
    """Delete a node at a specified pointer path."""
    data = _fresh_data()
    set_pointer(data, "/0/department/doctors/1/temp_key", "to_delete")
    assert "temp_key" in data[0]["department"]["doctors"][1]

    # Manually delete using pointer traversal
    pointer = "/0/department/doctors/1/temp_key"
    parts = pointer.strip("/").split("/")
    parent_pointer = "/" + "/".join(parts[:-1])
    key = parts[-1]
    parent = resolve_pointer(data, parent_pointer)

    if isinstance(parent, dict) and key in parent:
        del parent[key]

    assert "temp_key" not in data[0]["department"]["doctors"][1]
