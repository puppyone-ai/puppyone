# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import Dict
from Blocks.Database import DatabaseFactory
from ModularEdges.SaveEdge.base_save import SaveStrategy
from Utils.PuppyEngineExceptions import global_exception_handler


class DatabaseSaveStrategy(SaveStrategy):
    @global_exception_handler(2203, "Error Saving Data to Database")
    def save(
        self,
        data: Dict,
        table_name: str,
        **kwargs
    ) -> str:
        db_configs = kwargs.get("db_configs", {})
        create_new = db_configs.pop("create_new", False)
        db_factory = DatabaseFactory(config=db_configs)
        db_factory.save_data(table_name=table_name, data=data, create_new=create_new)
        return f"Data saved to database table {table_name}" 
