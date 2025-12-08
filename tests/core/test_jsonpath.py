"""
测试如何使用jsonpointer库来对json实现任意的定位
"""

from jsonpointer import resolve_pointer, set_pointer
import json
import os

base_path = (
    "/Volumes/Portable/puppy-agents-workspace/ContextBase/backend/tests/core/data"
)
json_file_name = "demo.json"


def test_find_node():
    with open(os.path.join(base_path, json_file_name), "r") as f:
        data = json.load(f)

    print(resolve_pointer(data, "/0/department/doctors", None))


def test_create_node():
    """
    设置一个新的键值对，如果已存在则覆盖
    """
    with open(os.path.join(base_path, json_file_name), "r") as f:
        data = json.load(f)

    # 在 doctors/1 插入新字段，例如 "new_field"
    set_pointer(data, "/0/department/doctors/1/new_field", "new_created_value")
    with open(os.path.join(base_path, json_file_name), "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def test_update_node():
    """
    更新已存在的节点
    """
    with open(os.path.join(base_path, json_file_name), "r") as f:
        data = json.load(f)

    # 假设路径已存在，则改动原值
    set_pointer(data, "/0/department/doctors/1/what", "updated_value")
    with open(os.path.join(base_path, json_file_name), "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def test_delete_node():
    """
    删除指定节点
    """
    with open(os.path.join(base_path, json_file_name), "r") as f:
        data = json.load(f)

    pointer = "/0/department/doctors/1/what"
    # 先找到父节点和要删的key/idx
    parts = pointer.strip("/").split("/")
    parent_pointer = "/" + "/".join(parts[:-1]) if len(parts) > 1 else ""
    key = parts[-1]

    parent = resolve_pointer(data, parent_pointer) if parent_pointer else data

    if isinstance(parent, list):
        idx = int(key)
        if 0 <= idx < len(parent):
            del parent[idx]
    elif isinstance(parent, dict):
        if key in parent:
            del parent[key]

    with open(os.path.join(base_path, json_file_name), "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


test_find_node()
