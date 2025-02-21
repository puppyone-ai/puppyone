# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from bs4 import BeautifulSoup
from markdown2 import markdown
from ModularEdges.SaveEdge.base_save import SaveStrategy
from Utils.PuppyEngineExceptions import global_exception_handler


class HtmlSaveStrategy(SaveStrategy):
    @global_exception_handler(2104, "Error Saving Data to HTML File")
    def save(
        self,
        data: str,
        filename: str,
        **kwargs
    ) -> str:
        html = BeautifulSoup(markdown(data), "html.parser").prettify()
        with open(f"{filename}.html", "w", encoding="utf-8") as file:
            file.write(html)
        return f"Data saved to {filename}.html" 
