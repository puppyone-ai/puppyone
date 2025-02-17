# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import csv
from typing import Dict
from ModularEdges.SaveEdge.base_save import SaveStrategy
from Utils.PuppyEngineExceptions import global_exception_handler


class CsvSaveStrategy(SaveStrategy):
    @global_exception_handler(2201, "Error Saving Data to CSV File")
    def save(
        self,
        data: Dict,
        filename: str,
        **kwargs
    ) -> str:
        with open(f"{filename}.csv", "w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(data.keys())
            writer.writerows(zip(*data.values()))
        return f"Data saved to {filename}.csv" 
