# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ModularEdges.SaveEdge.base_save import SaveStrategy
from Utils.puppy_exception import global_exception_handler


class MarkdownSaveStrategy(SaveStrategy):
    @global_exception_handler(2103, "Error Saving Data to Markdown File")
    def save(
        self,
        data: str,
        filename: str,
        **kwargs
    ) -> str:
        with open(f"{filename}.md", "w", encoding="utf-8") as file:
            file.write(data)
        return f"Data saved to {filename}.md" 
