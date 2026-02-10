# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import json
from typing import Dict
from ModularEdges.SaveEdge.base_save import SaveStrategy
from Utils.puppy_exception import global_exception_handler


class JsonSaveStrategy(SaveStrategy):
    @global_exception_handler(2200, "Error Saving Data to JSON File")
    def save(
        self,
        data: Dict,
        filename: str,
        **kwargs
    ) -> str:
        with open(f"{filename}.json", "w", encoding="utf-8") as file:
            json.dump(data, file, indent=4)
        return f"Data saved to {filename}.json" 
