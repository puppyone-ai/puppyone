# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
from typing import Dict, Any
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from ModularEdges.LoadEdge.load_text import TextLoadStrategy
from ModularEdges.LoadEdge.load_file import FileLoadStrategy
from ModularEdges.LoadEdge.load_weblink import WeblinkLoadStrategy
from ModularEdges.LoadEdge.load_database import DatabaseLoadStrategy
from ModularEdges.LoadEdge.load_structured import StructuredLoadStrategy
from Utils.PuppyEngineExceptions import PuppyEngineException, global_exception_handler


class LoaderFactory(EdgeFactoryBase):
    """Factory class for creating and executing load strategies"""

    _strategies = {
        "text": TextLoadStrategy,
        "structured": StructuredLoadStrategy,
        "weblink": WeblinkLoadStrategy,
        "file": FileLoadStrategy,
        "database": DatabaseLoadStrategy
    }

    @classmethod
    @global_exception_handler(1005, "Unexpected Error in Loading Block")
    def execute(
        cls,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> Any:
        block_type = init_configs.get("block_type")
        strategy_class = cls._strategies.get(block_type)
        if not strategy_class:
            raise PuppyEngineException(1000, "Invalid Strategy", 
                                     f"Block type {block_type} not supported")

        strategy = strategy_class(init_configs.get("content"), extra_configs)
        return strategy.load()


if __name__ == "__main__":
    # Load text
    text_content = "Hello, world!"
    result = LoaderFactory.execute(init_configs={"block_type": "text", "content": text_content})
    print("Text:", result)

    # Load structured
    structured_content = {"key": "value"}
    result = LoaderFactory.execute(init_configs={"block_type": "structured", "content": structured_content})
    print("Structured:", result)

    # Load weblink
    url = "https://puppyagent.com"
    result = LoaderFactory.execute(init_configs={"block_type": "weblink", "content": url}, extra_configs={"mode": "scrape"})
    print("Weblink:", result)
