# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ModularEdges.LoadEdge.base_load import LoadStrategy
from Utils.puppy_exception import global_exception_handler


class TextLoadStrategy(LoadStrategy):
    @global_exception_handler(1000, "Unexpected Error in Loading Text")
    def load(
        self
    ) -> str:
        self.validate_content()
        return self.content
