# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ModularEdges.LoadEdge.base_load import LoadStrategy
from Utils.puppy_exception import global_exception_handler


class StructuredLoadStrategy(LoadStrategy):
    @global_exception_handler(1001, "Unexpected Error in Loading Structure Text")
    def load(
        self
    ) -> dict:
        self.validate_content()
        return self.content
 