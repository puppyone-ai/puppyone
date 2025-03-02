# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
from typing import Any
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.ModifyEdge.modify_strategy import ModifyStrategy


plugin_pattern = r"\{\{(.*?)\}\}"


class ModifyEditText(ModifyStrategy):
    @global_exception_handler(3803, "Error Editing Text")
    def modify(
        self
    ) -> Any:
        plugins = self.extra_configs.get("plugins", {})
        slice_range = self.extra_configs.get("slice", [0, -1])
        sort_type = self.extra_configs.get("sort_type", "")

        def replacer(match):
            key = match.group(1)
            return plugins.get(key, f"{{{{{key}}}}}")

        plugin_pattern_compiled = re.compile(plugin_pattern)
        self.content = plugin_pattern_compiled.sub(replacer, self.content)
        self.content = self.content[slice_range[0]:slice_range[1] if slice_range[1] != -1 else None]
        if sort_type in {"ascending", "descending"}:
            self.content = "".join(sorted(self.content, reverse=(sort_type == "descending")))
        return self.content


if __name__ == "__main__":
    text_with_vars = "Hello {{name}}! Your score is {{score}}"
    replaced_text = ModifyEditText(content=text_with_vars, extra_configs={"plugins": {"name": "Alice", "score": "95"}}).modify()
    print("Variable replacement:", replaced_text)
