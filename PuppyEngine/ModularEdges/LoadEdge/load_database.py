# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging
from Blocks.Database import DatabaseFactory
from ModularEdges.LoadEdge.base_load import LoadStrategy
from Utils.PuppyEngineExceptions import global_exception_handler


class DatabaseLoadStrategy(LoadStrategy):
    @global_exception_handler(1004, "Unexpected Error in Loading Database")
    def load(
        self
    ) -> dict:
        self.validate_content()

        client_name = self.extra_configs.get("client_name", "")
        table_name = self.extra_configs.get("table_name", "")
        columns = self.extra_configs.get("columns", [])
        rows = self.extra_configs.get("rows", [])

        db_loader = DatabaseFactory(self.content)
        metadata = db_loader.get_metadata(client_name)
        logging.info(f"Metadata for client '{client_name}': {metadata}")
        return db_loader.query(client_name, table_name, columns, rows)
