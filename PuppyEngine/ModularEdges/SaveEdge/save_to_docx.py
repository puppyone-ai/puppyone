# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from pypandoc import convert_text
from ModularEdges.SaveEdge.base_save import SaveStrategy
from Utils.PuppyEngineExceptions import global_exception_handler


class DocxSaveStrategy(SaveStrategy):
    @global_exception_handler(2101, "Error Saving Data to DOCX File")
    def save(
        self,
        data: str,
        filename: str,
        **kwargs
    ) -> str:
        convert_text(data, "docx", format="markdown", outputfile=f"{filename}.docx")
        return f"Data saved to {filename}.docx" 
