# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openpyxl import Workbook
from typing import Dict
from ModularEdges.SaveEdge.base_save import SaveStrategy
from Utils.PuppyEngineExceptions import global_exception_handler


class XlsxSaveStrategy(SaveStrategy):
    @global_exception_handler(2202, "Error Saving Data to XLSX File")
    def save(
        self,
        data: Dict,
        filename: str,
        **kwargs
    ) -> str:
        wb = Workbook()
        ws = wb.active
        ws.append(list(data.keys()))
        for row in zip(*data.values()):
            ws.append(row)
        wb.save(f"{filename}.xlsx")
        return f"Data saved to {filename}.xlsx" 
