# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
from ModularEdges.LoadEdge.base_load import LoadStrategy
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.LoadEdge.load_from_file import FileToTextParser


class FileLoadStrategy(LoadStrategy):
    @global_exception_handler(1003, "Unexpected Error in Loading File")
    def load(
        self
    ) -> str:
        self.validate_content()

        root_path, file_name = os.path.split(self.content)
        file_type = self.extra_configs.get("type", "txt")
        parser_configs = {k: v for k, v in self.extra_configs.items() if k != "type"}

        file_parser = FileToTextParser(root_path=root_path)
        return file_parser.parse(
            file_name=file_name,
            file_type=file_type,
            **parser_configs
        )
