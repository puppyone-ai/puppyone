from typing import Dict, List, Any
from abc import ABC, abstractmethod
from pymongo import MongoClient
from sqlalchemy import create_engine, MetaData, Table, Column, String
from Utils.PuppyEngineExceptions import PuppyEngineException, global_exception_handler

import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DatabaseClient(ABC):
    def __init__(
        self,
        config: Dict[str, Any]
    ):
        """
        Initialize the database client with configuration.

        Args:
            config (Dict[str, Any]): Configuration dictionary for the database client.
        """

        self.config = config
        self.engines = {}
        self.metadata_cache = {}

    @abstractmethod
    def connect(
        self,
        alias: str
    ) -> None:
        """
        Establish connection to the database using the given alias.
        """

        pass

    @abstractmethod
    def get_metadata(
        self,
        alias: str
    ) -> None:
        """
        Retrieve database metadata such as tables and columns for a given alias.
        """

        pass

    @abstractmethod
    def query(
        self,
        alias: str,
        table_name: str,
        columns: List[str] = None,
        limit: int = None,
        offset: int = None
    ) -> List[Dict[str, Any]]:
        """
        Query the database and return results.
        """

        pass

    @abstractmethod
    def save_new_table(
        self,
        alias: str,
        table_name: str,
        data: Dict[str, List[Any]]
    ) -> None:
        """
        Save data to a new table in the database.
        """

        pass

    @abstractmethod
    def save_to_existing_table(
        self,
        alias: str,
        table_name: str,
        data: Dict[str, List[Any]]
    ) -> None:
        """
        Insert data into an existing table in the database.
        """

        pass

    def disconnect(
        self,
        alias: str
    ) -> None:
        """
        Close the connection to the database for the given alias.
        """
        if alias in self.engines:
            self.engines[alias].dispose()
            logger.info(f"Disconnected from {alias}")
            self.engines.pop(alias, None)
            self.metadata_cache.pop(alias, None)


class SQLAlchemyClient(DatabaseClient):
    @global_exception_handler(1401, "Error in SQL Database Configurations")
    def connect(
        self,
        alias: str
    ) -> None:
        """
        Establish a database connection for the given alias.
        """

        if alias in self.engines:
            logger.info(f"Already connected to {alias}")
            return

        db_type = self.config[alias]["type"].lower()
        user = self.config[alias]["user"]
        password = self.config[alias]["password"]
        host = self.config[alias]["host"]
        database = self.config[alias]["database"]

        connection_string = f"{db_type}://{user}:{password}@{host}/{database}"
        engine = create_engine(connection_string, pool_pre_ping=True)

        self.engines[alias] = engine
        self.get_metadata(alias)
        logger.info(f"Connected to {alias}")

    @global_exception_handler(1402, "Error Fetching SQL Database Metadata")
    def get_metadata(
        self,
        alias: str
    ) -> None:
        """
        Fetch metadata (tables, columns) for the given alias.
        """

        if alias not in self.engines:
            raise ValueError(f"No connection found for alias: {alias}")

        engine = self.engines[alias]
        metadata = MetaData()
        metadata.reflect(bind=engine)

        self.metadata_cache[alias] = {
            table_name: [col.name for col in table.columns]
            for table_name, table in metadata.tables.items()
        }
        logger.info(f"Fetched metadata for {alias}")

    @global_exception_handler(1403, "Error Querying SQL Database")
    def query(
        self,
        alias: str,
        table_name: str,
        columns: List[str] = None,
        limit: int = None,
        offset: int = None
    ) -> List[Dict[str, Any]]:
        """
        Query the database for the given alias.
        """

        if alias not in self.engines:
            raise ValueError(f"No connection found for alias: {alias}")

        engine = self.engines[alias]
        metadata = MetaData(bind=engine)
        table = Table(table_name, metadata, autoload_with=engine)

        stmt = table.select()
        if columns:
            stmt = stmt.with_only_columns([table.c[col] for col in columns])
        if limit is not None:
            stmt = stmt.limit(limit)
        if offset is not None:
            stmt = stmt.offset(offset)

        with engine.connect() as connection:
            result = connection.execute(stmt)
            return [dict(row) for row in result]

    @global_exception_handler(2300, "Error Saving New Table in SQL Database")
    def save_new_table(
        self,
        alias: str,
        table_name: str,
        data: Dict[str, List[Any]]
    ) -> None:
        """
        Save data to a new table.
        """

        if alias not in self.engines:
            raise ValueError(f"No connection found for alias: {alias}")

        engine = self.engines[alias]
        metadata = MetaData(bind=engine)
        columns = [col for col in data.keys()]

        table = Table(
            table_name, metadata,
            *[Column(col, String) for col in columns]
        )
        metadata.create_all()

        insert_data = [{col: value for col, value in zip(data.keys(), row)} for row in zip(*data.values())]
        with engine.connect() as connection:
            connection.execute(table.insert(), insert_data)

    @global_exception_handler(2301, "Error Saving Data to Existing Table")
    def save_to_existing_table(
        self,
        alias: str,
        table_name: str,
        data: Dict[str, List[Any]]
    ) -> None:
        """
        Save data to an existing table.
        """

        if alias not in self.engines:
            raise ValueError(f"No connection found for alias: {alias}")

        engine = self.engines[alias]
        metadata = MetaData(bind=engine)
        table = Table(table_name, metadata, autoload_with=engine)

        insert_data = [{col: value for col, value in zip(data.keys(), row)} for row in zip(*data.values())]
        with engine.connect() as connection:
            connection.execute(table.insert(), insert_data)

class MongoDBClient(DatabaseClient):
    @global_exception_handler(1404, "Error MongoDB Database Configurations")
    def connect(
        self,
        alias: str
    ) -> None:
        """
        Establish a MongoDB connection for the given alias.
        """

        if alias in self.engines:
            logger.info(f"Already connected to MongoDB with alias {alias}")
            return

        host = self.config[alias]["host"]
        port = self.config[alias]["port"]
        database = self.config[alias]["database"]

        client = MongoClient(host, port)
        self.engines[alias] = client
        self.metadata_cache[alias] = {"database": database}
        logger.info(f"Connected to MongoDB with alias {alias}")

    @global_exception_handler(1405, "Error Fetching MongoDB Metadata")
    def get_metadata(
        self,
        alias: str
    ) -> None:
        """
        Fetch metadata (collections, columns) for the given alias.
        """

        if alias not in self.engines:
            raise ValueError(f"No connection found for alias: {alias}")

        client = self.engines[alias]
        database_name = self.metadata_cache[alias]["database"]
        db = client[database_name]

        collections = db.list_collection_names()
        metadata = {}
        for collection_name in collections:
            collection = db[collection_name]
            first_doc = collection.find_one()
            if first_doc:
                metadata[collection_name] = list(first_doc.keys())

        self.metadata_cache[alias]["collections"] = metadata
        logger.info(f"Fetched metadata for MongoDB with alias {alias}")

    @global_exception_handler(1406, "Error Querying MongoDB Database")
    def query(
        self,
        alias: str,
        table_name: str,
        columns: List[str] = None,
        limit: int = None,
        offset: int = None
    ) -> List[Dict[str, Any]]:
        """
        Query a MongoDB collection for the given alias.
        """

        if alias not in self.engines:
            raise ValueError(f"No connection found for alias: {alias}")

        client = self.engines[alias]
        database_name = self.metadata_cache[alias]["database"]
        db = client[database_name]
        collection = db[table_name]

        projection = {col: 1 for col in columns} if columns else None
        cursor = collection.find(projection=projection).skip(offset or 0).limit(limit or 0)

        results = list(cursor)
        logger.info(f"Queried MongoDB collection {table_name} with alias {alias}")
        return results

    @global_exception_handler(2302, "Error Saving New Collection in MongoDB")
    def save_new_table(
        self,
        alias: str,
        table_name: str,
        data: Dict[str, List[Any]]
    ) -> None:
        """
        Save data to a new MongoDB collection.
        """

        if alias not in self.engines:
            raise ValueError(f"No connection found for alias: {alias}")

        client = self.engines[alias]
        database_name = self.metadata_cache[alias]["database"]
        db = client[database_name]
        collection = db[table_name]

        documents = [dict(zip(data.keys(), values)) for values in zip(*data.values())]
        collection.insert_many(documents)
        logger.info(f"Saved new collection {table_name} to MongoDB with alias {alias}")

    @global_exception_handler(2303, "Error Saving Data to Existing MongoDB Collection")
    def save_to_existing_table(
        self,
        alias: str,
        table_name: str,
        data: Dict[str, List[Any]]
    ) -> None:
        """
        Save data to an existing MongoDB collection.
        """

        if alias not in self.engines:
            raise ValueError(f"No connection found for alias: {alias}")

        client = self.engines[alias]
        database_name = self.metadata_cache[alias]["database"]
        db = client[database_name]
        collection = db[table_name]

        existing_columns = set(self.metadata[table_name]["columns"])
        if set(data.keys()) != existing_columns:
            raise ValueError("Column names do not match the existing collection in the connected Mongo DB!")

        documents = [dict(zip(data.keys(), values)) for values in zip(*data.values())]
        collection.insert_many(documents)
        logger.info(f"Saved data to existing MongoDB collection {table_name} with alias {alias}")


class DatabaseFactory:
    def __init__(
        self,
        config: Dict[str, Dict[str, Any]]
    ):
        """
        Initialize the DatabaseFactory with configuration.

        Args:
            config (Dict[str, Dict[str, Any]]): Configuration dictionary for the database client.
        """

        self.config = config
        self.clients = {}

    @global_exception_handler(1407, "Error Initializing Database Client")
    def get_client(
        self,
        alias: str
    ) -> DatabaseClient:
        """
        Get or initialize a database client for the given alias.
        """

        if alias in self.clients:
            return self.clients[alias]

        db_type = self.config[alias]["type"].lower()
        if db_type not in {"mysql", "postgresql", "mongodb"}:
            raise PuppyEngineException(1500, "Unsupported Database Type", f"Database type {db_type} is not supported")

        client_class = {
            "mysql": SQLAlchemyClient,
            "postgresql": SQLAlchemyClient,
            "mongodb": MongoDBClient
        }[db_type]

        client = client_class(self.config)
        self.clients[alias] = client
        return client

    @global_exception_handler(1408, "Error Connecting to Database")
    def get_metadata(
        self,
        alias: str
    ) -> Dict[str, Any]:
        """
        Get metadata for a database using the given alias.
        """

        client = self.get_client(alias)
        client.connect(alias)
        metadata = client.metadata_cache[alias]
        client.disconnect(alias)
        return metadata

    @global_exception_handler(1409, "Error Querying Data from Database")
    def query(
        self,
        alias: str,
        table_name: str,
        columns: List[str] = None,
        limit: int = None,
        offset: int = None
    ) -> List[Dict[str, Any]]:
        """
        Query a database using the given alias.
        """

        client = self.get_client(alias)
        client.connect(alias)
        results = client.query(alias, table_name, columns, limit, offset)
        client.disconnect(alias)
        return results

    @global_exception_handler(2304, "Error Saving Data to Database")
    def save_data(
        self,
        alias: str,
        table_name: str,
        data: Dict[str, List[Any]],
        create_new: bool = False
    ) -> None:
        """
        Save data to a database using the given alias.
        """

        client = self.get_client(alias)
        client.connect(alias)
        if create_new:
            client.save_new_table(alias, table_name, data)
        else:
            client.save_to_existing_table(alias, table_name, data)
        client.disconnect(alias)


if __name__ == "__main__":
    db_config = {
        "mysql_db": {
            "type": "mysql",
            "host": "localhost",
            "user": "puppy",
            "password": "123456",
            "database": "test_mysql_db"
        },
        "postgres_db": {
            "type": "postgresql",
            "host": "localhost",
            "user": "puppy",
            "password": "123456",
            "database": "test_postgres_db"
        },
        "mongodb_db": {
            "type": "mongodb",
            "host": "localhost",
            "port": 27017,
            "database": "test_mongo_db"
        }
    }

    db_factory = DatabaseFactory(config=db_config)

    # Test MySQL
    mysql_metadata = db_factory.get_metadata("mysql_db")
    print(f"MySQL Metadata: {mysql_metadata}")
    data_to_save = {"column1": ["value1", "value2"], "column2": ["value3", "value4"]}
    db_factory.save_data("mysql_db", "new_table", data_to_save, create_new=True)
    mysql_query_results = db_factory.query("mysql_db", "new_table", ["column1", "column2"])
    print(f"MySQL Query Results: {mysql_query_results}")

    # Test PostgreSQL
    postgres_metadata = db_factory.get_metadata("postgres_db")
    print(f"PostgreSQL Metadata: {postgres_metadata}")
    db_factory.save_data("postgres_db", "new_table", data_to_save, create_new=True)
    postgres_query_results = db_factory.query("postgres_db", "new_table", ["column1", "column2"])
    print(f"PostgreSQL Query Results: {postgres_query_results}")

    # Test MongoDB
    mongo_metadata = db_factory.get_metadata("mongodb_db")
    print(f"MongoDB Metadata: {mongo_metadata}")
    db_factory.save_data("mongodb_db", "new_collection", data_to_save, create_new=True)
    mongo_query_results = db_factory.query("mongodb_db", "new_collection", ["column1", "column2"])
    print(f"MongoDB Query Results: {mongo_query_results}")
