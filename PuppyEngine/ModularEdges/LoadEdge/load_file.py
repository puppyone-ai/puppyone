# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
from ModularEdges.LoadEdge.base_load import LoadStrategy
from Utils.puppy_exception import global_exception_handler
from ModularEdges.LoadEdge.load_from_file import FileToTextParser


class FileLoadStrategy(LoadStrategy):
    @global_exception_handler(1003, "Unexpected Error in Loading File")
    def load(
        self
    ) -> str:
        self.validate_content()
        file_configs = self.extra_configs.get("file_configs", [])
        return FileToTextParser().parse_multiple(file_configs)
