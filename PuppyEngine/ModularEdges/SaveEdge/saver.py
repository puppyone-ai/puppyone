# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import Any, Dict
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from ModularEdges.SaveEdge.save_to_csv import CsvSaveStrategy
from ModularEdges.SaveEdge.save_to_pdf import PdfSaveStrategy
from ModularEdges.SaveEdge.save_to_docx import DocxSaveStrategy
from ModularEdges.SaveEdge.save_to_html import HtmlSaveStrategy
from ModularEdges.SaveEdge.save_to_json import JsonSaveStrategy
from ModularEdges.SaveEdge.save_to_text import TextSaveStrategy
from ModularEdges.SaveEdge.save_to_xlsx import XlsxSaveStrategy
from ModularEdges.SaveEdge.save_to_markdown import MarkdownSaveStrategy
from ModularEdges.SaveEdge.save_to_database import DatabaseSaveStrategy
from Utils.puppy_exception import PuppyException, global_exception_handler


class SaverFactory(EdgeFactoryBase):
    """Factory class for creating save strategies"""

    _string_strategies = {
        "txt": TextSaveStrategy(),
        "docx": DocxSaveStrategy(),
        "pdf": PdfSaveStrategy(),
        "markdown": MarkdownSaveStrategy(),
        "html": HtmlSaveStrategy()
    }

    _dict_strategies = {
        "json": JsonSaveStrategy(),
        "csv": CsvSaveStrategy(),
        "xlsx": XlsxSaveStrategy(),
        "database": DatabaseSaveStrategy()
    }

    @global_exception_handler(3012, "Error Executing Save Edge")
    @classmethod
    def execute(
        cls,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> str:
        data = init_configs.get("data")
        file_type = init_configs.get("file_type")

        if isinstance(data, str):
            strategy = cls._string_strategies.get(file_type)
        elif isinstance(data, dict):
            strategy = cls._dict_strategies.get(file_type)
        else:
            raise PuppyException(2301, "Unsupported Data Type", 
                                     f"Data type {type(data).__name__} is unsupported!")

        if not strategy:
            raise PuppyException(2302, "Unsupported File Type", 
                                     f"Type {file_type} is unsupported!")

        return strategy.save(data, init_configs.get("file_name"), **extra_configs)


if __name__ == "__main__":
    text_data = """
    Hello, this is a sample text to save in different formats.
    # Heading 1
    * Point 1
    **bold**text
    """
    file_name = "PuppyEngine/Blocks/savedfiles/sample_text"
    SaverFactory.execute(init_configs={"data": text_data, "file_type": "txt", "file_name": file_name})
    SaverFactory.execute(init_configs={"data": text_data, "file_type": "docx", "file_name": file_name})
    SaverFactory.execute(init_configs={"data": text_data, "file_type": "pdf", "file_name": file_name}, extra_configs={"font_size": 12})
    SaverFactory.execute(init_configs={"data": text_data, "file_type": "markdown", "file_name": file_name})
    SaverFactory.execute(init_configs={"data": text_data, "file_type": "html", "file_name": file_name})

    json_data = {
        "Name": ["John", "Doe"],
        "Age": [28, 34],
        "City": ["New York", "Los Angeles"]
    }
    file_name = "PuppyEngine/Blocks/savedfiles/sample_data"
    SaverFactory.execute(init_configs={"data": json_data, "file_type": "json", "file_name": file_name})
    SaverFactory.execute(init_configs={"data": json_data, "file_type": "csv", "file_name": file_name})
    SaverFactory.execute(init_configs={"data": json_data, "file_type": "xlsx", "file_name": file_name})
