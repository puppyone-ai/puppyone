# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import csv
import json
from typing import Dict, Any
from fpdf import FPDF
from openpyxl import Workbook
from bs4 import BeautifulSoup
from markdown2 import markdown
from pypandoc import convert_text
from Blocks.Database import DatabaseFactory
from Utils.puppy_exception import PuppyException, global_exception_handler


class DataSaver:
    """
    A unified class for saving data in various formats, including text, PDF, JSON, CSV, XLSX, and databases.
    """

    @staticmethod
    @global_exception_handler(2100, "Error Saving Data to TXT File")
    def save_to_txt(
        data: str,
        filename: str
    ) -> str:
        with open(f"{filename}.txt", "w", encoding="utf-8") as file:
            file.write(data)
        return f"Data saved to {filename}.txt"

    @staticmethod
    @global_exception_handler(2101, "Error Saving Data to DOCX File")
    def save_to_docx(
        data: str,
        filename: str
    ) -> str:
        convert_text(data, "docx", format="markdown", outputfile=f"{filename}.docx")
        return f"Data saved to {filename}.docx"

    @staticmethod
    @global_exception_handler(2102, "Error Saving Data to PDF File")
    def save_to_pdf(
        data: str,
        filename: str,
        font_size: int = 12
    ) -> str:
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=font_size)
        pdf.multi_cell(0, 10, data)
        pdf.output(f"{filename}.pdf")
        return f"Data saved to {filename}.pdf"

    @staticmethod
    @global_exception_handler(2103, "Error Saving Data to Markdown File")
    def save_to_markdown(
        data: str,
        filename: str
    ) -> str:
        with open(f"{filename}.md", "w", encoding="utf-8") as file:
            file.write(data)
        return f"Data saved to {filename}.md"

    @staticmethod
    @global_exception_handler(2104, "Error Saving Data to HTML File")
    def save_to_html(
        data: str,
        filename: str
    ) -> str:
        html = BeautifulSoup(markdown(data), "html.parser").prettify()
        with open(f"{filename}.html", "w", encoding="utf-8") as file:
            file.write(html)
        return f"Data saved to {filename}.html"

    @staticmethod
    @global_exception_handler(2200, "Error Saving Data to JSON File")
    def save_to_json(
        data: Dict,
        filename: str
    ) -> str:
        with open(f"{filename}.json", "w", encoding="utf-8") as file:
            json.dump(data, file, indent=4)
        return f"Data saved to {filename}.json"

    @staticmethod
    @global_exception_handler(2201, "Error Saving Data to CSV File")
    def save_to_csv(
        data: Dict,
        filename: str
    ) -> str:
        with open(f"{filename}.csv", "w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(data.keys())
            writer.writerows(zip(*data.values()))
        return f"Data saved to {filename}.csv"

    @staticmethod
    @global_exception_handler(2202, "Error Saving Data to XLSX File")
    def save_to_xlsx(
        data: Dict,
        filename: str
    ) -> str:
        wb = Workbook()
        ws = wb.active
        ws.append(list(data.keys()))
        for row in zip(*data.values()):
            ws.append(row)
        wb.save(f"{filename}.xlsx")
        return f"Data saved to {filename}.xlsx"

    @staticmethod
    @global_exception_handler(2203, "Error Saving Data to Database")
    def save_to_database(
        data: Dict,
        table_name: str,
        db_configs: Dict
    ) -> str:
        create_new = db_configs.get("create_new", False)
        db_configs.pop("create_new", None)
        db_factory = DatabaseFactory(config=db_configs)
        db_factory.save_data(table_name=table_name, data=data, create_new=create_new)
        return f"Data saved to database table {table_name}"

    @staticmethod
    @global_exception_handler(2000, "Unexpected Error in Saving Data")
    def save_data(
        data: Any,
        filename: str,
        file_type: str,
        **kwargs
    ) -> str:
        """
        Unified method to save data in various formats using a dictionary-based dispatcher.

        Args:
            data (Any): The data to save (string or dictionary).
            filename (str): The filename or database name.
            file_type (str): The format or type of data destination.
            **kwargs: Additional configurations for database-related saves.

        Returns:
            str: A confirmation message upon successful save.
        """

        string_savers = {
            "txt": DataSaver.save_to_txt,
            "docx": DataSaver.save_to_docx,
            "pdf": DataSaver.save_to_pdf,
            "markdown": DataSaver.save_to_markdown,
            "html": DataSaver.save_to_html
        }

        dict_savers = {
            "json": DataSaver.save_to_json,
            "csv": DataSaver.save_to_csv,
            "xlsx": DataSaver.save_to_xlsx,
            "database": DataSaver.save_to_database
        }

        if isinstance(data, str):
            saver_func = string_savers.get(file_type)
        elif isinstance(data, dict):
            saver_func = dict_savers.get(file_type)
        else:
            raise PuppyException(2301, "Unsupported Data Type", f"Data type {type(data).__name__} is unsupported!")

        if not saver_func:
            raise PuppyException(2302, "Unsupported File Type", f"Type {file_type} is unsupported!")

        return saver_func(data, filename, **kwargs)


if __name__ == "__main__":
    text_data = """
Hello, this is a sample text to save in different formats.
# Heading 1

* Point 1

**bold**text
"""
    file_name = "PuppyEngine/Blocks/savedfiles/sample_text"
    DataSaver.save_data(text_data, file_name, "txt")
    DataSaver.save_data(text_data, file_name, "docx")
    DataSaver.save_data(text_data, file_name, "pdf")
    DataSaver.save_data(text_data, file_name, "markdown")
    DataSaver.save_data(text_data, file_name, "html")

    json_data = {
        "Name": ["John", "Doe"],
        "Age": [28, 34],
        "City": ["New York", "Los Angeles"]
    }
    file_name = "PuppyEngine/Blocks/savedfiles/sample_data"
    DataSaver.save_data(json_data, file_name, "json")
    DataSaver.save_data(json_data, file_name, "csv")
    DataSaver.save_data(json_data, file_name, "xlsx")
