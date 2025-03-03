# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import copy
from typing import Any
from ModularEdges.ModifyEdge.modify_strategy import ModifyStrategy
from Utils.PuppyEngineExceptions import global_exception_handler


class ModifyCopyContent(ModifyStrategy):
    @global_exception_handler(3801, "Error Copying Block Content")
    def modify(
        self
    ) -> Any:
        return copy.deepcopy(self.content)


if __name__ == "__main__":
    content = "Hello, world!"
    copied_content = ModifyCopyContent(content=content, extra_configs={}).modify()
    print("Copied content:", copied_content)
    
    content = {
        "name": "John",
        "age": 30,
        "city": "New York"
    }
    copied_content = ModifyCopyContent(content=content, extra_configs={}).modify()
    print("Copied content:", copied_content)
