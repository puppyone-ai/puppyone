# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ModularEdges.SaveEdge.base_save import SaveStrategy
from Utils.PuppyEngineExceptions import global_exception_handler


class TextSaveStrategy(SaveStrategy):
    @global_exception_handler(2100, "Error Saving Data to TXT File")
    def save(
        self,
        data: str,
        filename: str,
        **kwargs
    ) -> str:
        with open(f"{filename}.txt", "w", encoding="utf-8") as file:
            file.write(data)
        return f"Data saved to {filename}.txt" 
