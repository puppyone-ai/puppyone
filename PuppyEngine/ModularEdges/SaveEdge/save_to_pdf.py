# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fpdf import FPDF
from ModularEdges.SaveEdge.base_save import SaveStrategy
from Utils.PuppyEngineExceptions import global_exception_handler


class PdfSaveStrategy(SaveStrategy):
    @global_exception_handler(2102, "Error Saving Data to PDF File")
    def save(
        self,
        data: str,
        filename: str,
        **kwargs
    ) -> str:
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=kwargs.get("font_size", 12))
        pdf.multi_cell(0, 10, data)
        pdf.output(f"{filename}.pdf")
        return f"Data saved to {filename}.pdf" 
