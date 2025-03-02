# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import Any
from ModularEdges.ModifyEdge.modify_strategy import ModifyStrategy
from Utils.PuppyEngineExceptions import global_exception_handler


class ModifyConvertToText(ModifyStrategy):
    @global_exception_handler(3802, "Error Converting Block Content")
    def modify(
        self
    ) -> Any:
        return str(self.content)


if __name__ == "__main__":
    content = ["Hello, world!"]
    converted_content = ModifyConvertToText(content=content, extra_configs={}).modify()
    print("Converted content:", converted_content, type(converted_content))

    content = {
        "name": "John",
        "age": 30,
        "city": "New York"
    }
    converted_content = ModifyConvertToText(content=content, extra_configs={}).modify()
    print("Converted content:", converted_content, type(converted_content))
