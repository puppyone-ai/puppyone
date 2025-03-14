# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import json
from typing import Any
from ModularEdges.ModifyEdge.modify_strategy import ModifyStrategy
from Utils.puppy_exception import global_exception_handler


class ModifyConvert2Text(ModifyStrategy):
    @global_exception_handler(3802, "Error Converting Block Content")
    def modify(
        self
    ) -> Any:
        """
        Convert structured content (dict, list, etc.) to text format.
        
        Returns:
            String representation of the content
        """
        # Use json.dumps instead of str() to ensure proper JSON formatting
        if isinstance(self.content, (dict, list)):
            return json.dumps(self.content)
        
        # For simple types, regular string conversion is fine
        return str(self.content)


if __name__ == "__main__":
    # Test cases
    print("\n=== Testing with list ===")
    content = ["apple", "juice"]
    converted = ModifyConvert2Text(content=content, extra_configs={}).modify()
    print(f"Input: {content}\nOutput: {converted}")
    
    print("\n=== Testing with dict ===")
    content = {"name": "Test", "values": [1, 2, 3]}
    converted = ModifyConvert2Text(content=content, extra_configs={}).modify()
    print(f"Input: {content}\nOutput: {converted}")
