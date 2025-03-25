# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import Any
from Utils.puppy_exception import global_exception_handler
from ModularEdges.ModifyEdge.modify_strategy import ModifyStrategy


class ModifyEditText(ModifyStrategy):
    @global_exception_handler(3803, "Error Editing Text")
    def modify(
        self
    ) -> Any:
        slice_range = self.extra_configs.get("slice", [0, -1])
        sort_type = self.extra_configs.get("sort_type", "")
        self.content = self.content[slice_range[0]:slice_range[1] if slice_range[1] != -1 else None]

        if sort_type in {"ascending", "descending"}:
            self.content = "".join(sorted(self.content, reverse=(sort_type == "descending")))
        return self.content


if __name__ == "__main__":
    text_with_vars = "Hello {{name}}! Your score is {{score}}"
    replaced_text = ModifyEditText(content=text_with_vars, extra_configs={"plugins": {"name": "\"Alice\"\n\nabc", "score": "95"}}).modify()
    print("Variable replacement:", replaced_text)
