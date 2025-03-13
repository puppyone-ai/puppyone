# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import Any, Dict
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from ModularEdges.ModifyEdge.edit_text import ModifyEditText
from ModularEdges.ModifyEdge.copy_content import ModifyCopyContent
from ModularEdges.ModifyEdge.convert_to_text import ModifyConvert2Text
from ModularEdges.ModifyEdge.edit_structured import ModifyEditStructured
from ModularEdges.ModifyEdge.convert_2_structured import ModifyConvert2Structured
from Utils.puppy_exception import puppy_exception, global_exception_handler


class ModifierFactory(EdgeFactoryBase):
    _strategies = {
        "copy": ModifyCopyContent,
        "convert2text": ModifyConvert2Text,
        "convert2structured": ModifyConvert2Structured,
        "edit_text": ModifyEditText,
        "edit_structured": ModifyEditStructured,
    }

    @classmethod
    @global_exception_handler(3013, "Error Executing Modify Edge")
    def execute(
        cls,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> Any:
        modify_type = init_configs.get("modify_type")
        strategy_class = cls._strategies.get(modify_type)
        if not strategy_class:
            raise puppy_exception(3014, f"Invalid modify type: {modify_type}")
        return strategy_class(init_configs.get("content"), extra_configs).modify()


if __name__ == "__main__":
    # Test Content setup
    nested_data = {
        "users": [
            {"id": 1, "name": "Alice", "scores": [85, 90, 78]},
            {"id": 2, "name": "Bob", "scores": [92, 88, 95]},
            {"id": 3, "name": "Charlie", "scores": [75, 80, 85]}
        ],
        "settings": {
            "theme": "dark",
            "notifications": True,
            "template": "{{template_name}}"
        },
        "lists": {
            "list1": [1, 2, 3, 4, 5],
            "list2": [4, 5, 6, 7, 8]
        }
    }

    print("\n=== Testing ModifierFactory Operations ===\n")
    print("1. Testing Copy Operation")
    print("-" * 50)
    copied_data = ModifierFactory.execute(init_configs={"modify_type": "copy", "content": nested_data})
    print("Deep copy created:", copied_data, copied_data == nested_data and copied_data is not nested_data)

    print("\n2. Testing Convert Operations")
    print("-" * 50)
    # Test text to structured conversion
    text_data = "{'name': 'Test', 'values': [1, 2, 3]}"
    structured_result = ModifierFactory.execute(
        init_configs={"content": text_data, "modify_type": "convert2structured"}, 
        extra_configs={"conversion_mode": "parse_as_json"})
    print("Text to structured:", structured_result)

    # Test structured to text conversion
    structured_to_text = ModifierFactory.execute(
        init_configs={"content": structured_result, "modify_type": "convert2text"}, 
        extra_configs={})
    print("Structured to text:", structured_to_text)

    print("\n3. Testing Edit Text Operations")
    print("-" * 50)
    text_with_vars = "Hello {{name}}! Your score is {{score}}"
    replaced_text = ModifierFactory.execute(
        init_configs={"content": text_with_vars, "modify_type": "edit_text"}, 
        extra_configs={"plugins": {"name": "Alice", "score": "95"}})
    print("Variable replacement:", replaced_text)

    print("\n4. Testing Edit Structured Operations")
    print("-" * 50)

    # Test nested get
    operations = [
        {
            "type": "get",
            "params": {
                "path": ["users", 0, "name"]
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("Get operation result:", result)

    # Test nested set_value
    operations = [
        {
            "type": "set_value",
            "params": {
                "path": ["settings", "theme"],
                "value": "light"
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("After set_value:", result)

    # Test nested append
    operations = [
        {
            "type": "append",
            "params": {
                "path": ["users", 0, "scores"],
                "value": 100
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("After append:", result)

    # Test nested sort
    operations = [
        {
            "type": "sort",
            "params": {
                "path": ["users", 0, "scores"],
                "reverse": True
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("After sort:", result)

    # Test set operations
    operations = [
        {
            "type": "set_operation",
            "params": {
                "path1": ["lists", "list1"],
                "path2": ["lists", "list2"],
                "operation": "union"
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("Set union result:", result)

    # Test variable replacement in structured content
    operations = [
        {
            "type": "variable_replace",
            "params": {
                "plugins": {"template_name": "custom_template"}
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("After variable replacement:", result)

    # Test chained operations
    print("\n5. Testing Chained Operations")
    print("-" * 50)
    chained_operations = [
        {
            "type": "sort",
            "params": {
                "path": ["users", 0, "scores"],
                "reverse": True
            }
        },
        {
            "type": "get",
            "params": {
                "path": ["users", 0, "scores"],
                "default": []
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": chained_operations})
    print("Chained operations result:", result)

    # Test error handling
    print("\n6. Testing Error Handling")
    print("-" * 50)
    try:
        invalid_operations = [
            {
                "type": "invalid_operation",
                "params": {}
            }
        ]
        result = ModifierFactory.execute(
            init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
            extra_configs={"operations": invalid_operations})
    except Exception as e:
        print("Expected error caught:", str(e))

    try:
        invalid_path = [
            {
                "type": "get",
                "params": {
                    "path": ["nonexistent", "path"]
                }
            }
        ]
        result = ModifierFactory.execute(
            init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
            extra_configs={"operations": invalid_path})
        print("Get with invalid path returns default:", result)
    except Exception as e:
        print("Error with invalid path:", str(e))

    # Test variable replacement
    print("\n7. Testing variable replacement")
    print("-" * 50)
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": [
            {
                "type": "variable_replace",
                "params": {
                    "plugins": {"template_name": "custom_template"}
                }
            }
        ]})
    print("After variable replacement:", result)
